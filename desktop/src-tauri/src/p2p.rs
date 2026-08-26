use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{endpoint::presets, Endpoint, EndpointAddr};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

const ROOM_ALPN: &[u8] = b"mind-jam/room/1";
const MAX_MESSAGE_SIZE: usize = 256 * 1024 * 1024;
const PACK_CACHE_TTL_SECS: u64 = 24 * 60 * 60;
static NEXT_PEER_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfigInput {
    pub room_name: String,
    pub password: String,
    pub host_name: String,
    pub host_avatar_id: String,
    pub max_participants: usize,
    pub team_mode: bool,
    pub team_count: usize,
    pub game_type: String,
    pub pack_file_name: String,
    pub pack: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRoomConfig {
    pub room_name: String,
    pub host_name: String,
    pub host_avatar_id: String,
    pub max_participants: usize,
    pub team_mode: bool,
    pub team_count: usize,
    pub game_type: String,
    pub pack_file_name: String,
}

impl From<&RoomConfigInput> for PublicRoomConfig {
    fn from(value: &RoomConfigInput) -> Self {
        Self {
            room_name: value.room_name.clone(),
            host_name: value.host_name.clone(),
            host_avatar_id: value.host_avatar_id.clone(),
            max_participants: value.max_participants,
            team_mode: value.team_mode,
            team_count: value.team_count,
            game_type: value.game_type.clone(),
            pack_file_name: value.pack_file_name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSeat {
    pub index: usize,
    pub team: usize,
    pub name: Option<String>,
    pub connected: bool,
    pub score: i64,
    #[serde(skip)]
    reconnect_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSnapshot {
    pub config: PublicRoomConfig,
    pub seats: Vec<RoomSeat>,
    pub game_started: bool,
    pub paused: bool,
    pub game_state: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRoomResult {
    pub connection_string: String,
    pub snapshot: RoomSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomResult {
    pub reconnect_token: String,
    pub seat_index: Option<usize>,
    pub snapshot: RoomSnapshot,
    pub game_pack: Value,
    pub pack_cache_hit: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionTicket {
    version: u8,
    address: EndpointAddr,
    password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomEvent {
    kind: String,
    snapshot: Option<RoomSnapshot>,
    message: Option<String>,
    seat_index: Option<usize>,
    question_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClientMessage {
    Hello {
        password: String,
        name: String,
        reconnect_token: Option<String>,
        has_cached_pack: bool,
    },
    ClaimSeat {
        seat_index: usize,
    },
    Action,
    Chat {
        message: String,
    },
    SelectQuestion {
        question_id: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HostMessage {
    Welcome {
        reconnect_token: String,
        seat_index: Option<usize>,
        snapshot: RoomSnapshot,
        pack: Option<Value>,
    },
    Snapshot {
        snapshot: RoomSnapshot,
    },
    Error {
        message: String,
    },
}

type SharedSend = Arc<AsyncMutex<iroh::endpoint::SendStream>>;

struct ConnectedPeer {
    reconnect_token: String,
    name: String,
    send: SharedSend,
}

struct HostedRoom {
    config: RoomConfigInput,
    seats: Vec<RoomSeat>,
    game_started: bool,
    paused: bool,
    game_state: Option<Value>,
    peers: HashMap<String, ConnectedPeer>,
    pack_transfer: Arc<AsyncMutex<()>>,
}

impl HostedRoom {
    fn snapshot(&self) -> RoomSnapshot {
        RoomSnapshot {
            config: PublicRoomConfig::from(&self.config),
            seats: self.seats.clone(),
            game_started: self.game_started,
            paused: self.paused,
            game_state: self.game_state.clone(),
        }
    }
}

#[derive(Default)]
pub struct P2pRuntime {
    endpoint: Option<Endpoint>,
    hosted_room: Option<Arc<AsyncMutex<HostedRoom>>>,
    client_send: Option<SharedSend>,
}

fn peer_token(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let number = NEXT_PEER_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{millis:x}-{number:x}")
}

fn encode_connection_string(address: &EndpointAddr, password: &str) -> Result<String, String> {
    let bytes = serde_json::to_vec(&ConnectionTicket {
        version: 1,
        address: address.clone(),
        password: password.to_string(),
    })
    .map_err(|error| error.to_string())?;
    Ok(format!("mindjam://{}", URL_SAFE_NO_PAD.encode(bytes)))
}

fn decode_connection_string(value: &str) -> Result<ConnectionTicket, String> {
    let encoded = value
        .trim()
        .strip_prefix("mindjam://")
        .unwrap_or(value.trim());
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "Invalid room address".to_string())?;
    let ticket: ConnectionTicket =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid connection string".to_string())?;
    if ticket.version != 1 || ticket.password.is_empty() {
        return Err("Invalid connection string".to_string());
    }
    Ok(ticket)
}

fn pack_cache_path(app: &AppHandle, connection_string: &str) -> Result<PathBuf, String> {
    let digest = Sha256::digest(connection_string.as_bytes());
    let key = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("online-packs");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    if let Ok(entries) = fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let expired = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
                .map(|age| age.as_secs() >= PACK_CACHE_TTL_SECS)
                .unwrap_or(true);
            if expired {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(directory.join(format!("{key}.json")))
}

fn load_cached_pack(app: &AppHandle, connection_string: &str) -> Option<Value> {
    let path = pack_cache_path(app, connection_string).ok()?;
    let modified = fs::metadata(&path).ok()?.modified().ok()?;
    let fresh = modified
        .elapsed()
        .map(|age| age.as_secs() < PACK_CACHE_TTL_SECS)
        .unwrap_or(false);
    if !fresh {
        let _ = fs::remove_file(path);
        return None;
    }
    let value = serde_json::from_slice::<Value>(&fs::read(path).ok()?).ok()?;
    validate_pack(&value).ok()?;
    Some(value)
}

fn store_cached_pack(app: &AppHandle, connection_string: &str, pack: &Value) -> Result<(), String> {
    validate_pack(pack)?;
    let path = pack_cache_path(app, connection_string)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(pack).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&path);
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn validate_pack(pack: &Value) -> Result<(), String> {
    if pack.get("id").and_then(Value::as_str).is_none()
        || pack.get("name").and_then(Value::as_str).is_none()
        || pack.get("gameType").and_then(Value::as_str).is_none()
        || pack.get("rounds").and_then(Value::as_array).is_none()
    {
        return Err("Invalid game pack".to_string());
    }
    Ok(())
}

async fn send_message<T: Serialize>(send: &SharedSend, message: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MESSAGE_SIZE {
        return Err("Room message is too large".to_string());
    }
    let mut send = send.lock().await;
    send.write_all(&(bytes.len() as u32).to_be_bytes())
        .await
        .map_err(|error| error.to_string())?;
    send.write_all(&bytes)
        .await
        .map_err(|error| error.to_string())
}

async fn receive_message<T: for<'de> Deserialize<'de>>(
    recv: &mut iroh::endpoint::RecvStream,
) -> Result<T, String> {
    let mut length = [0_u8; 4];
    recv.read_exact(&mut length)
        .await
        .map_err(|error| error.to_string())?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_MESSAGE_SIZE {
        return Err("Room message is too large".to_string());
    }
    let mut bytes = vec![0_u8; length];
    recv.read_exact(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

async fn broadcast_room(room: &Arc<AsyncMutex<HostedRoom>>, app: &AppHandle) {
    let (snapshot, peers) = {
        let room = room.lock().await;
        (
            room.snapshot(),
            room.peers
                .values()
                .map(|peer| peer.send.clone())
                .collect::<Vec<_>>(),
        )
    };
    let _ = app.emit(
        "p2p-room-event",
        RoomEvent {
            kind: "snapshot".into(),
            snapshot: Some(snapshot.clone()),
            message: None,
            seat_index: None,
            question_id: None,
        },
    );
    for send in peers {
        let _ = send_message(
            &send,
            &HostMessage::Snapshot {
                snapshot: snapshot.clone(),
            },
        )
        .await;
    }
}

async fn handle_host_connection(
    connection: iroh::endpoint::Connection,
    room: Arc<AsyncMutex<HostedRoom>>,
    app: AppHandle,
) -> Result<(), String> {
    let (send, mut recv) = connection
        .accept_bi()
        .await
        .map_err(|error| error.to_string())?;
    let hello = receive_message::<ClientMessage>(&mut recv).await?;
    let ClientMessage::Hello {
        password,
        name,
        reconnect_token,
        has_cached_pack,
    } = hello
    else {
        return Err("Expected room hello".to_string());
    };
    let send = Arc::new(AsyncMutex::new(send));
    let peer_id = peer_token("peer");
    let reconnect_token = reconnect_token.unwrap_or_else(|| peer_token("reconnect"));

    let (snapshot, seat_index, pack, pack_transfer) = {
        let mut room = room.lock().await;
        if password != room.config.password {
            drop(room);
            send_message(
                &send,
                &HostMessage::Error {
                    message: "Wrong room password".into(),
                },
            )
            .await?;
            return Err("Wrong room password".to_string());
        }
        if let Some(seat) = room
            .seats
            .iter_mut()
            .find(|seat| seat.reconnect_token.as_deref() == Some(&reconnect_token))
        {
            seat.connected = true;
            seat.name = Some(name.clone());
        }
        let seat_index = room
            .seats
            .iter()
            .find(|seat| seat.reconnect_token.as_deref() == Some(&reconnect_token))
            .map(|seat| seat.index);
        (
            room.snapshot(),
            seat_index,
            (!has_cached_pack).then(|| room.config.pack.clone()),
            room.pack_transfer.clone(),
        )
    };
    let _transfer_guard = if pack.is_some() {
        Some(pack_transfer.lock().await)
    } else {
        None
    };
    send_message(
        &send,
        &HostMessage::Welcome {
            reconnect_token: reconnect_token.clone(),
            seat_index,
            snapshot,
            pack,
        },
    )
    .await?;
    drop(_transfer_guard);
    room.lock().await.peers.insert(
        peer_id.clone(),
        ConnectedPeer {
            reconnect_token,
            name,
            send: send.clone(),
        },
    );
    broadcast_room(&room, &app).await;

    loop {
        match receive_message::<ClientMessage>(&mut recv).await {
            Ok(ClientMessage::ClaimSeat { seat_index }) => {
                let mut error = None;
                {
                    let mut room = room.lock().await;
                    let Some(peer) = room.peers.get(&peer_id) else {
                        break;
                    };
                    let token = peer.reconnect_token.clone();
                    let name = peer.name.clone();
                    if seat_index >= room.seats.len() {
                        error = Some("Invalid table".to_string());
                    } else if room.seats[seat_index].reconnect_token.is_some()
                        && room.seats[seat_index].reconnect_token.as_deref() != Some(&token)
                    {
                        error = Some("This table is reserved".to_string());
                    } else {
                        for seat in &mut room.seats {
                            if seat.reconnect_token.as_deref() == Some(&token) {
                                seat.reconnect_token = None;
                                seat.connected = false;
                                seat.name = None;
                            }
                        }
                        let seat = &mut room.seats[seat_index];
                        seat.reconnect_token = Some(token);
                        seat.connected = true;
                        seat.name = Some(name);
                    }
                }
                if let Some(message) = error {
                    send_message(&send, &HostMessage::Error { message }).await?;
                } else {
                    broadcast_room(&room, &app).await;
                }
            }
            Ok(ClientMessage::Action) => {
                emit_peer_event(&room, &peer_id, &app, "action", None, None).await;
            }
            Ok(ClientMessage::Chat { message }) => {
                emit_peer_event(&room, &peer_id, &app, "chat", Some(message), None).await;
            }
            Ok(ClientMessage::SelectQuestion { question_id }) => {
                emit_peer_event(
                    &room,
                    &peer_id,
                    &app,
                    "selectQuestion",
                    None,
                    Some(question_id),
                )
                .await;
            }
            Ok(ClientMessage::Hello { .. }) => {}
            Err(_) => break,
        }
    }

    let disconnected = {
        let mut room = room.lock().await;
        let token = room.peers.remove(&peer_id).map(|peer| peer.reconnect_token);
        if let Some(token) = token {
            if let Some(seat) = room
                .seats
                .iter_mut()
                .find(|seat| seat.reconnect_token.as_deref() == Some(&token))
            {
                seat.connected = false;
                true
            } else {
                false
            }
        } else {
            false
        }
    };
    if disconnected {
        let _ = app.emit(
            "p2p-room-event",
            RoomEvent {
                kind: "participantDisconnected".into(),
                snapshot: None,
                message: None,
                seat_index: None,
                question_id: None,
            },
        );
    }
    broadcast_room(&room, &app).await;
    Ok(())
}

async fn emit_peer_event(
    room: &Arc<AsyncMutex<HostedRoom>>,
    peer_id: &str,
    app: &AppHandle,
    kind: &str,
    message: Option<String>,
    question_id: Option<String>,
) {
    let seat_index = {
        let room = room.lock().await;
        room.peers.get(peer_id).and_then(|peer| {
            room.seats
                .iter()
                .find(|seat| seat.reconnect_token.as_deref() == Some(&peer.reconnect_token))
                .map(|seat| seat.index)
        })
    };
    if seat_index.is_some() {
        let _ = app.emit(
            "p2p-room-event",
            RoomEvent {
                kind: kind.into(),
                snapshot: None,
                message,
                seat_index,
                question_id,
            },
        );
    }
}

#[tauri::command]
pub async fn host_p2p_room(
    config: RoomConfigInput,
    app: AppHandle,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<HostRoomResult, String> {
    if config.room_name.trim().is_empty()
        || config.password.is_empty()
        || config.host_name.trim().is_empty()
        || config.host_avatar_id.trim().is_empty()
        || !(2..=12).contains(&config.max_participants)
        || !(2..=4).contains(&config.team_count)
    {
        return Err("Invalid room settings".to_string());
    }
    validate_pack(&config.pack)?;
    let endpoint = Endpoint::builder(presets::N0)
        .alpns(vec![ROOM_ALPN.to_vec()])
        .bind()
        .await
        .map_err(|error| error.to_string())?;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(8), endpoint.online()).await;
    let address = endpoint.addr();
    let connection_string = encode_connection_string(&address, &config.password)?;
    let seats = (0..config.max_participants)
        .map(|index| RoomSeat {
            index,
            team: if config.team_mode {
                index % config.team_count + 1
            } else {
                index + 1
            },
            name: None,
            connected: false,
            score: 0,
            reconnect_token: None,
        })
        .collect();
    let room = Arc::new(AsyncMutex::new(HostedRoom {
        config,
        seats,
        game_started: false,
        paused: false,
        game_state: None,
        peers: HashMap::new(),
        pack_transfer: Arc::new(AsyncMutex::new(())),
    }));
    let snapshot = room.lock().await.snapshot();
    let accept_endpoint = endpoint.clone();
    let accept_room = room.clone();
    let accept_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(incoming) = accept_endpoint.accept().await {
            let room = accept_room.clone();
            let app = accept_app.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(connection) = incoming.await {
                    let _ = handle_host_connection(connection, room, app).await;
                }
            });
        }
    });
    let previous = {
        let mut state = runtime
            .lock()
            .map_err(|_| "P2P state is unavailable".to_string())?;
        let previous = state.endpoint.take();
        state.endpoint = Some(endpoint);
        state.hosted_room = Some(room);
        state.client_send = None;
        previous
    };
    if let Some(previous) = previous {
        previous.close().await;
    }
    Ok(HostRoomResult {
        connection_string,
        snapshot,
    })
}

#[tauri::command]
pub async fn join_p2p_room(
    connection_string: String,
    name: String,
    reconnect_token: Option<String>,
    app: AppHandle,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<JoinRoomResult, String> {
    let ticket = decode_connection_string(&connection_string)?;
    let cached_pack = load_cached_pack(&app, &connection_string);
    let has_cached_pack = cached_pack.is_some();
    let endpoint = Endpoint::bind(presets::N0)
        .await
        .map_err(|error| error.to_string())?;
    let connection = endpoint
        .connect(ticket.address, ROOM_ALPN)
        .await
        .map_err(|error| error.to_string())?;
    let (send, mut recv) = connection
        .open_bi()
        .await
        .map_err(|error| error.to_string())?;
    let send = Arc::new(AsyncMutex::new(send));
    send_message(
        &send,
        &ClientMessage::Hello {
            password: ticket.password,
            name,
            reconnect_token,
            has_cached_pack,
        },
    )
    .await?;
    let welcome = receive_message::<HostMessage>(&mut recv).await?;
    let HostMessage::Welcome {
        reconnect_token,
        seat_index,
        snapshot,
        pack,
    } = welcome
    else {
        return match welcome {
            HostMessage::Error { message } => Err(message),
            _ => Err("Invalid room response".to_string()),
        };
    };
    let game_pack = match (pack, cached_pack) {
        (Some(pack), _) => {
            store_cached_pack(&app, &connection_string, &pack)?;
            pack
        }
        (None, Some(pack)) => pack,
        (None, None) => return Err("The host did not provide a game pack".to_string()),
    };
    let reader_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match receive_message::<HostMessage>(&mut recv).await {
                Ok(HostMessage::Snapshot { snapshot }) => {
                    let _ = reader_app.emit(
                        "p2p-room-event",
                        RoomEvent {
                            kind: "snapshot".into(),
                            snapshot: Some(snapshot),
                            message: None,
                            seat_index: None,
                            question_id: None,
                        },
                    );
                }
                Ok(HostMessage::Error { message }) => {
                    let _ = reader_app.emit(
                        "p2p-room-event",
                        RoomEvent {
                            kind: "error".into(),
                            snapshot: None,
                            message: Some(message),
                            seat_index: None,
                            question_id: None,
                        },
                    );
                }
                Ok(HostMessage::Welcome { .. }) => {}
                Err(_) => {
                    let _ = reader_app.emit(
                        "p2p-room-event",
                        RoomEvent {
                            kind: "hostDisconnected".into(),
                            snapshot: None,
                            message: None,
                            seat_index: None,
                            question_id: None,
                        },
                    );
                    break;
                }
            }
        }
    });
    let previous = {
        let mut state = runtime
            .lock()
            .map_err(|_| "P2P state is unavailable".to_string())?;
        let previous = state.endpoint.take();
        state.endpoint = Some(endpoint);
        state.hosted_room = None;
        state.client_send = Some(send);
        previous
    };
    if let Some(previous) = previous {
        previous.close().await;
    }
    Ok(JoinRoomResult {
        reconnect_token,
        seat_index,
        snapshot,
        game_pack,
        pack_cache_hit: has_cached_pack,
    })
}

#[tauri::command]
pub async fn claim_p2p_seat(
    seat_index: usize,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<(), String> {
    let send = runtime
        .lock()
        .map_err(|_| "P2P state is unavailable".to_string())?
        .client_send
        .clone()
        .ok_or("Not connected to a room")?;
    send_message(&send, &ClientMessage::ClaimSeat { seat_index }).await
}

async fn send_client_message(
    runtime: State<'_, Mutex<P2pRuntime>>,
    message: ClientMessage,
) -> Result<(), String> {
    let send = runtime
        .lock()
        .map_err(|_| "P2P state is unavailable".to_string())?
        .client_send
        .clone()
        .ok_or("Not connected to a room")?;
    send_message(&send, &message).await
}

#[tauri::command]
pub async fn send_p2p_action(runtime: State<'_, Mutex<P2pRuntime>>) -> Result<(), String> {
    send_client_message(runtime, ClientMessage::Action).await
}

#[tauri::command]
pub async fn send_p2p_chat(
    message: String,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<(), String> {
    send_client_message(
        runtime,
        ClientMessage::Chat {
            message: message.trim().chars().take(240).collect(),
        },
    )
    .await
}

#[tauri::command]
pub async fn send_p2p_question_selection(
    question_id: String,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<(), String> {
    send_client_message(runtime, ClientMessage::SelectQuestion { question_id }).await
}

#[tauri::command]
pub async fn update_hosted_room(
    game_started: bool,
    paused: bool,
    game_state: Option<Value>,
    seat_scores: Vec<i64>,
    app: AppHandle,
    runtime: State<'_, Mutex<P2pRuntime>>,
) -> Result<(), String> {
    let room = runtime
        .lock()
        .map_err(|_| "P2P state is unavailable".to_string())?
        .hosted_room
        .clone()
        .ok_or("This device is not hosting a room")?;
    {
        let mut room_state = room.lock().await;
        room_state.game_started = game_started;
        room_state.paused = paused;
        room_state.game_state = game_state;
        for (seat, score) in room_state.seats.iter_mut().zip(seat_scores) {
            seat.score = score;
        }
    }
    broadcast_room(&room, &app).await;
    Ok(())
}

#[tauri::command]
pub async fn close_p2p_room(runtime: State<'_, Mutex<P2pRuntime>>) -> Result<(), String> {
    let endpoint = {
        let mut state = runtime
            .lock()
            .map_err(|_| "P2P state is unavailable".to_string())?;
        state.hosted_room = None;
        state.client_send = None;
        state.endpoint.take()
    };
    if let Some(endpoint) = endpoint {
        endpoint.close().await;
    }
    Ok(())
}
