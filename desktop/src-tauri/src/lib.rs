mod p2p;

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample, Stream,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    fs::OpenOptions,
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioDevice {
    device_id: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioDevices {
    inputs: Vec<AudioDevice>,
    outputs: Vec<AudioDevice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    variant: &'static str,
    requires_system_gstreamer: bool,
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    let variant = option_env!("MIND_JAM_BUILD_VARIANT").unwrap_or("standard");
    BuildInfo {
        variant,
        requires_system_gstreamer: variant == "arch-linux-system-gstreamer",
    }
}

struct Voice {
    phase: f32,
    phase_step: f32,
    remaining: usize,
    total: usize,
    volume: f32,
    waveform: String,
}

struct NativeAudioState {
    output_stream: Option<Stream>,
    output_device_id: String,
    sample_rate: u32,
    voices: Arc<Mutex<Vec<Voice>>>,
    input_stream: Option<Stream>,
    microphone_level: Arc<AtomicU32>,
}

impl Default for NativeAudioState {
    fn default() -> Self {
        Self {
            output_stream: None,
            output_device_id: "default".to_string(),
            sample_rate: 48_000,
            voices: Arc::new(Mutex::new(Vec::new())),
            input_stream: None,
            microphone_level: Arc::new(AtomicU32::new(0)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackSummary {
    id: String,
    file_name: String,
    name: String,
    game_type: String,
    tags: Vec<String>,
    updated_at: String,
    round_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PacksListing {
    directory: String,
    packs: Vec<PackSummary>,
}

#[derive(Serialize, Deserialize)]
struct PackStorageConfig {
    directory: PathBuf,
}

struct PackStorageState {
    directory: Mutex<PathBuf>,
    config_path: PathBuf,
}

fn game_root() -> Result<PathBuf, String> {
    let current = std::env::current_dir().map_err(|error| error.to_string())?;

    for candidate in current.ancestors() {
        if candidate.join("desktop").is_dir() && candidate.join("packs").is_dir() {
            return Ok(candidate.to_path_buf());
        }
    }

    std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to locate the game directory".to_string())
}

fn default_packs_directory() -> Result<PathBuf, String> {
    Ok(game_root()?.join("packs"))
}

fn pack_storage_state(app: &AppHandle) -> Result<PackStorageState, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let config_path = config_directory.join("pack-storage.json");
    let configured_directory = fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| serde_json::from_str::<PackStorageConfig>(&content).ok())
        .map(|config| config.directory)
        .unwrap_or(default_packs_directory()?);
    let directory = if fs::create_dir_all(&configured_directory).is_ok() {
        configured_directory
    } else {
        let fallback = default_packs_directory()?;
        fs::create_dir_all(&fallback).map_err(|error| error.to_string())?;
        fallback
    };
    Ok(PackStorageState {
        directory: Mutex::new(directory),
        config_path,
    })
}

fn packs_directory(state: &PackStorageState) -> Result<PathBuf, String> {
    let directory = state
        .directory
        .lock()
        .map_err(|_| "Pack storage is unavailable".to_string())?
        .clone();
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn save_pack_storage_config(state: &PackStorageState, directory: &PathBuf) -> Result<(), String> {
    let config_directory = state
        .config_path
        .parent()
        .ok_or_else(|| "Invalid pack storage configuration path".to_string())?;
    fs::create_dir_all(config_directory).map_err(|error| error.to_string())?;
    let temporary = state.config_path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&PackStorageConfig {
        directory: directory.clone(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if state.config_path.exists() {
        fs::remove_file(&state.config_path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, &state.config_path).map_err(|error| error.to_string())
}

fn safe_file_name(file_name: &str) -> Result<&str, String> {
    let is_safe = file_name.ends_with(".json")
        && file_name.len() <= 128
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && !file_name.contains("..");

    if is_safe {
        Ok(file_name)
    } else {
        Err("Invalid pack file name".to_string())
    }
}

fn summary_from_value(value: &Value, file_name: String) -> Result<PackSummary, String> {
    Ok(PackSummary {
        id: value["id"]
            .as_str()
            .ok_or("Pack id is missing")?
            .to_string(),
        file_name,
        name: value["name"]
            .as_str()
            .ok_or("Pack name is missing")?
            .to_string(),
        game_type: value["gameType"]
            .as_str()
            .ok_or("Pack game type is missing")?
            .to_string(),
        tags: value["tags"]
            .as_array()
            .map(|tags| {
                tags.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        updated_at: value["updatedAt"].as_str().unwrap_or_default().to_string(),
        round_count: if value["gameType"].as_str() == Some("crowd-code") {
            value["crowdRounds"].as_array().map_or(0, Vec::len)
        } else {
            value["rounds"].as_array().map_or(0, Vec::len)
        },
    })
}

fn validated_pack_id(pack: &Value) -> Result<&str, String> {
    let id = pack["id"].as_str().ok_or("Pack id is missing")?;
    if id.is_empty()
        || id.len() > 96
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Invalid pack id".to_string());
    }
    Ok(id)
}

fn list_packs_in(directory: PathBuf) -> Result<PacksListing, String> {
    let mut packs = Vec::new();

    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let value = match serde_json::from_str::<Value>(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Ok(summary) = summary_from_value(&value, file_name) {
            packs.push(summary);
        }
    }

    packs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(PacksListing {
        directory: directory.to_string_lossy().to_string(),
        packs,
    })
}

#[tauri::command]
fn list_packs(state: State<'_, PackStorageState>) -> Result<PacksListing, String> {
    list_packs_in(packs_directory(&state)?)
}

#[tauri::command]
fn set_packs_directory(
    directory_path: String,
    state: State<'_, PackStorageState>,
) -> Result<PacksListing, String> {
    let requested = PathBuf::from(directory_path);
    if !requested.is_dir() {
        return Err("Select an existing directory".to_string());
    }
    let directory = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let write_test_path = directory.join(format!(".mind-jam-write-test-{}", std::process::id()));
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&write_test_path)
        .map_err(|_| "The selected directory is not writable".to_string())?;
    fs::remove_file(&write_test_path).map_err(|error| error.to_string())?;

    let listing = list_packs_in(directory.clone())?;
    save_pack_storage_config(&state, &directory)?;
    *state
        .directory
        .lock()
        .map_err(|_| "Pack storage is unavailable".to_string())? = directory.clone();
    Ok(listing)
}

#[tauri::command]
fn load_pack(file_name: String, state: State<'_, PackStorageState>) -> Result<Value, String> {
    let file_name = safe_file_name(&file_name)?;
    let content = fs::read_to_string(packs_directory(&state)?.join(file_name))
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_pack_in(pack: Value, directory: PathBuf) -> Result<PackSummary, String> {
    let id = validated_pack_id(&pack)?;
    summary_from_value(&pack, format!("{id}.json"))?;

    let file_name = format!("{id}.json");
    let destination = directory.join(&file_name);
    let temporary = directory.join(format!(".{id}.tmp"));
    let content = serde_json::to_string_pretty(&pack).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if destination.exists() {
        fs::remove_file(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;

    summary_from_value(&pack, file_name)
}

#[tauri::command]
fn save_pack(pack: Value, state: State<'_, PackStorageState>) -> Result<PackSummary, String> {
    save_pack_in(pack, packs_directory(&state)?)
}

#[tauri::command]
fn import_pack(
    source_path: String,
    state: State<'_, PackStorageState>,
) -> Result<PackSummary, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file()
        || source.extension().and_then(|extension| extension.to_str()) != Some("json")
    {
        return Err("Select a JSON pack file".to_string());
    }

    let content = fs::read_to_string(&source).map_err(|error| error.to_string())?;
    let mut pack = serde_json::from_str::<Value>(&content).map_err(|error| error.to_string())?;
    let original_id = validated_pack_id(&pack)?.to_string();
    summary_from_value(&pack, format!("{original_id}.json"))?;
    let game_type = pack["gameType"].as_str();
    if !matches!(game_type, Some("topic-clash" | "crowd-code"))
        || !pack["rounds"].is_array()
        || !pack["finalThemes"].is_array()
        || (game_type == Some("crowd-code") && !pack["crowdRounds"].is_array())
    {
        return Err("Unsupported Mind Jam pack structure".to_string());
    }

    let directory = packs_directory(&state)?;
    if directory.join(format!("{original_id}.json")).exists() {
        let base = original_id.chars().take(80).collect::<String>();
        let mut number = 2_u32;
        loop {
            let candidate = format!("{base}-import-{number}");
            if !directory.join(format!("{candidate}.json")).exists() {
                pack["id"] = Value::String(candidate);
                break;
            }
            number = number.saturating_add(1);
        }
    }

    save_pack_in(pack, directory)
}

#[tauri::command]
fn export_pack(
    file_name: String,
    directory_path: String,
    state: State<'_, PackStorageState>,
) -> Result<String, String> {
    let file_name = safe_file_name(&file_name)?;
    let source = packs_directory(&state)?.join(file_name);
    if !source.is_file() {
        return Err("Pack file does not exist".to_string());
    }

    let directory = PathBuf::from(directory_path);
    if !directory.is_dir() {
        return Err("Select an existing directory".to_string());
    }

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid pack file name")?;
    let mut destination = directory.join(file_name);
    let mut number = 2_u32;
    while destination.exists() {
        destination = directory.join(format!("{stem}-{number}.json"));
        number = number.saturating_add(1);
    }
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_pack(file_name: String, state: State<'_, PackStorageState>) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    let path = packs_directory(&state)?.join(file_name);
    if !path.is_file() {
        return Err("Pack file does not exist".to_string());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn device_by_id(is_input: bool, device_id: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if device_id == "default" {
        return if is_input {
            host.default_input_device()
        } else {
            host.default_output_device()
        }
        .ok_or_else(|| "Default audio device is unavailable".to_string());
    }
    let id = device_id
        .parse::<cpal::DeviceId>()
        .map_err(|_| "Invalid audio device id".to_string())?;
    let device = host
        .device_by_id(&id)
        .ok_or_else(|| "Audio device is no longer available".to_string())?;
    if (is_input && !device.supports_input()) || (!is_input && !device.supports_output()) {
        return Err("Audio device has the wrong direction".to_string());
    }
    Ok(device)
}

#[tauri::command]
fn list_audio_devices() -> Result<AudioDevices, String> {
    let host = cpal::default_host();
    let inputs = host
        .input_devices()
        .map_err(|error| error.to_string())?
        .filter_map(|device| {
            Some(AudioDevice {
                device_id: device.id().ok()?.to_string(),
                label: device.to_string(),
            })
        })
        .collect();
    let outputs = host
        .output_devices()
        .map_err(|error| error.to_string())?
        .filter_map(|device| {
            Some(AudioDevice {
                device_id: device.id().ok()?.to_string(),
                label: device.to_string(),
            })
        })
        .collect();
    Ok(AudioDevices { inputs, outputs })
}

fn write_output<T>(output: &mut [T], channels: usize, voices: &Arc<Mutex<Vec<Voice>>>)
where
    T: Sample + FromSample<f32>,
{
    let Ok(mut voices) = voices.lock() else {
        output.fill(T::from_sample(0.0));
        return;
    };
    for frame in output.chunks_mut(channels) {
        let mut mixed = 0.0_f32;
        for voice in voices.iter_mut() {
            let sample = match voice.waveform.as_str() {
                "square" => {
                    if voice.phase.sin() >= 0.0 {
                        1.0
                    } else {
                        -1.0
                    }
                }
                "triangle" => (2.0 / std::f32::consts::PI) * voice.phase.sin().asin(),
                _ => voice.phase.sin(),
            };
            let progress = 1.0 - voice.remaining as f32 / voice.total as f32;
            let attack = (progress / 0.06).clamp(0.0, 1.0);
            let release = (voice.remaining as f32 / voice.total as f32).powf(0.8);
            mixed += sample * voice.volume * attack * release;
            voice.phase = (voice.phase + voice.phase_step) % (2.0 * std::f32::consts::PI);
            voice.remaining = voice.remaining.saturating_sub(1);
        }
        voices.retain(|voice| voice.remaining > 0);
        let value = T::from_sample(mixed.clamp(-1.0, 1.0));
        frame.fill(value);
    }
}

fn build_output_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    voices: Arc<Mutex<Vec<Voice>>>,
) -> Result<Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    device
        .build_output_stream(
            config.clone(),
            move |output: &mut [T], _| write_output(output, channels, &voices),
            |error| eprintln!("Native audio output error: {error}"),
            None,
        )
        .map_err(|error| error.to_string())
}

fn replace_output_stream(state: &mut NativeAudioState, device_id: &str) -> Result<(), String> {
    let device = device_by_id(false, device_id)?;
    let supported = device
        .default_output_config()
        .map_err(|error| error.to_string())?;
    state.sample_rate = supported.sample_rate();
    let config = supported.config();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => {
            build_output_stream::<f32>(&device, &config, Arc::clone(&state.voices))
        }
        SampleFormat::I16 => {
            build_output_stream::<i16>(&device, &config, Arc::clone(&state.voices))
        }
        SampleFormat::U16 => {
            build_output_stream::<u16>(&device, &config, Arc::clone(&state.voices))
        }
        format => Err(format!("Unsupported output sample format: {format}")),
    }?;
    stream.play().map_err(|error| error.to_string())?;
    state.output_stream = Some(stream);
    state.output_device_id = device_id.to_string();
    Ok(())
}

#[tauri::command]
fn set_output_device(
    device_id: String,
    state: tauri::State<'_, Mutex<NativeAudioState>>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Audio state is unavailable".to_string())?;
    replace_output_stream(&mut state, &device_id)
}

#[tauri::command]
fn play_tone(
    frequency: f32,
    duration: f32,
    waveform: String,
    volume: f32,
    state: tauri::State<'_, Mutex<NativeAudioState>>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Audio state is unavailable".to_string())?;
    if state.output_stream.is_none() {
        let device_id = state.output_device_id.clone();
        replace_output_stream(&mut state, &device_id)?;
    }
    let sample_rate = state.sample_rate;
    let total = (duration * sample_rate as f32).max(1.0) as usize;
    state
        .voices
        .lock()
        .map_err(|_| "Audio voices are unavailable".to_string())?
        .push(Voice {
            phase: 0.0,
            phase_step: 2.0 * std::f32::consts::PI * frequency / sample_rate as f32,
            remaining: total,
            total,
            volume: volume.clamp(0.0, 1.0),
            waveform,
        });
    Ok(())
}

fn build_input_stream<T, F>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    level: Arc<AtomicU32>,
    convert: F,
) -> Result<Stream, String>
where
    T: SizedSample,
    F: Fn(T) -> f32 + Send + 'static,
{
    device
        .build_input_stream(
            config.clone(),
            move |input: &[T], _| {
                let peak = input.iter().copied().map(&convert).fold(0.0_f32, f32::max);
                level.store(
                    (peak.clamp(0.0, 1.0) * 100.0).round() as u32,
                    Ordering::Relaxed,
                );
            },
            |_error| {},
            None,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_microphone_test(
    device_id: String,
    state: tauri::State<'_, Mutex<NativeAudioState>>,
) -> Result<(), String> {
    let device = device_by_id(true, &device_id)?;
    let supported = device
        .default_input_config()
        .map_err(|error| error.to_string())?;
    let config = supported.config();
    let mut state = state
        .lock()
        .map_err(|_| "Audio state is unavailable".to_string())?;
    state.microphone_level.store(0, Ordering::Relaxed);
    let level = Arc::clone(&state.microphone_level);
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build_input_stream::<f32, _>(&device, &config, level, f32::abs),
        SampleFormat::I16 => build_input_stream::<i16, _>(&device, &config, level, |value| {
            value.unsigned_abs() as f32 / i16::MAX as f32
        }),
        SampleFormat::U16 => build_input_stream::<u16, _>(&device, &config, level, |value| {
            ((value as f32 / u16::MAX as f32) * 2.0 - 1.0).abs()
        }),
        format => Err(format!("Unsupported input sample format: {format}")),
    }?;
    stream.play().map_err(|error| error.to_string())?;
    state.input_stream = Some(stream);
    Ok(())
}

#[tauri::command]
fn microphone_level(state: tauri::State<'_, Mutex<NativeAudioState>>) -> Result<u32, String> {
    let state = state
        .lock()
        .map_err(|_| "Audio state is unavailable".to_string())?;
    Ok(state.microphone_level.load(Ordering::Relaxed))
}

#[tauri::command]
fn stop_microphone_test(state: tauri::State<'_, Mutex<NativeAudioState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Audio state is unavailable".to_string())?;
    state.input_stream = None;
    state.microphone_level.store(0, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(NativeAudioState::default()))
        .manage(Mutex::new(p2p::P2pRuntime::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = pack_storage_state(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_build_info,
            list_packs,
            set_packs_directory,
            load_pack,
            save_pack,
            import_pack,
            export_pack,
            delete_pack,
            p2p::host_p2p_room,
            p2p::join_p2p_room,
            p2p::claim_p2p_seat,
            p2p::send_p2p_action,
            p2p::send_p2p_chat,
            p2p::send_p2p_question_selection,
            p2p::send_p2p_final_theme_removal,
            p2p::send_p2p_final_wager,
            p2p::send_p2p_final_answer,
            p2p::send_p2p_crowd_big_decision,
            p2p::acknowledge_p2p_room_closed,
            p2p::update_hosted_room,
            p2p::close_p2p_room,
            list_audio_devices,
            set_output_device,
            play_tone,
            start_microphone_test,
            microphone_level,
            stop_microphone_test,
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
