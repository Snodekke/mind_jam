import { HttpClient } from "@angular/common/http";
import { Component, NgZone, OnDestroy, OnInit, inject } from "@angular/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize, type Monitor } from "@tauri-apps/api/window";
import { CrowdAnswer, CrowdQuestion, CrowdRound, CrowdRoundKind, GamePack, PackGameType, PackMedia, PackQuestion, PackRound, PackSummary, PackTag, PackTheme } from "./pack.models";
import { PackStorageService } from "./pack-storage.service";

type Language = "en" | "ru";
type ViewName = "menu" | "avatars" | "themes" | "settings" | "packs" | "pack-setup" | "pack-editor" | "offline-mode" | "offline-bots-setup" | "offline-game" | "online-mode" | "online-create" | "online-join" | "online-room";
type MenuAction = "online" | "offline" | "packs" | "avatars" | "themes";
type VolumeSetting = "masterVolume" | "musicVolume" | "effectsVolume" | "mediaVolume";
type DisplayMode = "windowed" | "borderless" | "fullscreen";
type BindingSetting = "actionKey" | "pushToTalkKey";
type MicrophoneCaptureMode = "off" | "test" | "room";
type OfflineRoomMode = "bots" | "hotseat";
type OfflineGamePhase = "lobby" | "round-title" | "themes" | "chooser" | "board" | "question" | "round-complete" | "final-elimination" | "final-themes" | "final-wager" | "final-question" | "final-answers" | "winner";
type OfflineQuestionStage = "cat-announcement" | "cat-recipient" | "cat-transfer" | "typing" | "text-hold" | "media" | "answering" | "judging" | "answer-reveal";
type CrowdGamePhase = "captain-selection" | "round-intro" | "faceoff" | "team-play" | "steal" | "reverse-play" | "round-result" | "big-setup" | "big-play" | "winner";

interface MenuItem { action: MenuAction; tone: "primary" | "secondary"; }
interface AudioDevice { deviceId: string; label: string; }
interface NativeAudioDevices { inputs: AudioDevice[]; outputs: AudioDevice[]; }
interface NativeBuildInfo { variant: string; requiresSystemGstreamer: boolean; }
interface DisplayOption { id: number; label: string; monitor: Monitor | null; }
interface OfflineBot { id: string; name: string; avatarId: AvatarDefinition["id"]; score: number; team: number; connected?: boolean; }
interface OfflineTeamView { number: number; name: string; members: OfflineBot[]; score: number; }
interface OnlineRoomConfig { roomName: string; hostName: string; hostAvatarId: AvatarDefinition["id"]; maxParticipants: number; teamMode: boolean; teamCount: number; gameType: PackGameType; packFileName: string; }
interface OnlineRoomSeat { index: number; team: number; name: string | null; avatarId: AvatarDefinition["id"] | null; connected: boolean; score: number; }
interface OnlineRoomSnapshot { config: OnlineRoomConfig; seats: OnlineRoomSeat[]; gameStarted: boolean; paused: boolean; gameState: unknown | null; }
interface OnlineRoomEvent { kind: "snapshot" | "participantDisconnected" | "hostDisconnected" | "roomClosed" | "error" | "action" | "chat" | "selectQuestion" | "removeFinalTheme" | "submitFinalWager" | "submitFinalAnswer" | "crowdBigDecision"; snapshot?: OnlineRoomSnapshot; message?: string; seatIndex?: number; questionId?: string; }
interface HostOnlineRoomResult { connectionString: string; snapshot: OnlineRoomSnapshot; }
interface JoinOnlineRoomResult { reconnectToken: string; seatIndex: number | null; snapshot: OnlineRoomSnapshot; gamePack: GamePack; packCacheHit: boolean; }
interface OnlineGameState {
  bots: OfflineBot[];
  teamMode: boolean;
  teamCount: number;
  gameStarted: boolean;
  paused: boolean;
  phase: OfflineGamePhase;
  roundIndex: number;
  chooserBotId: string | null;
  selectionSeconds: number;
  selectedQuestionId: string | null;
  questionStage: OfflineQuestionStage;
  typedQuestionText: string;
  questionMediaVisible: boolean;
  answerSeconds: number;
  responderBotId: string | null;
  lastWrongBotId: string | null;
  pendingJudgeResolution: "correct" | "wrong" | "timeout" | null;
  catRecipientBotId: string | null;
  hostAnimation: AvatarAnimationName;
  botAnimations: [string, AvatarAnimationName][];
  roomMessages: [string, string][];
  answeredQuestionIds: string[];
  finalThemeIds: string[];
  finalistIds: string[];
  finalTurnIndex: number;
  finalSeconds: number;
  finalWagersVisible: boolean;
  finalAnswersVisible: boolean;
  isFinalQuestion: boolean;
  finalWagers: [string, number][];
  finalAnswers: [string, string][];
  finalJudgements: [string, boolean][];
  winnerBotId: string | null;
  crowd: CrowdOnlineState | null;
}
interface CrowdOnlineState {
  phase: CrowdGamePhase;
  roundIndex: number;
  questionIndex: number;
  captainIds: [number, string][];
  revealedAnswerIds: string[];
  activeTeam: number;
  roundPot: number;
  misses: number;
  responderId: string | null;
  roundWinnerTeam: number | null;
  bigWagers: [number, number][];
  bigPlayerIds: [number, string][];
  bigConfirmedTeams: number[];
  bigTurnOrder: number[];
  bigTurnIndex: number;
  bigPoints: [number, number][];
}
interface HotseatContestant { key: string; label: string; bot: OfflineBot; }
interface OfflineQuestionCheckpoint {
  question: PackQuestion;
  chooserBotId: string | null;
  botScores: Map<string, number>;
}
interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  mediaVolume: number;
  outputDeviceId: string;
  inputDeviceId: string;
  microphoneSensitivity: number;
  language: Language;
  displayId: number;
  resolution: string;
  displayMode: DisplayMode;
  actionKey: string;
  pushToTalk: boolean;
  pushToTalkKey: string;
}
interface AvatarAnimation { column: number; frames: number; fps: number; loop: boolean; spriteSheet?: string; }
type AvatarAnimationName = "idle" | "victory" | "raiseHand" | "talk" | "upset" | "point" | "thumbsUp" | "thumbsDown";
interface AvatarDefinition {
  id: "male" | "female" | "robot" | "schoolboy" | "schoolgirl";
  name: string;
  columns?: number;
  preview: string;
  spriteSheet: string;
  animations: Record<AvatarAnimationName, AvatarAnimation>;
}
interface AvatarCatalog { version: number; avatars: AvatarDefinition[]; }
interface ThemeDefinition { id: "standart" | "school"; name: [string, string]; preview?: string; }

const QUESTION_TYPING_INTERVAL_MS = 42;

const translations = {
  en: {
    online: "Play online", offline: "Play offline", packs: "Packs", avatars: "Avatars", themes: "Themes",
    settings: "Settings", back: "Back",
    customization: "PLAYER CUSTOMIZATION", chooseAvatar: "Choose your avatar", avatarTip: "Your selection is saved on this computer.", ready: "READY TO JAM",
    audio: "AUDIO", interface: "DEVICES AND CONTROLS", settingsTitle: "Game settings", settingsSubtitle: "Sound, display, controls and language",
    masterVolume: "Master volume", musicVolume: "Music",
    effectsVolume: "Interface sounds", mediaVolume: "Question media", outputDevice: "Sound output", inputDevice: "Microphone", systemDefault: "System default",
    noDevices: "No devices found", microphoneTest: "Microphone test", microphoneSensitivity: "Microphone sensitivity", startTest: "START TEST", stopTest: "STOP TEST",
    micIdle: "Press start and speak into the microphone", micListening: "Listening…",
    devicePermission: "Allow microphone access to show device names and test the signal.",
    outputUnsupported: "Output selection is not supported by this system; the default device will be used.",
    language: "Interface language", english: "English", russian: "Русский",
    video: "DISPLAY", display: "Display", resolution: "Resolution", displayMode: "Display mode",
    windowed: "Windowed", borderless: "Borderless", fullscreen: "Fullscreen",
    controls: "CONTROLS", actionKey: "Action key", pushToTalk: "Push to talk", pushToTalkKey: "Push-to-talk key",
    keyHint: "Focus the field and press a key",
    offlineTitle: "Offline game", chooseOfflineMode: "Choose a mode", playWithBots: "PLAY WITH BOTS", hotseat: "HOTSEAT",
    comingLater: "Coming later", botSetup: "Game with bots", botCount: "Number of bots", botName: "Bot name", botAvatar: "Avatar",
    choosePack: "Choose a pack", startGame: "START GAME", noPlayablePacks: "Create a Topic Clash pack before starting the game.",
    roundBoard: "Round board", questionShort: "Question", host: "HOST", exitGame: "EXIT",
    savedLocally: "Sound, display, controls and language are saved on this computer.",
  },
  ru: {
    online: "Играть онлайн", offline: "Играть офлайн", packs: "Наборы", avatars: "Аватары", themes: "Темы",
    settings: "Настройки", back: "Назад",
    customization: "НАСТРОЙКА ИГРОКА", chooseAvatar: "Выберите аватар", avatarTip: "Выбор сохраняется на этом компьютере.", ready: "ГОТОВЫ К ИГРЕ",
    audio: "ЗВУК", interface: "УСТРОЙСТВА И УПРАВЛЕНИЕ", settingsTitle: "Настройки игры", settingsSubtitle: "Звук, экран, управление и язык",
    masterVolume: "Общая громкость", musicVolume: "Музыка",
    effectsVolume: "Звуки интерфейса", mediaVolume: "Медиа в вопросах", outputDevice: "Устройство вывода", inputDevice: "Микрофон", systemDefault: "Системное устройство",
    noDevices: "Устройства не найдены", microphoneTest: "Проверка микрофона", microphoneSensitivity: "Чувствительность микрофона", startTest: "НАЧАТЬ ПРОВЕРКУ", stopTest: "ОСТАНОВИТЬ",
    micIdle: "Нажмите кнопку и скажите что-нибудь", micListening: "Слушаем…",
    devicePermission: "Разрешите доступ к микрофону, чтобы увидеть названия устройств и проверить сигнал.",
    outputUnsupported: "Система не поддерживает выбор выхода — используется устройство по умолчанию.",
    language: "Язык интерфейса", english: "English", russian: "Русский",
    video: "ЭКРАН", display: "Дисплей", resolution: "Разрешение", displayMode: "Отображение",
    windowed: "Окно", borderless: "Окно без рамок", fullscreen: "Полноэкранное",
    controls: "УПРАВЛЕНИЕ", actionKey: "Кнопка действия", pushToTalk: "Говорить по кнопке", pushToTalkKey: "Кнопка разговора",
    keyHint: "Выберите поле и нажмите клавишу",
    offlineTitle: "Игра офлайн", chooseOfflineMode: "Выберите режим", playWithBots: "ИГРАТЬ С БОТАМИ", hotseat: "ИГРА НА ОДНОМ УСТРОЙСТВЕ",
    comingLater: "Появится позже", botSetup: "Игра с ботами", botCount: "Количество ботов", botName: "Имя бота", botAvatar: "Аватар",
    choosePack: "Выберите пак", startGame: "НАЧАТЬ ИГРУ", noPlayablePacks: "Перед стартом создайте пак для «Битвы тем».",
    roundBoard: "Таблица раунда", questionShort: "Вопрос", host: "ВЕДУЩИЙ", exitGame: "ВЫЙТИ",
    savedLocally: "Звук, экран, управление и язык сохранены на этом компьютере.",
  },
} as const;
type TranslationKey = keyof (typeof translations)["en"];

@Component({ selector: "app-root", imports: [], templateUrl: "./app.component.html", styleUrl: "./app.component.css" })
export class AppComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly ngZone = inject(NgZone);
  private readonly selectedAvatarStorageKey = "mind-jam.selected-avatar";
  private readonly selectedThemeStorageKey = "mind-jam.selected-theme";
  private readonly nicknameStorageKey = "mind-jam.nickname";
  private readonly settingsStorageKey = "mind-jam.settings";
  private readonly packStorage = new PackStorageService();
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private beatStep = 0;
  private micLevelTimer: ReturnType<typeof setInterval> | null = null;
  private questionTimerAudio: HTMLAudioElement | null = null;
  private questionTimerTickTimer: ReturnType<typeof setInterval> | null = null;
  private questionTimerSoundActive = false;
  private isPushToTalkPressed = false;
  private microphoneCaptureMode: MicrophoneCaptureMode = "off";
  private lastClickSoundAt = 0;
  private offlinePhaseTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineSelectionTimer: ReturnType<typeof setInterval> | null = null;
  private offlineTypeTimer: ReturnType<typeof setInterval> | null = null;
  private offlineAnswerTimer: ReturnType<typeof setInterval> | null = null;
  private offlineBotTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineBotJudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineBotHostPendingDecision: boolean | null = null;
  private offlineMediaTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineMediaObjectUrl: string | null = null;
  private offlineAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineFinalTimer: ReturnType<typeof setInterval> | null = null;
  private readonly offlineMessageTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly offlineAuraBoostTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly offlineActionPulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly offlineFalseStartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private unlistenP2pRoom: UnlistenFn | null = null;
  private onlineGameSyncTimer: ReturnType<typeof setInterval> | null = null;
  private onlineParticipantTypingTimer: ReturnType<typeof setInterval> | null = null;
  private onlineParticipantTypingQuestionId: string | null = null;
  private onlineApplyingSnapshot = false;
  private readonly handleGlobalButtonClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button");
    if (button && !button.hasAttribute("disabled")) this.playClick();
  };
  private readonly handleMediaPlay = (event: Event) => {
    if (event.target instanceof HTMLMediaElement) event.target.volume = this.mediaPlaybackVolume;
  };
  private readonly handleGameActionKey = (event: KeyboardEvent) => {
    if (this.settings.pushToTalk && event.code === this.settings.pushToTalkKey && this.view === "offline-game") {
      event.preventDefault();
      if (!this.canUseRoomCommunication) return;
      if (!event.repeat && !this.isPushToTalkPressed && !this.offlineGamePaused) {
        this.isPushToTalkPressed = true;
        void this.startRoomMicrophoneMonitoring();
      }
      return;
    }
    if (event.repeat || this.view !== "offline-game") return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (this.onlineRole === "participant") {
      if (event.code !== this.settings.actionKey || this.onlineSeatIndex === null) return;
      event.preventDefault();
      this.sendOnlineAction();
      return;
    }
    if (this.offlineRoomMode === "hotseat") {
      const contestant = this.offlineHotseatContestants.find((entry) => this.offlineAnswerKeys.get(entry.key) === event.code);
      if (!contestant) return;
      event.preventDefault();
      this.triggerOfflineAction(contestant.bot.id);
      return;
    }
    if (event.code !== this.settings.actionKey) return;
    const participantId = this.offlineHumanBotId ?? this.offlineChooserBotId;
    if (!participantId) return;
    event.preventDefault();
    this.triggerOfflineAction(participantId);
  };
  private readonly handlePushToTalkKeyUp = (event: KeyboardEvent) => {
    if (!this.settings.pushToTalk || event.code !== this.settings.pushToTalkKey || !this.isPushToTalkPressed) return;
    event.preventDefault();
    this.isPushToTalkPressed = false;
    this.stopMicrophoneTest();
  };
  private readonly handlePushToTalkBlur = () => {
    if (!this.isPushToTalkPressed) return;
    this.isPushToTalkPressed = false;
    this.stopMicrophoneTest();
  };

  readonly menuItems: MenuItem[] = [
    { action: "online", tone: "primary" }, { action: "offline", tone: "primary" }, { action: "packs", tone: "secondary" },
    { action: "avatars", tone: "secondary" }, { action: "themes", tone: "secondary" },
  ];
  readonly animationOrder: AvatarAnimationName[] = ["idle", "victory", "raiseHand", "talk", "upset", "point", "thumbsUp", "thumbsDown"];
  readonly animationLabels: Record<AvatarAnimationName, string> = {
    idle: "Idle", victory: "Victory", raiseHand: "Raise hand", talk: "Talk", upset: "Upset", point: "Point", thumbsUp: "Thumbs up", thumbsDown: "Thumbs down",
  };
  readonly packTagOptions: PackTag[] = [
    "people-society", "nature-universe", "technology-inventions", "art-culture",
    "mass-media-entertainment", "sport-activity", "economy-business", "logic-abstraction",
  ];

  avatars: AvatarDefinition[] = [];
  selectedAvatarId = "male";
  currentAnimationName: AvatarAnimationName = "idle";
  view: ViewName = "menu";
  private settingsReturnView: ViewName = "menu";
  feedback = "";
  nickname = "Игрок";
  isEditingNickname = false;
  isSavingNickname = false;
  nicknameDraft = "";
  nicknameFeedback = "";
  selectedThemeId: ThemeDefinition["id"] = "standart";
  outputDevices: AudioDevice[] = [];
  inputDevices: AudioDevice[] = [];
  displayOptions: DisplayOption[] = [];
  resolutionOptions = ["1280x720", "1366x768", "1600x900", "1920x1080", "2560x1440", "3840x2160"];
  isTestingMicrophone = false;
  microphoneLevel = 0;
  deviceFeedback = "";
  outputSelectionSupported = true;
  requiresSystemGstreamer = false;
  settings: AudioSettings = {
    masterVolume: 80, musicVolume: 45, effectsVolume: 70, mediaVolume: 80, outputDeviceId: "default", inputDeviceId: "default", microphoneSensitivity: 100, language: "ru",
    displayId: 0, resolution: "1280x720", displayMode: "windowed", actionKey: "Space", pushToTalk: false, pushToTalkKey: "ControlLeft",
  };
  packSummaries: PackSummary[] = [];
  packsDirectory = "packs";
  isLoadingPacks = false;
  isChangingPacksDirectory = false;
  isSavingPack = false;
  isImportingPack = false;
  packOperationFileName: string | null = null;
  packFeedback = "";
  newPackName = "";
  newPackType: PackGameType = "topic-clash";
  newPackTags: PackTag[] = [];
  packDraft: GamePack | null = null;
  activeRoundIndex = 0;
  expandedQuestionId: string | null = null;
  onlineRoomName = "";
  onlineMaxParticipants = 6;
  onlineTeamMode = false;
  onlineTeamCount = 2;
  onlineSelectedPackFile = "";
  onlineJoinConnectionString = "";
  onlineRoomSnapshot: OnlineRoomSnapshot | null = null;
  onlineRole: "host" | "participant" | null = null;
  onlineConnectionString = "";
  onlineDownloadedPack: GamePack | null = null;
  onlineReconnectToken = "";
  onlineSeatIndex: number | null = null;
  onlineInfoOpen = false;
  onlineBusy = false;
  onlineFeedback = "";
  offlineBots: OfflineBot[] = [];
  offlineHumanBotId: string | null = null;
  offlineRoomMode: OfflineRoomMode = "bots";
  offlineTeamMode = false;
  offlineTeamCount = 2;
  offlineTeamNames = ["", "", "", ""];
  offlinePackSummaries: PackSummary[] = [];
  selectedOfflinePackFile = "";
  offlineGamePack: GamePack | null = null;
  offlineFeedback = "";
  offlineGameStarted = false;
  offlineGamePaused = false;
  offlineGamePhase: OfflineGamePhase = "lobby";
  offlineRoundIndex = 0;
  offlineChooserBotId: string | null = null;
  offlineSelectionSeconds = 10;
  offlineSelectedQuestion: PackQuestion | null = null;
  offlineQuestionStage: OfflineQuestionStage = "typing";
  offlineTypedQuestionText = "";
  offlineQuestionMediaVisible = false;
  offlineQuestionMediaUrl = "";
  offlineAnswerSeconds = 30;
  offlineResponderBotId: string | null = null;
  offlineLastWrongBotId: string | null = null;
  offlineQuestionCheckpoint: OfflineQuestionCheckpoint | null = null;
  offlinePendingJudgeResolution: "correct" | "wrong" | "timeout" | null = null;
  offlineCatRecipientBotId: string | null = null;
  offlineHostAnimation: AvatarAnimationName = "idle";
  readonly offlineBotAnimations = new Map<string, AvatarAnimationName>();
  readonly offlineParticipantMicrophoneLevels = new Map<string, number>();
  readonly offlineRoomMessages = new Map<string, string>();
  readonly offlineAuraBoosts = new Set<string>();
  readonly offlineActionPressedIds = new Set<string>();
  readonly offlineFalseStartIds = new Set<string>();
  offlineChatOpen = false;
  offlineChatDraft = "";
  readonly offlineAnsweredQuestionIds = new Set<string>();
  offlineFinalThemes: PackTheme[] = [];
  offlineFinalistIds: string[] = [];
  offlineFinalTurnIndex = 0;
  offlineFinalSeconds = 30;
  offlineFinalWagersVisible = false;
  offlineFinalAnswersVisible = false;
  offlineIsFinalQuestion = false;
  readonly offlineFinalWagerDrafts = new Map<string, number>();
  readonly offlineFinalWagers = new Map<string, number>();
  readonly offlineFinalAnswerDrafts = new Map<string, string>();
  readonly offlineFinalAnswers = new Map<string, string>();
  readonly offlineFinalJudgements = new Map<string, boolean>();
  offlineWinnerBotId: string | null = null;
  crowdGamePhase: CrowdGamePhase = "captain-selection";
  crowdRoundIndex = 0;
  crowdQuestionIndex = 0;
  readonly crowdCaptainIds = new Map<number, string>();
  readonly crowdRevealedAnswerIds = new Set<string>();
  crowdActiveTeam = 1;
  crowdRoundPot = 0;
  crowdMisses = 0;
  crowdResponderId: string | null = null;
  crowdRoundWinnerTeam: number | null = null;
  readonly crowdBigWagers = new Map<number, number>();
  readonly crowdBigPlayerIds = new Map<number, string>();
  readonly crowdBigWagerDrafts = new Map<number, number>();
  readonly crowdBigPlayerDrafts = new Map<number, string>();
  readonly crowdBigConfirmedTeams = new Set<number>();
  crowdBigTurnOrder: number[] = [];
  crowdBigTurnIndex = 0;
  readonly crowdBigPoints = new Map<number, number>();
  readonly offlineAnswerKeys = new Map<string, string>();
  offlineKeySettingsOpen = false;
  scoreEditorTargetId: string | null = null;
  scoreEditorValue = 0;
  readonly themes: ThemeDefinition[] = [
    { id: "standart", name: ["Standard", "Стандартная"] },
    { id: "school", name: ["Summer school", "Летняя школа"], preview: "assets/themes/school/summer-school.png" },
  ];
  get selectedAvatar(): AvatarDefinition | undefined { return this.avatars.find((avatar) => avatar.id === this.selectedAvatarId); }
  get currentAnimation(): AvatarAnimation | undefined { return this.selectedAvatar?.animations[this.currentAnimationName]; }
  get currentAnimationLabel(): string { return this.animationLabels[this.currentAnimationName]; }
  get currentSpriteSheet(): string { return this.currentAnimation?.spriteSheet ?? this.selectedAvatar?.spriteSheet ?? ""; }
  get currentSpritePositionX(): string {
    const animation = this.currentAnimation;
    const columns = this.selectedAvatar?.columns ?? 6;
    return !animation || animation.spriteSheet ? "50%" : `${animation.column / Math.max(1, columns - 1) * 100}%`;
  }
  get currentCycleDuration(): string {
    const animation = this.currentAnimation;
    return animation ? `${(animation.frames / animation.fps) * 1000}ms` : "1300ms";
  }
  get currentIterationCount(): string { return this.currentAnimation?.loop === false ? "1" : "infinite"; }
  get themeClass(): string { return `theme-${this.selectedThemeId}`; }
  get mediaPlaybackVolume(): number { return this.settings.masterVolume / 100 * this.settings.mediaVolume / 100; }
  get activeRound(): PackRound | null { return this.packDraft?.rounds[this.activeRoundIndex] ?? null; }
  get availableBotAvatars(): AvatarDefinition[] { return this.avatars; }
  get offlineRound(): PackRound | null { return this.offlineGamePack?.rounds[this.offlineRoundIndex] ?? null; }
  get selectedOfflinePackSummary(): PackSummary | undefined {
    return this.offlinePackSummaries.find((pack) => pack.fileName === this.selectedOfflinePackFile);
  }
  get selectedOfflinePackIsCrowd(): boolean { return this.selectedOfflinePackSummary?.gameType === "crowd-code"; }
  get selectedOnlinePackIsCrowd(): boolean {
    return this.offlinePackSummaries.find((pack) => pack.fileName === this.onlineSelectedPackFile)?.gameType === "crowd-code";
  }
  get isCrowdGame(): boolean { return this.offlineGamePack?.gameType === "crowd-code"; }
  get crowdRound(): CrowdRound | undefined { return this.offlineGamePack?.crowdRounds?.[this.crowdRoundIndex]; }
  get crowdQuestion(): CrowdQuestion | undefined { return this.crowdRound?.questions[this.crowdQuestionIndex]; }
  get crowdRoundMultiplier(): number {
    return this.crowdRound?.kind === "double" ? 2 : this.crowdRound?.kind === "triple" ? 3 : 1;
  }
  get crowdResponder(): OfflineBot | undefined { return this.offlineBots.find((bot) => bot.id === this.crowdResponderId); }
  get crowdCurrentBigTeam(): number | null { return this.crowdBigTurnOrder[this.crowdBigTurnIndex] ?? null; }
  get crowdCurrentBigPlayer(): OfflineBot | undefined {
    const team = this.crowdCurrentBigTeam;
    return team === null ? undefined : this.offlineBots.find((bot) => bot.id === this.crowdBigPlayerIds.get(team));
  }
  crowdCaptain(team: number): OfflineBot | undefined {
    return this.offlineBots.find((bot) => bot.id === this.crowdCaptainIds.get(team));
  }
  crowdEligibleTeamMembers(team: number): OfflineBot[] {
    return this.offlineBots.filter((bot) => bot.team === team && (this.onlineRole !== "host" || bot.connected !== undefined));
  }
  isCrowdCaptain(botId: string): boolean { return [...this.crowdCaptainIds.values()].includes(botId); }
  isCrowdAnswerRevealed(answerId: string): boolean { return this.crowdRevealedAnswerIds.has(answerId); }
  crowdAnswerScore(answer: CrowdAnswer): number {
    if (this.crowdRound?.kind === "reverse") {
      const maximum = Math.max(...(this.crowdQuestion?.answers.map((candidate) => candidate.points) ?? [answer.points]));
      return Math.max(1, maximum - answer.points + 1);
    }
    return answer.points * this.crowdRoundMultiplier;
  }
  get onlineConnectedCount(): number {
    return this.onlineRoomSnapshot?.seats.filter((seat) => seat.connected).length ?? 0;
  }
  get onlineParticipantBot(): OfflineBot | undefined {
    return this.onlineSeatIndex === null ? undefined : this.offlineBots.find((bot) => bot.id === `online-seat-${this.onlineSeatIndex}`);
  }
  private onlineFinalistForSeat(seatIndex: number): OfflineBot | undefined {
    const participant = this.offlineBots.find((bot) => bot.id === `online-seat-${seatIndex}`);
    if (!participant) return undefined;
    return this.offlineTeamMode
      ? this.offlineFinalists.find((finalist) => finalist.team === participant.team)
      : this.offlineFinalists.find((finalist) => finalist.id === participant.id);
  }
  private isLocalOnlineFinalist(botId: string): boolean {
    if (this.onlineRole !== "participant" || this.onlineSeatIndex === null) return false;
    return this.onlineFinalistForSeat(this.onlineSeatIndex)?.id === botId;
  }
  canEditOfflineFinalEntry(botId: string): boolean {
    if (this.onlineRole === "participant") return this.isLocalOnlineFinalist(botId);
    return this.onlineRole !== "host";
  }
  offlineFinalWagerInputType(botId: string): "number" | "password" {
    return this.onlineRole === "participant" && this.isLocalOnlineFinalist(botId) ? "number" : this.onlineRole ? "password" : "number";
  }
  offlineFinalWagerInputValue(bot: OfflineBot): number | string {
    if (!this.onlineRole || this.isLocalOnlineFinalist(bot.id)) return this.offlineFinalWagerDrafts.get(bot.id) ?? 0;
    if (this.onlineRole === "host" && this.offlineFinalWagerDrafts.has(bot.id)) return this.offlineFinalWagerDrafts.get(bot.id) ?? 0;
    return this.offlineFinalWagers.has(bot.id) ? "********" : "";
  }
  offlineFinalAnswerInputType(botId: string): "text" | "password" {
    return this.onlineRole === "participant" && this.isLocalOnlineFinalist(botId) ? "text" : "password";
  }
  offlineFinalAnswerInputValue(botId: string): string {
    if (!this.onlineRole || this.isLocalOnlineFinalist(botId)) return this.offlineFinalAnswerDrafts.get(botId) ?? "";
    if (this.onlineRole === "host" && this.offlineFinalAnswerDrafts.has(botId)) return this.offlineFinalAnswerDrafts.get(botId) ?? "";
    return this.offlineFinalAnswers.has(botId) ? "********" : "";
  }
  get isParticipantGameView(): boolean {
    return this.offlineBotHostActive || this.onlineRole === "participant";
  }
  get scoreEditorTargetName(): string {
    const bot = this.offlineBots.find((candidate) => candidate.id === this.scoreEditorTargetId);
    return bot ? (this.offlineTeamMode ? this.offlineTeamName(bot.team) : bot.name) : "";
  }
  get offlineTeams(): OfflineTeamView[] {
    return Array.from({ length: this.offlineTeamCount }, (_, index) => {
      const number = index + 1;
      const members = this.offlineBots.filter((bot) => bot.team === number);
      return { number, name: this.offlineTeamName(number), members, score: members[0]?.score ?? 0 };
    });
  }
  get offlineQuestionColumns(): number {
    return Math.max(0, ...(this.offlineRound?.themes.map((theme) => theme.questions.length) ?? []));
  }
  get canStartOfflineGame(): boolean {
    if (this.offlineBots.length < 2 || !this.offlineGamePack) return false;
    if (this.isCrowdGame && (!this.offlineTeamMode || this.offlineTeamCount < 2 || this.offlineTeamCount > 3)) return false;
    if (!this.offlineTeamMode) return true;
    return Array.from({ length: this.offlineTeamCount }, (_, index) => index + 1)
      .every((team) => this.offlineBots.some((bot) => bot.team === team));
  }
  get offlineChooserBot(): OfflineBot | undefined {
    return this.offlineBots.find((bot) => bot.id === this.offlineChooserBotId);
  }
  get offlineHumanBot(): OfflineBot | undefined {
    return this.offlineBots.find((bot) => bot.id === this.offlineHumanBotId);
  }
  get offlineBotHostActive(): boolean {
    return this.offlineRoomMode === "bots" && Boolean(this.offlineHumanBot);
  }
  get offlineHostAvatar(): AvatarDefinition | undefined {
    if (this.onlineRole === "participant") {
      return this.avatarById(this.onlineRoomSnapshot?.config.hostAvatarId ?? "male") ?? this.selectedAvatar;
    }
    if (!this.offlineBotHostActive) return this.selectedAvatar;
    return this.avatarById("robot") ?? this.avatars.find((avatar) => avatar.id !== this.offlineHumanBot?.avatarId) ?? this.selectedAvatar;
  }
  get offlineHostName(): string {
    if (this.onlineRole === "participant") return this.onlineRoomSnapshot?.config.hostName ?? this.tr("Host", "Ведущий");
    return this.offlineBotHostActive ? this.tr("Bot host", "Бот-ведущий") : this.nickname;
  }
  get canPressOfflineHumanAction(): boolean {
    const human = this.offlineHumanBot;
    if (this.isCrowdGame) return Boolean(human && this.canCrowdBotAct(human.id));
    return Boolean(
      human
      && this.offlineGameStarted
      && !this.offlineGamePaused
      && this.offlineGamePhase === "question"
      && !["judging", "answer-reveal"].includes(this.offlineQuestionStage)
      && !this.offlineFalseStartIds.has(human.id),
    );
  }
  get offlineResponderBot(): OfflineBot | undefined {
    return this.offlineBots.find((bot) => bot.id === this.offlineResponderBotId);
  }
  get offlineCatRecipientBot(): OfflineBot | undefined {
    return this.offlineBots.find((bot) => bot.id === this.offlineCatRecipientBotId);
  }
  get offlineFinalists(): OfflineBot[] {
    return this.offlineFinalistIds
      .map((id) => this.offlineBots.find((bot) => bot.id === id))
      .filter((bot): bot is OfflineBot => Boolean(bot));
  }
  get offlineFinalTurnBot(): OfflineBot | undefined {
    const finalists = this.offlineFinalists;
    return finalists.length > 0 ? finalists[this.offlineFinalTurnIndex % finalists.length] : undefined;
  }
  get canRemoveOfflineFinalTheme(): boolean {
    if (this.offlineGamePaused || this.offlineGamePhase !== "final-themes" || this.offlineFinalThemes.length <= 1) return false;
    const turnBot = this.offlineFinalTurnBot;
    if (!turnBot) return false;
    return this.onlineRole !== "participant" || this.isLocalOnlineFinalist(turnBot.id);
  }
  get offlineFinalTheme(): PackTheme | undefined { return this.offlineFinalThemes[0]; }
  get offlineWinnerBot(): OfflineBot | undefined { return this.offlineBots.find((bot) => bot.id === this.offlineWinnerBotId); }
  get offlineWinnerTeam(): OfflineTeamView | undefined {
    return this.offlineTeamMode && this.offlineWinnerBot
      ? this.offlineTeams.find((team) => team.number === this.offlineWinnerBot?.team)
      : undefined;
  }
  get offlineHotseatContestants(): HotseatContestant[] {
    if (this.offlineTeamMode) {
      return this.offlineTeams
        .filter((team) => team.members.length > 0)
        .map((team) => {
          const crowdPlayer = this.crowdGamePhase === "big-play"
            ? team.members.find((member) => member.id === this.crowdBigPlayerIds.get(team.number))
            : this.crowdCaptain(team.number);
          return { key: `team-${team.number}`, label: team.name, bot: this.isCrowdGame ? crowdPlayer ?? team.members[0] : team.members[0] };
        });
    }
    return this.offlineBots.map((bot) => ({ key: bot.id, label: bot.name, bot }));
  }
  get canUseRoomCommunication(): boolean {
    if (!this.isCrowdGame || this.crowdGamePhase !== "big-play") return true;
    if (this.onlineRole === "host" || (this.offlineRoomMode === "hotseat" && !this.onlineRole)) return true;
    const participantId = this.onlineRole === "participant" ? this.onlineParticipantBot?.id : this.offlineHumanBotId ?? undefined;
    return Boolean(participantId && [...this.crowdBigPlayerIds.values()].includes(participantId));
  }
  get offlineQuestionValue(): number {
    const question = this.offlineSelectedQuestion;
    if (!question) return 0;
    return question.isCatInBag ? question.catValue ?? question.value ?? 0 : question.value ?? 0;
  }
  get canSkipOfflineQuestion(): boolean {
    return !this.isCrowdGame && !this.isParticipantGameView && this.offlineGameStarted && !this.offlineGamePaused && this.offlineGamePhase === "question";
  }
  get canSkipOfflineRound(): boolean {
    return !this.isCrowdGame && !this.isParticipantGameView
      && this.offlineGameStarted
      && !this.offlineGamePaused
      && ["round-title", "themes", "chooser", "board", "question"].includes(this.offlineGamePhase);
  }
  get canRewindOfflineGame(): boolean {
    return !this.isParticipantGameView
      && this.offlineGameStarted
      && !this.offlineGamePaused
      && !this.offlineIsFinalQuestion
      && this.offlineQuestionCheckpoint !== null
      && ["board", "question"].includes(this.offlineGamePhase);
  }
  get offlineQuestionTextSize(): string {
    const length = [...(this.offlineSelectedQuestion?.text.trim() ?? "")].length;
    if (length > 700) return "clamp(.68rem, 1.05vw, 1rem)";
    if (length > 420) return "clamp(.78rem, 1.25vw, 1.15rem)";
    if (length > 240) return "clamp(.9rem, 1.55vw, 1.4rem)";
    if (length > 120) return "clamp(1rem, 2vw, 1.7rem)";
    return "clamp(1.2rem, 2.8vw, 2.35rem)";
  }
  get offlineQuestionTextParked(): boolean {
    return Boolean(
      ["question", "final-question", "final-answers"].includes(this.offlineGamePhase)
      &&
      this.offlineSelectedQuestion?.text.trim()
      && this.offlineSelectedQuestion.media
      && ["media", "answering", "judging"].includes(this.offlineQuestionStage),
    );
  }
  get offlineHostAnswerVisible(): boolean {
    return Boolean(
      !this.isParticipantGameView
      &&
      this.offlineSelectedQuestion?.answerText.trim()
      && ["question", "final-question", "final-answers"].includes(this.offlineGamePhase),
    );
  }
  get offlineRoundHasQuestions(): boolean {
    return this.offlineRound?.themes.some((theme) =>
      theme.questions.some((question) => !this.offlineAnsweredQuestionIds.has(question.id)),
    ) === true;
  }
  t(key: TranslationKey): string { return translations[this.settings.language][key]; }
  tr(english: string, russian: string): string { return this.settings.language === "ru" ? russian : english; }
  packTypeLabel(type: PackGameType): string {
    return type === "topic-clash" ? this.tr("Topic Clash", "Битва тем") : this.tr("Crowd Code", "Глас толпы");
  }
  packTagLabel(tag: PackTag): string {
    const labels: Record<PackTag, [string, string]> = {
      "people-society": ["People, society", "Человек, общество"],
      "nature-universe": ["Nature, universe", "Природа, мироздание"],
      "technology-inventions": ["Technology, inventions", "Технологии, изобретения"],
      "art-culture": ["Art, culture", "Искусство, культура"],
      "mass-media-entertainment": ["Mass media, entertainment", "Масс-медиа, развлечения"],
      "sport-activity": ["Sport, activity", "Спорт, активность"],
      "economy-business": ["Economy, business", "Экономика, бизнес"],
      "logic-abstraction": ["Logic, abstraction", "Логика, абстракция"],
    };
    const [english, russian] = labels[tag];
    return this.tr(english, russian);
  }
  packTagsLabel(tags: PackTag[]): string {
    return tags.length > 0
      ? tags.map((tag) => this.packTagLabel(tag)).join(" · ")
      : this.tr("No tags", "Без тегов");
  }
  formatPackDate(value: string): string {
    if (!value) return "—";
    return new Intl.DateTimeFormat(this.settings.language === "ru" ? "ru-RU" : "en-US", {
      dateStyle: "medium", timeStyle: "short",
    }).format(new Date(value));
  }
  menuLabel(action: MenuAction): string { return this.t(action); }
  avatarById(id: AvatarDefinition["id"]): AvatarDefinition | undefined { return this.avatars.find((avatar) => avatar.id === id); }
  offlineBotAnimation(botId: string): AvatarAnimationName { return this.offlineBotAnimations.get(botId) ?? "idle"; }
  arenaSpriteSheet(avatar: AvatarDefinition, animationName: AvatarAnimationName): string {
    return avatar.animations[animationName].spriteSheet ?? avatar.spriteSheet;
  }
  arenaSpritePosition(avatar: AvatarDefinition, animationName: AvatarAnimationName): string {
    const animation = avatar.animations[animationName];
    const columns = avatar.columns ?? 6;
    return animation.spriteSheet ? "50%" : `${animation.column / Math.max(1, columns - 1) * 100}%`;
  }
  arenaAnimationDuration(avatar: AvatarDefinition, animationName: AvatarAnimationName): string {
    const animation = avatar.animations[animationName];
    return `${Math.max(250, animation.frames / animation.fps * 1000)}ms`;
  }
  arenaAnimationIterations(avatar: AvatarDefinition, animationName: AvatarAnimationName): string {
    return avatar.animations[animationName].loop ? "infinite" : "1";
  }
  offlineBotAnimationIterations(avatar: AvatarDefinition, botId: string): string {
    const bot = this.offlineBots.find((candidate) => candidate.id === botId);
    const isWinner = this.offlineTeamMode
      ? Boolean(bot && this.offlineWinnerBot && bot.team === this.offlineWinnerBot.team)
      : botId === this.offlineWinnerBotId;
    if (this.offlineGamePhase === "winner" && isWinner) return "infinite";
    return this.arenaAnimationIterations(avatar, this.offlineBotAnimation(botId));
  }
  offlineFinalWager(botId: string): number { return this.offlineFinalWagers.get(botId) ?? 0; }
  offlineFinalAnswer(botId: string): string { return this.offlineFinalAnswers.get(botId) ?? ""; }
  offlineTeamName(team: number): string {
    return this.offlineTeamNames[team - 1]?.trim() || this.tr(`Team ${team}`, `Команда ${team}`);
  }
  setOfflineTeamName(team: number, value: string): void { this.offlineTeamNames[team - 1] = value.slice(0, 32); }
  offlineContestantName(bot: OfflineBot): string { return this.offlineTeamMode ? this.offlineTeamName(bot.team) : bot.name; }
  offlineTeamScore(team: number): number { return this.offlineBots.find((bot) => bot.team === team)?.score ?? 0; }
  offlineTeamRepresentative(team: number): OfflineBot | undefined { return this.offlineBots.find((bot) => bot.team === team); }
  offlineAnswerKey(bot: OfflineBot): string { return this.offlineAnswerKeys.get(this.offlineTeamMode ? `team-${bot.team}` : bot.id) ?? ""; }
  offlineVoiceLevel(participantId: "host" | string): number {
    if (participantId === "host" && this.settings.pushToTalk && !this.isPushToTalkPressed) return 0;
    if (this.offlineAuraBoosts.has(participantId)) return 100;
    if (this.offlineBotHostActive) {
      if (participantId === "host") return 0;
      if (participantId === this.offlineHumanBotId) return this.settings.pushToTalk && !this.isPushToTalkPressed ? 0 : this.microphoneLevel;
    }
    return participantId === "host"
      ? this.microphoneLevel
      : (this.offlineParticipantMicrophoneLevels.get(participantId) ?? 0);
  }
  voiceAuraBlur(participantId: "host" | string): string {
    const level = this.offlineVoiceLevel(participantId) / 100;
    return `${Math.round(level * 30)}px`;
  }
  voiceAuraOpacity(participantId: "host" | string): string {
    const level = this.offlineVoiceLevel(participantId) / 100;
    return Math.min(.9, level * 1.15).toFixed(2);
  }
  setOfflineParticipantMicrophoneLevel(participantId: string, level: number): void {
    this.offlineParticipantMicrophoneLevels.set(participantId, Math.max(0, Math.min(100, level)));
  }
  offlineRoomMessage(participantId: "host" | string): string {
    return this.offlineRoomMessages.get(participantId) ?? "";
  }
  isOfflineBotEliminated(bot: OfflineBot): boolean {
    if (this.offlineGamePhase === "winner") return this.offlineTeamMode
      ? bot.team !== this.offlineWinnerBot?.team
      : bot.id !== this.offlineWinnerBotId;
    const isFinalist = this.offlineTeamMode
      ? this.offlineFinalists.some((finalist) => finalist.team === bot.team)
      : this.offlineFinalistIds.includes(bot.id);
    return ["final-elimination", "final-themes", "final-wager", "final-question", "final-answers"].includes(this.offlineGamePhase)
      && !isFinalist;
  }

  ngOnInit(): void {
    if (!isTauri()) throw new Error("Mind Jam can only run as a Tauri desktop application");
    this.loadSettings();
    void invoke<NativeBuildInfo>("get_build_info")
      .then((buildInfo) => { this.requiresSystemGstreamer = buildInfo.requiresSystemGstreamer; })
      .catch(() => { this.requiresSystemGstreamer = false; });
    void invoke("set_output_device", { deviceId: this.settings.outputDeviceId }).catch(() => undefined);
    this.selectedAvatarId = localStorage.getItem(this.selectedAvatarStorageKey) ?? "male";
    this.nickname = localStorage.getItem(this.nicknameStorageKey) ?? this.tr("Player", "Игрок");
    const savedTheme = localStorage.getItem(this.selectedThemeStorageKey);
    if (this.themes.some((theme) => theme.id === savedTheme)) this.selectedThemeId = savedTheme as ThemeDefinition["id"];
    this.http.get<AvatarCatalog>("assets/avatars/avatars.json").subscribe({
      next: (catalog) => {
        this.avatars = catalog.avatars;
        if (!this.selectedAvatar) this.selectedAvatarId = catalog.avatars[0]?.id ?? "male";
      },
      error: () => { this.feedback = "Unable to load avatars"; },
    });
    this.startMusic();
    void this.loadDisplays(true);
    document.addEventListener("click", this.handleGlobalButtonClick);
    document.addEventListener("play", this.handleMediaPlay, true);
    window.addEventListener("keydown", this.handleGameActionKey);
    window.addEventListener("keyup", this.handlePushToTalkKeyUp);
    window.addEventListener("blur", this.handlePushToTalkBlur);
    void listen<OnlineRoomEvent>("p2p-room-event", (event) => {
      this.ngZone.run(() => this.handleOnlineRoomEvent(event.payload));
    })
      .then((unlisten) => { this.unlistenP2pRoom = unlisten; });
  }

  ngOnDestroy(): void {
    this.stopQuestionTimerSound(false);
    this.stopMusic();
    this.stopMicrophoneTest();
    this.clearOfflineRoomMessages();
    document.removeEventListener("click", this.handleGlobalButtonClick);
    document.removeEventListener("play", this.handleMediaPlay, true);
    window.removeEventListener("keydown", this.handleGameActionKey);
    window.removeEventListener("keyup", this.handlePushToTalkKeyUp);
    window.removeEventListener("blur", this.handlePushToTalkBlur);
    this.unlistenP2pRoom?.();
    this.unlistenP2pRoom = null;
    this.stopOnlineGameSync();
    this.clearOnlineParticipantQuestionTyping();
    void invoke("close_p2p_room").catch(() => undefined);
    this.clearOfflineGameTimers();
    this.clearOfflineMediaSource();
  }

  chooseAction(action: MenuAction): void {
    this.playClick();
    if (action === "online") {
      this.onlineFeedback = "";
      this.view = "online-mode";
      return;
    }
    if (action === "offline") {
      this.offlineFeedback = "";
      this.view = "offline-mode";
      return;
    }
    if (action === "packs") {
      void this.openPacks();
      return;
    }
    if (action === "themes") {
      this.view = "themes";
      this.feedback = "";
      return;
    }
    if (action !== "avatars") this.startMusic();
    if (action === "avatars") {
      this.view = "avatars";
      this.currentAnimationName = "idle";
      this.feedback = "";
      return;
    }
    this.feedback = `${this.menuLabel(action)} — ${this.settings.language === "ru" ? "скоро" : "coming soon"}`;
  }

  async openOnlineCreate(): Promise<void> {
    this.onlineRoomName = this.tr(`${this.nickname}'s room`, `Комната ${this.nickname}`);
    this.onlineMaxParticipants = 6;
    this.onlineTeamMode = false;
    this.onlineTeamCount = 2;
    this.onlineFeedback = "";
    await this.loadOnlinePackChoices();
    this.view = "online-create";
  }

  openOnlineJoin(): void {
    this.onlineJoinConnectionString = "";
    this.onlineFeedback = "";
    this.view = "online-join";
  }

  setOnlineTeamCount(raw: string): void {
    this.onlineTeamCount = Math.min(this.selectedOnlinePackIsCrowd ? 3 : 4, Math.max(2, Number(raw) || 2));
  }

  selectOnlinePack(fileName: string): void {
    this.onlineSelectedPackFile = fileName;
    if (this.selectedOnlinePackIsCrowd) {
      this.onlineTeamMode = true;
      this.onlineTeamCount = Math.min(3, Math.max(2, this.onlineTeamCount));
    }
  }

  private async loadOnlinePackChoices(): Promise<void> {
    try {
      const listing = await this.packStorage.list();
      this.offlinePackSummaries = listing.packs;
      if (!listing.packs.some((pack) => pack.fileName === this.onlineSelectedPackFile)) {
        this.onlineSelectedPackFile = listing.packs[0]?.fileName ?? "";
      }
      this.selectOnlinePack(this.onlineSelectedPackFile);
    } catch {
      this.offlinePackSummaries = [];
      this.onlineSelectedPackFile = "";
      this.onlineFeedback = this.tr("Unable to read the packs folder", "Не удалось прочитать папку паков");
    }
  }

  async createOnlineRoom(): Promise<void> {
    if (this.onlineBusy || !this.onlineRoomName.trim() || !this.onlineSelectedPackFile) return;
    this.onlineBusy = true;
    this.onlineFeedback = this.tr("Creating a secure P2P room…", "Создаём защищённую P2P-комнату…");
    try {
      const pack = await this.packStorage.load(this.onlineSelectedPackFile);
      this.normalizePackQuestions(pack);
      const crowdGame = pack.gameType === "crowd-code";
      const result = await invoke<HostOnlineRoomResult>("host_p2p_room", {
        config: {
          roomName: this.onlineRoomName.trim(),
          hostName: this.nickname,
          hostAvatarId: this.selectedAvatar?.id ?? "male",
          maxParticipants: this.onlineMaxParticipants,
          teamMode: crowdGame ? true : this.onlineTeamMode,
          teamCount: crowdGame ? Math.min(3, this.onlineTeamCount) : this.onlineTeamCount,
          gameType: pack.gameType,
          packFileName: this.onlineSelectedPackFile,
          pack,
        },
      });
      this.onlineRole = "host";
      this.onlineConnectionString = result.connectionString;
      this.onlineDownloadedPack = pack;
      this.onlineRoomSnapshot = result.snapshot;
      this.onlineInfoOpen = false;
      this.onlineFeedback = "";
      this.view = "online-room";
    } catch {
      this.onlineFeedback = this.tr("Unable to create the P2P room", "Не удалось создать P2P-комнату");
    } finally {
      this.onlineBusy = false;
    }
  }

  async joinOnlineRoom(): Promise<void> {
    if (this.onlineBusy || !this.onlineJoinConnectionString.trim()) return;
    this.onlineBusy = true;
    this.onlineFeedback = this.tr("Connecting and preparing the game pack…", "Подключаемся и подготавливаем игровой пак…");
    const reconnectKey = `mind-jam.p2p-reconnect.${this.onlineJoinConnectionString.trim().slice(-48)}`;
    try {
      const result = await invoke<JoinOnlineRoomResult>("join_p2p_room", {
        connectionString: this.onlineJoinConnectionString.trim(),
        name: this.nickname,
        avatarId: this.selectedAvatar?.id ?? "male",
        reconnectToken: localStorage.getItem(reconnectKey),
      });
      this.onlineReconnectToken = result.reconnectToken;
      localStorage.setItem(reconnectKey, result.reconnectToken);
      this.onlineRole = "participant";
      this.onlineRoomSnapshot = result.snapshot;
      this.normalizePackQuestions(result.gamePack);
      this.onlineDownloadedPack = result.gamePack;
      this.onlineSeatIndex = result.seatIndex;
      this.onlineFeedback = result.packCacheHit
        ? this.tr("Game pack loaded from the temporary cache", "Игровой пак загружен из временного кэша")
        : this.tr("Game pack received from the host", "Игровой пак получен от ведущего");
      this.view = "online-room";
      if (result.snapshot.gameStarted && result.seatIndex !== null && result.snapshot.gameState) {
        this.applyOnlineGameState(result.snapshot.gameState);
      }
    } catch {
      this.onlineFeedback = this.tr("Unable to connect. Check the connection string.", "Не удалось подключиться. Проверьте строку подключения.");
    } finally {
      this.onlineBusy = false;
    }
  }

  async claimOnlineSeat(index: number): Promise<void> {
    if (this.onlineRole !== "participant" || this.onlineBusy) return;
    this.onlineBusy = true;
    try {
      await invoke("claim_p2p_seat", { seatIndex: index });
      this.onlineSeatIndex = index;
      this.onlineFeedback = "";
    } catch {
      this.onlineFeedback = this.tr("This table is unavailable", "Этот стол недоступен");
    } finally {
      this.onlineBusy = false;
    }
  }

  onlineTeamSeats(team: number): OnlineRoomSeat[] {
    return this.onlineRoomSnapshot?.seats.filter((seat) => seat.team === team) ?? [];
  }

  async copyOnlineConnectionString(): Promise<void> {
    if (!this.onlineConnectionString) return;
    try {
      await navigator.clipboard.writeText(this.onlineConnectionString);
      this.onlineFeedback = this.tr("Connection string copied", "Строка подключения скопирована");
    } catch {
      this.onlineFeedback = this.tr("Unable to copy", "Не удалось скопировать");
    }
  }

  async exitOnlineRoom(): Promise<void> {
    this.stopOnlineGameSync();
    this.clearOnlineParticipantQuestionTyping();
    await invoke("close_p2p_room").catch(() => undefined);
    this.resetLocalOnlineRoom();
  }

  private resetLocalOnlineRoom(): void {
    if (this.offlineGamePack) this.exitOfflineGame();
    this.onlineRole = null;
    this.onlineRoomSnapshot = null;
    this.onlineDownloadedPack = null;
    this.onlineSeatIndex = null;
    this.onlineInfoOpen = false;
    this.view = "online-mode";
  }

  private async leaveRoomClosedByHost(): Promise<void> {
    this.stopOnlineGameSync();
    this.clearOnlineParticipantQuestionTyping();
    this.resetLocalOnlineRoom();
    await invoke("acknowledge_p2p_room_closed").catch(() => undefined);
    await invoke("close_p2p_room").catch(() => undefined);
  }

  async startHostedOnlineGame(): Promise<void> {
    const room = this.onlineRoomSnapshot;
    if (this.onlineRole !== "host" || !room || this.onlineConnectedCount < 1 || this.onlineBusy) return;
    this.onlineBusy = true;
    this.offlineRoomMode = "hotseat";
    this.offlineHumanBotId = null;
    this.offlineTeamMode = room.config.teamMode;
    this.offlineTeamCount = room.config.teamCount;
    this.offlineBots = room.seats.map((seat) => ({
      id: `online-seat-${seat.index}`,
      name: seat.name ?? this.tr(`Empty table ${seat.index + 1}`, `Свободный стол ${seat.index + 1}`),
      avatarId: seat.avatarId ?? this.randomBotAvatarId(),
      score: seat.score,
      team: seat.team,
      connected: seat.name === null ? undefined : seat.connected,
    }));
    this.selectedOfflinePackFile = room.config.packFileName;
    await this.startOfflineBotsGame();
    if (!this.offlineGamePack) {
      this.onlineBusy = false;
      return;
    }
    this.startOfflineGame();
    await this.publishOnlineGameState();
    this.stopOnlineGameSync();
    this.onlineGameSyncTimer = setInterval(() => void this.publishOnlineGameState(), 500);
    this.onlineBusy = false;
  }

  private handleOnlineRoomEvent(event: OnlineRoomEvent): void {
    if (event.snapshot) {
      this.onlineRoomSnapshot = event.snapshot;
      if (this.onlineRole === "host" && event.snapshot.gameStarted) {
        for (const seat of event.snapshot.seats) {
          const bot = this.offlineBots.find((candidate) => candidate.id === `online-seat-${seat.index}`);
          if (bot) {
            if (seat.name) bot.name = seat.name;
            if (seat.avatarId) bot.avatarId = seat.avatarId;
            bot.connected = seat.name === null ? undefined : seat.connected;
          }
        }
      }
      if (this.onlineRole === "participant" && this.onlineSeatIndex !== null && event.snapshot.gameStarted && event.snapshot.gameState) {
        this.applyOnlineGameState(event.snapshot.gameState);
      }
    }
    if (this.onlineRole === "host" && event.seatIndex !== undefined) {
      const botId = `online-seat-${event.seatIndex}`;
      if (event.kind === "action") this.triggerOfflineAction(botId);
      else if (event.kind === "chat" && event.message && (!this.isCrowdGame || this.crowdGamePhase !== "big-play" || [...this.crowdBigPlayerIds.values()].includes(botId))) this.showOfflineRoomMessage(botId, event.message);
      else if (event.kind === "selectQuestion" && event.questionId && this.offlineChooserBotId === botId) {
        const question = this.offlineRound?.themes.flatMap((theme) => theme.questions).find((item) => item.id === event.questionId);
        if (question) this.selectOfflineQuestion(question);
      } else if (event.kind === "removeFinalTheme" && event.questionId) {
        const finalist = this.onlineFinalistForSeat(event.seatIndex);
        if (finalist?.id === this.offlineFinalTurnBot?.id && this.offlineFinalThemes.some((theme) => theme.id === event.questionId)) {
          this.removeOfflineFinalTheme(event.questionId);
          void this.publishOnlineGameState();
        }
      } else if (event.kind === "submitFinalWager" && event.message !== undefined) {
        const finalist = this.onlineFinalistForSeat(event.seatIndex);
        if (finalist && this.offlineGamePhase === "final-wager" && !this.offlineFinalWagers.has(finalist.id)) {
          this.setOfflineFinalWagerDraft(finalist, event.message);
          this.confirmOfflineFinalWager(finalist);
          void this.publishOnlineGameState();
        }
      } else if (event.kind === "submitFinalAnswer" && event.message !== undefined) {
        const finalist = this.onlineFinalistForSeat(event.seatIndex);
        if (finalist && this.offlineGamePhase === "final-answers" && !this.offlineFinalAnswers.has(finalist.id)) {
          this.setOfflineFinalAnswerDraft(finalist.id, event.message);
          this.confirmOfflineFinalAnswer(finalist.id);
          void this.publishOnlineGameState();
        }
      } else if (event.kind === "crowdBigDecision" && event.message !== undefined && event.questionId) {
        const participant = this.offlineBots.find((bot) => bot.id === botId);
        if (participant && this.crowdCaptainIds.get(participant.team) === participant.id) {
          this.acceptCrowdBigDecision(participant.team, Math.max(0, Math.round(Number(event.message) || 0)), event.questionId);
        }
      }
    }
    if (event.kind === "participantDisconnected" && this.onlineRole === "host" && this.onlineRoomSnapshot?.gameStarted) {
      if (!this.offlineGamePaused && this.view === "offline-game") this.toggleOfflinePause();
      void invoke("update_hosted_room", {
        gameStarted: true,
        paused: true,
        gameState: this.buildOnlineGameState(),
        seatScores: this.onlineRoomSnapshot.seats.map((seat) => seat.score),
      }).catch(() => undefined);
    } else if (event.kind === "roomClosed" && this.onlineRole === "participant") {
      void this.leaveRoomClosedByHost();
    } else if (event.kind === "hostDisconnected") {
      this.clearOnlineParticipantQuestionTyping();
      this.onlineFeedback = this.tr("Connection to the host was lost. You can reconnect with the same connection string.", "Связь с ведущим потеряна. Можно переподключиться по той же строке подключения.");
      this.view = "online-room";
    } else if (event.kind === "error" && event.message) {
      this.onlineFeedback = event.message;
      if (this.view === "online-room" && this.onlineRole === "participant") this.onlineSeatIndex = null;
    }
  }

  sendOnlineAction(): void {
    const bot = this.onlineParticipantBot;
    if (this.onlineRole !== "participant" || !bot || this.offlineFalseStartIds.has(bot.id)) return;
    if (this.isCrowdGame) {
      if (!this.canCrowdBotAct(bot.id)) return;
      this.pulseOfflineAction(bot.id);
      void invoke("send_p2p_action").catch(() => {
        this.onlineFeedback = this.tr("Unable to send the answer signal", "Не удалось отправить сигнал ответа");
      });
      return;
    }
    this.pulseOfflineAction(bot.id);
    if (this.offlineQuestionStage !== "answering") this.lockOfflineFalseStart(bot.id);
    void invoke("send_p2p_action").catch(() => {
      this.onlineFeedback = this.tr("Unable to send the answer signal", "Не удалось отправить сигнал ответа");
    });
  }

  selectOnlineQuestion(question: PackQuestion): void {
    if (this.onlineRole === "participant") {
      if (this.onlineParticipantBot?.id !== this.offlineChooserBotId || this.offlineGamePhase !== "board") return;
      void invoke("send_p2p_question_selection", { questionId: question.id }).catch(() => undefined);
      return;
    }
    this.selectOfflineQuestion(question);
  }

  private buildOnlineGameState(): OnlineGameState | null {
    if (!this.offlineGamePack) return null;
    const finalWagers = this.onlineRole === "host"
      ? [...this.offlineFinalWagers.keys()].map((botId): [string, number] => [botId, 0])
      : [...this.offlineFinalWagers];
    const finalAnswers = this.onlineRole === "host" && !this.offlineFinalAnswersVisible
      ? [...this.offlineFinalAnswers.keys()].map((botId): [string, string] => [botId, ""])
      : [...this.offlineFinalAnswers];
    return {
      bots: this.offlineBots, teamMode: this.offlineTeamMode,
      teamCount: this.offlineTeamCount, gameStarted: this.offlineGameStarted,
      paused: this.offlineGamePaused, phase: this.offlineGamePhase, roundIndex: this.offlineRoundIndex,
      chooserBotId: this.offlineChooserBotId, selectionSeconds: this.offlineSelectionSeconds,
      selectedQuestionId: this.offlineSelectedQuestion?.id ?? null, questionStage: this.offlineQuestionStage,
      typedQuestionText: this.offlineTypedQuestionText, questionMediaVisible: this.offlineQuestionMediaVisible,
      answerSeconds: this.offlineAnswerSeconds, responderBotId: this.offlineResponderBotId,
      lastWrongBotId: this.offlineLastWrongBotId, pendingJudgeResolution: this.offlinePendingJudgeResolution,
      catRecipientBotId: this.offlineCatRecipientBotId, hostAnimation: this.offlineHostAnimation,
      botAnimations: [...this.offlineBotAnimations], roomMessages: [...this.offlineRoomMessages],
      answeredQuestionIds: [...this.offlineAnsweredQuestionIds],
      finalThemeIds: this.offlineFinalThemes.map((theme) => theme.id), finalistIds: this.offlineFinalistIds,
      finalTurnIndex: this.offlineFinalTurnIndex, finalSeconds: this.offlineFinalSeconds,
      finalWagersVisible: this.offlineFinalWagersVisible, finalAnswersVisible: this.offlineFinalAnswersVisible,
      isFinalQuestion: this.offlineIsFinalQuestion, finalWagers,
      finalAnswers, finalJudgements: [...this.offlineFinalJudgements],
      winnerBotId: this.offlineWinnerBotId,
      crowd: this.buildCrowdOnlineState(),
    };
  }

  private buildCrowdOnlineState(): CrowdOnlineState | null {
    if (!this.isCrowdGame) return null;
    return {
      phase: this.crowdGamePhase, roundIndex: this.crowdRoundIndex, questionIndex: this.crowdQuestionIndex,
      captainIds: [...this.crowdCaptainIds], revealedAnswerIds: [...this.crowdRevealedAnswerIds],
      activeTeam: this.crowdActiveTeam, roundPot: this.crowdRoundPot, misses: this.crowdMisses,
      responderId: this.crowdResponderId, roundWinnerTeam: this.crowdRoundWinnerTeam,
      bigWagers: [...this.crowdBigWagers], bigPlayerIds: [...this.crowdBigPlayerIds],
      bigConfirmedTeams: [...this.crowdBigConfirmedTeams], bigTurnOrder: this.crowdBigTurnOrder,
      bigTurnIndex: this.crowdBigTurnIndex, bigPoints: [...this.crowdBigPoints],
    };
  }

  private async publishOnlineGameState(): Promise<void> {
    if (this.onlineRole !== "host" || this.onlineApplyingSnapshot) return;
    const state = this.buildOnlineGameState();
    if (!state) return;
    await invoke("update_hosted_room", {
      gameStarted: this.offlineGameStarted,
      paused: this.offlineGamePaused,
      gameState: state,
      seatScores: this.offlineBots.map((bot) => bot.score),
    }).catch(() => undefined);
  }

  private applyOnlineGameState(value: unknown): void {
    const state = value as OnlineGameState;
    if (!this.onlineDownloadedPack || !Array.isArray(state?.bots)) return;
    const keepSettingsOpen = this.view === "settings" && this.settingsReturnView === "offline-game";
    this.onlineApplyingSnapshot = true;
    this.clearOfflineGameTimers();
    const selectedQuestionIdBefore = this.offlineSelectedQuestion?.id ?? null;
    const mediaKeyBefore = `${selectedQuestionIdBefore ?? ""}:${this.offlineQuestionMediaVisible}`;
    const mediaStageBefore = this.offlineQuestionStage;
    const gamePhaseBefore = this.offlineGamePhase;
    const wasPaused = this.offlineGamePaused;
    this.offlineGamePack = this.onlineDownloadedPack;
    this.offlineBots = state.bots;
    this.offlineRoomMode = "hotseat";
    this.offlineHumanBotId = this.onlineSeatIndex === null ? null : `online-seat-${this.onlineSeatIndex}`;
    this.offlineTeamMode = state.teamMode;
    this.offlineTeamCount = state.teamCount;
    this.offlineGameStarted = state.gameStarted;
    this.offlineGamePaused = state.paused;
    this.offlineGamePhase = state.phase;
    if (gamePhaseBefore !== state.phase && state.phase === "final-wager") this.offlineFinalWagerDrafts.clear();
    if (gamePhaseBefore !== state.phase && state.phase === "final-answers") this.offlineFinalAnswerDrafts.clear();
    this.offlineRoundIndex = state.roundIndex;
    this.offlineChooserBotId = state.chooserBotId;
    this.offlineSelectionSeconds = state.selectionSeconds;
    this.offlineSelectedQuestion = this.findOnlinePackQuestion(state.selectedQuestionId);
    this.offlineQuestionStage = state.questionStage;
    const selectedQuestionId = this.offlineSelectedQuestion?.id ?? null;
    if (this.onlineParticipantTypingQuestionId && this.onlineParticipantTypingQuestionId !== selectedQuestionId) {
      this.clearOnlineParticipantQuestionTyping();
    }
    const canStartLocalQuestionTyping = this.offlineSelectedQuestion
      && !["cat-announcement", "cat-recipient", "cat-transfer", "answer-reveal"].includes(state.questionStage);
    if (!this.offlineSelectedQuestion) {
      this.clearOnlineParticipantQuestionTyping();
      this.offlineTypedQuestionText = "";
    } else if (canStartLocalQuestionTyping && this.onlineParticipantTypingQuestionId !== selectedQuestionId) {
      this.startOnlineParticipantQuestionTyping(this.offlineSelectedQuestion);
    } else if (this.onlineParticipantTypingQuestionId === selectedQuestionId) {
      if (!this.onlineParticipantTypingTimer) this.offlineTypedQuestionText = this.offlineSelectedQuestion.text.trim();
    } else {
      this.offlineTypedQuestionText = "";
    }
    this.offlineQuestionMediaVisible = state.questionMediaVisible;
    this.offlineAnswerSeconds = state.answerSeconds;
    this.offlineResponderBotId = state.responderBotId;
    this.offlineLastWrongBotId = state.lastWrongBotId;
    this.offlinePendingJudgeResolution = state.pendingJudgeResolution;
    this.offlineCatRecipientBotId = state.catRecipientBotId;
    this.offlineHostAnimation = state.hostAnimation;
    this.replaceMap(this.offlineBotAnimations, state.botAnimations);
    this.replaceMap(this.offlineRoomMessages, state.roomMessages);
    this.replaceSet(this.offlineAnsweredQuestionIds, state.answeredQuestionIds);
    this.offlineFinalThemes = state.finalThemeIds
      .map((id) => this.onlineDownloadedPack?.finalThemes.find((theme) => theme.id === id))
      .filter((theme): theme is PackTheme => Boolean(theme));
    this.offlineFinalistIds = state.finalistIds;
    this.offlineFinalTurnIndex = state.finalTurnIndex;
    this.offlineFinalSeconds = state.finalSeconds;
    this.offlineFinalWagersVisible = state.finalWagersVisible;
    this.offlineFinalAnswersVisible = state.finalAnswersVisible;
    this.offlineIsFinalQuestion = state.isFinalQuestion;
    this.replaceMap(this.offlineFinalWagers, state.finalWagers);
    this.replaceMap(this.offlineFinalAnswers, state.finalAnswers);
    this.replaceMap(this.offlineFinalJudgements, state.finalJudgements);
    this.offlineWinnerBotId = state.winnerBotId;
    if (state.crowd && this.isCrowdGame) this.applyCrowdOnlineState(state.crowd);
    const mediaKeyAfter = `${this.offlineSelectedQuestion?.id ?? ""}:${this.offlineQuestionMediaVisible}`;
    if (mediaKeyAfter !== mediaKeyBefore) {
      this.clearOfflineMediaSource();
      if (this.offlineQuestionMediaVisible && this.offlineSelectedQuestion?.media) {
        this.offlineQuestionMediaUrl = this.createMediaObjectUrl(this.offlineSelectedQuestion.media);
      }
    }
    if (state.paused || (mediaStageBefore === "media" && state.questionStage !== "media")) {
      document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video").forEach((media) => media.pause());
    } else if (wasPaused && !state.paused && state.questionStage === "media") {
      setTimeout(() => document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video")
        .forEach((media) => void media.play().catch(() => undefined)));
    }
    if (!keepSettingsOpen) this.view = "offline-game";
    this.onlineApplyingSnapshot = false;
  }

  private applyCrowdOnlineState(state: CrowdOnlineState): void {
    this.crowdGamePhase = state.phase;
    this.crowdRoundIndex = state.roundIndex;
    this.crowdQuestionIndex = state.questionIndex;
    this.replaceMap(this.crowdCaptainIds, state.captainIds);
    this.replaceSet(this.crowdRevealedAnswerIds, state.revealedAnswerIds);
    this.crowdActiveTeam = state.activeTeam;
    this.crowdRoundPot = state.roundPot;
    this.crowdMisses = state.misses;
    this.crowdResponderId = state.responderId;
    this.crowdRoundWinnerTeam = state.roundWinnerTeam;
    this.replaceMap(this.crowdBigWagers, state.bigWagers);
    this.replaceMap(this.crowdBigPlayerIds, state.bigPlayerIds);
    this.replaceSet(this.crowdBigConfirmedTeams, state.bigConfirmedTeams);
    this.crowdBigTurnOrder = [...state.bigTurnOrder];
    this.crowdBigTurnIndex = state.bigTurnIndex;
    this.replaceMap(this.crowdBigPoints, state.bigPoints);
    if (!this.canUseRoomCommunication) {
      this.offlineChatOpen = false;
      this.offlineChatDraft = "";
      this.isPushToTalkPressed = false;
      this.stopMicrophoneTest();
    }
  }

  private startOnlineParticipantQuestionTyping(question: PackQuestion): void {
    this.clearOnlineParticipantQuestionTyping();
    const questionId = question.id;
    const text = question.text.trim();
    let index = 0;
    this.onlineParticipantTypingQuestionId = questionId;
    this.offlineTypedQuestionText = "";
    const revealNext = () => {
      if (this.offlineSelectedQuestion?.id !== questionId) {
        this.clearOnlineParticipantQuestionTyping();
        return;
      }
      if (this.offlineGamePaused) return;
      index += 1;
      this.offlineTypedQuestionText = text.slice(0, index);
      if (index >= text.length && this.onlineParticipantTypingTimer) {
        clearInterval(this.onlineParticipantTypingTimer);
        this.onlineParticipantTypingTimer = null;
      }
    };
    if (!text) return;
    revealNext();
    if (index < text.length) {
      this.onlineParticipantTypingTimer = setInterval(revealNext, QUESTION_TYPING_INTERVAL_MS);
    }
  }

  private clearOnlineParticipantQuestionTyping(): void {
    if (this.onlineParticipantTypingTimer) clearInterval(this.onlineParticipantTypingTimer);
    this.onlineParticipantTypingTimer = null;
    this.onlineParticipantTypingQuestionId = null;
  }

  private replaceMap<K, V>(target: Map<K, V>, entries: [K, V][]): void {
    target.clear();
    for (const [key, value] of entries ?? []) target.set(key, value);
  }

  private findOnlinePackQuestion(questionId: string | null): PackQuestion | null {
    if (!questionId || !this.onlineDownloadedPack) return null;
    const roundQuestion = this.onlineDownloadedPack.rounds
      .flatMap((round) => round.themes)
      .flatMap((theme) => theme.questions)
      .find((question) => question.id === questionId);
    if (roundQuestion) return roundQuestion;
    return this.onlineDownloadedPack.finalThemes
      .flatMap((theme) => theme.questions)
      .find((question) => question.id === questionId) ?? null;
  }

  private replaceSet<T>(target: Set<T>, entries: T[]): void {
    target.clear();
    for (const value of entries ?? []) target.add(value);
  }

  private stopOnlineGameSync(): void {
    if (this.onlineGameSyncTimer) clearInterval(this.onlineGameSyncTimer);
    this.onlineGameSyncTimer = null;
  }

  async quitGame(): Promise<void> {
    this.stopMicrophoneTest();
    this.stopMusic();
    try {
      await invoke("exit_app");
    } catch {
      await getCurrentWindow().close();
    }
  }

  selectAvatar(avatar: AvatarDefinition): void {
    this.playClick();
    this.selectedAvatarId = avatar.id;
    this.currentAnimationName = "idle";
    localStorage.setItem(this.selectedAvatarStorageKey, avatar.id);
    this.feedback = this.tr(`${avatar.name} selected`, `Аватар «${avatar.name}» выбран`);
  }

  selectTheme(theme: ThemeDefinition): void {
    this.playClick();
    this.selectedThemeId = theme.id;
    localStorage.setItem(this.selectedThemeStorageKey, theme.id);
    this.feedback = this.tr(`${theme.name[0]} selected`, `Тема «${theme.name[1]}» выбрана`);
  }

  beginNicknameEdit(): void {
    if (this.isSavingNickname) return;
    this.nicknameDraft = this.nickname;
    this.nicknameFeedback = "";
    this.isEditingNickname = true;
  }

  cancelNicknameEdit(): void {
    this.isEditingNickname = false;
    this.nicknameFeedback = "";
  }

  saveNickname(): void {
    if (this.isSavingNickname) return;
    const nick = this.nicknameDraft.trim().replace(/\s+/g, " ");
    const length = [...nick].length;
    if (length < 2 || length > 24) {
      this.nicknameFeedback = this.tr("Use 2–24 characters", "Введите от 2 до 24 символов");
      return;
    }
    this.nicknameFeedback = "";
    this.nickname = nick;
    localStorage.setItem(this.nicknameStorageKey, nick);
    this.isEditingNickname = false;
  }

  cycleAnimation(): void {
    this.playClick();
    const currentIndex = this.animationOrder.indexOf(this.currentAnimationName);
    this.currentAnimationName = this.animationOrder[(currentIndex + 1) % this.animationOrder.length] ?? "idle";
    this.feedback = "";
  }

  closeSubmenu(): void {
    this.playClick();
    const returnView = this.view === "settings" ? this.settingsReturnView : "menu";
    if (returnView !== "offline-game") this.stopMicrophoneTest();
    this.view = returnView;
    this.settingsReturnView = "menu";
    this.feedback = "";
    this.startMusic();
    if (returnView === "offline-game") void this.startRoomMicrophoneMonitoring();
  }

  openSettings(): void {
    this.playClick();
    this.settingsReturnView = this.view === "offline-game" || this.view === "online-room" ? this.view : "menu";
    this.view = "settings";
    this.feedback = "";
    void this.loadAudioDevices();
    void this.loadDisplays(false);
  }

  toggleOfflinePause(): void {
    if (this.isParticipantGameView || !this.offlineGameStarted) return;
    this.offlineGamePaused = !this.offlineGamePaused;
    if (this.offlineGamePaused) {
      this.clearOfflineGameTimers();
      this.pauseQuestionTimerSound();
      this.isPushToTalkPressed = false;
      this.stopMicrophoneTest();
      document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video").forEach((media) => media.pause());
      return;
    }
    this.resumeQuestionTimerSound();
    if (this.offlineQuestionStage === "media") {
      document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video").forEach((media) => void media.play().catch(() => undefined));
    }
    this.resumeOfflineGameState();
  }

  skipOfflineQuestion(): void {
    if (!this.canSkipOfflineQuestion) return;
    this.clearOfflineGameTimers();
    this.offlineBotAnimations.clear();
    this.finishOfflineQuestion();
  }

  skipOfflineRound(): void {
    if (!this.canSkipOfflineRound) return;
    for (const theme of this.offlineRound?.themes ?? []) {
      for (const question of theme.questions) this.offlineAnsweredQuestionIds.add(question.id);
    }
    this.clearOfflineGameTimers();
    this.stopQuestionTimerSound();
    this.offlineBotAnimations.clear();
    this.completeOfflineRound();
  }

  async openBotsSetup(): Promise<void> {
    this.offlineRoomMode = "bots";
    this.prepareOfflineParticipantNames();
    await this.openOfflineSetup();
  }

  async openHotseatSetup(): Promise<void> {
    this.offlineRoomMode = "hotseat";
    this.offlineHumanBotId = null;
    this.prepareOfflineParticipantNames();
    await this.openOfflineSetup();
  }

  private async openOfflineSetup(): Promise<void> {
    this.offlineFeedback = "";
    if (this.offlineBots.length === 0) this.setOfflineBotCount("3");
    this.ensureOfflineAnswerKeys();
    this.view = "offline-bots-setup";
    try {
      const listing = await this.packStorage.list();
      this.offlinePackSummaries = listing.packs;
      if (!this.offlinePackSummaries.some((pack) => pack.fileName === this.selectedOfflinePackFile)) {
        this.selectedOfflinePackFile = this.offlinePackSummaries[0]?.fileName ?? "";
      }
      this.selectOfflinePack(this.selectedOfflinePackFile);
    } catch {
      this.offlinePackSummaries = [];
      this.selectedOfflinePackFile = "";
      this.offlineFeedback = this.tr("Unable to read the packs folder", "Не удалось прочитать папку паков");
    }
  }

  setOfflineBotCount(rawCount: string): void {
    const count = Math.min(12, Math.max(2, Number(rawCount) || 2));
    while (this.offlineBots.length < count) {
      const number = this.offlineBots.length + 1;
      this.offlineBots.push({
        id: this.makeId("bot"),
        name: this.offlineRoomMode === "hotseat"
          ? this.tr(`Participant ${number}`, `Участник ${number}`)
          : this.tr(`Bot ${number}`, `Бот ${number}`),
        avatarId: this.randomBotAvatarId(),
        score: 0,
        team: (number - 1) % this.offlineTeamCount + 1,
      });
    }
    if (this.offlineBots.length > count) this.offlineBots.splice(count);
    if (this.offlineHumanBotId && !this.offlineBots.some((bot) => bot.id === this.offlineHumanBotId)) this.offlineHumanBotId = null;
    if (this.offlineTeamMode) this.balanceOfflineTeams();
    this.ensureOfflineAnswerKeys();
  }

  occupyOfflineBotSeat(botId: string): void {
    if (this.offlineRoomMode !== "bots") return;
    const nextBot = this.offlineBots.find((bot) => bot.id === botId);
    if (!nextBot) return;
    const previousIndex = this.offlineBots.findIndex((bot) => bot.id === this.offlineHumanBotId);
    if (previousIndex >= 0) {
      const previous = this.offlineBots[previousIndex];
      previous.name = this.tr(`Bot ${previousIndex + 1}`, `Бот ${previousIndex + 1}`);
      previous.avatarId = this.randomBotAvatarId();
    }
    if (this.offlineHumanBotId === botId) {
      this.offlineHumanBotId = null;
      return;
    }
    this.offlineHumanBotId = botId;
    nextBot.name = this.nickname;
    nextBot.avatarId = this.selectedAvatar?.id ?? "robot";
  }

  private prepareOfflineParticipantNames(): void {
    this.offlineBots.forEach((bot, index) => {
      const isGenerated = /^(Bot|Бот|Participant|Участник)\s+\d+$/u.test(bot.name.trim());
      if (!isGenerated) return;
      bot.name = this.offlineRoomMode === "hotseat"
        ? this.tr(`Participant ${index + 1}`, `Участник ${index + 1}`)
        : this.tr(`Bot ${index + 1}`, `Бот ${index + 1}`);
    });
  }

  private ensureOfflineAnswerKeys(): void {
    const defaults = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "KeyQ", "KeyW"];
    this.offlineHotseatContestants.forEach((contestant, index) => {
      if (!this.offlineAnswerKeys.has(contestant.key)) this.offlineAnswerKeys.set(contestant.key, defaults[index] ?? "Space");
    });
  }

  setOfflineAnswerKey(targetKey: string, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (["Tab", "Escape"].includes(event.code)) return;
    const previousCode = this.offlineAnswerKeys.get(targetKey);
    for (const [key, code] of this.offlineAnswerKeys) {
      if (key !== targetKey && code === event.code) {
        if (previousCode) this.offlineAnswerKeys.set(key, previousCode);
        else this.offlineAnswerKeys.delete(key);
      }
    }
    this.offlineAnswerKeys.set(targetKey, event.code);
  }

  toggleOfflineKeySettings(): void { this.offlineKeySettingsOpen = !this.offlineKeySettingsOpen; }

  setOfflineBotAvatar(bot: OfflineBot, avatarId: string): void {
    if (this.availableBotAvatars.some((avatar) => avatar.id === avatarId)) bot.avatarId = avatarId as AvatarDefinition["id"];
  }

  setOfflineTeamMode(enabled: boolean): void {
    this.offlineTeamMode = this.selectedOfflinePackIsCrowd ? true : enabled;
    this.balanceOfflineTeams();
    this.ensureOfflineAnswerKeys();
  }

  setOfflineTeamCount(rawCount: string): void {
    this.offlineTeamCount = Math.min(this.selectedOfflinePackIsCrowd ? 3 : 4, Math.max(2, Number(rawCount) || 2));
    this.balanceOfflineTeams();
    this.ensureOfflineAnswerKeys();
  }

  selectOfflinePack(fileName: string): void {
    this.selectedOfflinePackFile = fileName;
    if (this.selectedOfflinePackIsCrowd) {
      this.offlineTeamMode = true;
      this.offlineTeamCount = Math.min(3, Math.max(2, this.offlineTeamCount));
      this.balanceOfflineTeams();
      this.ensureOfflineAnswerKeys();
    }
  }

  setOfflineBotTeam(bot: OfflineBot, rawTeam: string): void {
    bot.team = Math.min(this.offlineTeamCount, Math.max(1, Number(rawTeam) || 1));
  }

  openTeamScoreEditor(team: number): void {
    const representative = this.offlineTeamRepresentative(team);
    if (representative) this.openScoreEditor(representative.id);
  }

  private setOfflineScore(bot: OfflineBot, score: number): void {
    if (!this.offlineTeamMode) {
      bot.score = score;
      return;
    }
    this.offlineBots.filter((member) => member.team === bot.team).forEach((member) => { member.score = score; });
  }

  private addOfflineScore(bot: OfflineBot, delta: number): void {
    this.setOfflineScore(bot, bot.score + delta);
  }

  private balanceOfflineTeams(): void {
    this.offlineBots.forEach((bot, index) => {
      if (bot.team > this.offlineTeamCount || bot.team < 1) bot.team = index % this.offlineTeamCount + 1;
    });
    for (let team = 1; team <= this.offlineTeamCount; team += 1) {
      if (!this.offlineBots.some((bot) => bot.team === team) && this.offlineBots[team - 1]) {
        this.offlineBots[team - 1].team = team;
      }
    }
  }

  async startOfflineBotsGame(): Promise<void> {
    if (!this.selectedOfflinePackFile) {
      this.offlineFeedback = this.t("noPlayablePacks");
      return;
    }
    try {
      const pack = await this.packStorage.load(this.selectedOfflinePackFile);
      this.normalizePackQuestions(pack);
      if (pack.gameType === "crowd-code") {
        this.offlineTeamMode = true;
        this.offlineTeamCount = Math.min(3, Math.max(2, this.offlineTeamCount));
        this.balanceOfflineTeams();
      }
      this.offlineBots.forEach((bot, index) => {
        bot.name = bot.name.trim() || (this.offlineRoomMode === "hotseat"
          ? this.tr(`Participant ${index + 1}`, `Участник ${index + 1}`)
          : this.tr(`Bot ${index + 1}`, `Бот ${index + 1}`));
        bot.score = 0;
      });
      this.offlineGamePack = pack;
      this.offlineGameStarted = false;
      this.offlineGamePaused = false;
      this.offlineGamePhase = "lobby";
      this.offlineKeySettingsOpen = false;
      this.offlineIsFinalQuestion = false;
      this.offlineRoundIndex = 0;
      this.offlineChooserBotId = null;
      this.offlineQuestionCheckpoint = null;
      this.offlineAnsweredQuestionIds.clear();
      this.offlineHostAnimation = "idle";
      this.offlineBotAnimations.clear();
      this.offlineParticipantMicrophoneLevels.clear();
      this.clearOfflineRoomMessages();
      this.scoreEditorTargetId = null;
      this.offlineFeedback = "";
      this.view = "offline-game";
      void this.startRoomMicrophoneMonitoring();
    } catch {
      this.offlineFeedback = this.tr("Unable to open the selected pack", "Не удалось открыть выбранный пак");
    }
  }

  backToOfflineModes(): void {
    this.offlineFeedback = "";
    this.view = "offline-mode";
  }

  exitOfflineGame(): void {
    this.stopQuestionTimerSound();
    this.stopMicrophoneTest();
    this.offlineParticipantMicrophoneLevels.clear();
    this.clearOfflineRoomMessages();
    this.offlineGamePack = null;
    this.offlineGameStarted = false;
    this.offlineGamePaused = false;
    this.isPushToTalkPressed = false;
    this.offlineGamePhase = "lobby";
    this.offlineIsFinalQuestion = false;
    this.offlineQuestionCheckpoint = null;
    this.scoreEditorTargetId = null;
    this.offlineKeySettingsOpen = false;
    this.clearOfflineGameTimers();
    this.view = "offline-bots-setup";
  }

  toggleOfflineChat(): void {
    if (!this.canUseRoomCommunication) return;
    this.offlineChatOpen = !this.offlineChatOpen;
    if (!this.offlineChatOpen) this.offlineChatDraft = "";
  }

  sendOfflineRoomMessage(): void {
    if (!this.canUseRoomCommunication) return;
    const message = this.offlineChatDraft.trim().slice(0, 240);
    if (!message) return;
    if (this.onlineRole === "participant") {
      void invoke("send_p2p_chat", { message }).catch(() => undefined);
      if (this.onlineParticipantBot) this.showOfflineRoomMessage(this.onlineParticipantBot.id, message);
      this.offlineChatDraft = "";
      this.offlineChatOpen = false;
      return;
    }
    const senderId = this.offlineBotHostActive && this.offlineHumanBotId ? this.offlineHumanBotId : "host";
    this.showOfflineRoomMessage(senderId, message);
    this.offlineChatDraft = "";
    this.offlineChatOpen = false;
    if (!this.isCrowdGame && this.offlineBotHostActive && senderId === this.offlineResponderBotId) this.resolveOfflineBotHostAnswer(message);
    if (this.isCrowdGame && this.offlineBotHostActive && senderId === this.crowdResponderId) this.resolveCrowdBotHostAnswer(message);
  }

  showOfflineRoomMessage(participantId: "host" | string, message: string): void {
    const normalized = message.trim().slice(0, 240);
    if (!normalized) return;
    const previousMessageTimer = this.offlineMessageTimers.get(participantId);
    const previousBoostTimer = this.offlineAuraBoostTimers.get(participantId);
    if (previousMessageTimer) clearTimeout(previousMessageTimer);
    if (previousBoostTimer) clearTimeout(previousBoostTimer);
    this.offlineRoomMessages.set(participantId, normalized);
    this.offlineAuraBoosts.add(participantId);
    this.offlineAuraBoostTimers.set(participantId, setTimeout(() => {
      this.offlineAuraBoosts.delete(participantId);
      this.offlineAuraBoostTimers.delete(participantId);
    }, 300));
    this.offlineMessageTimers.set(participantId, setTimeout(() => {
      this.offlineRoomMessages.delete(participantId);
      this.offlineMessageTimers.delete(participantId);
    }, 5000));
  }

  startOfflineGame(): void {
    if (!this.canStartOfflineGame) return;
    if (this.isCrowdGame) {
      this.startCrowdGame();
      return;
    }
    this.clearOfflineGameTimers();
    this.offlineGameStarted = true;
    this.offlineGamePaused = false;
    this.offlineRoundIndex = 0;
    this.offlineIsFinalQuestion = false;
    this.offlineChooserBotId = null;
    this.offlineQuestionCheckpoint = null;
    this.offlineAnsweredQuestionIds.clear();
    this.announceOfflineRound(true);
  }

  private startCrowdGame(): void {
    this.clearOfflineGameTimers();
    this.offlineGameStarted = true;
    this.offlineGamePaused = false;
    this.offlineGamePhase = "question";
    this.offlineQuestionStage = "judging";
    this.crowdGamePhase = "captain-selection";
    this.crowdRoundIndex = 0;
    this.crowdQuestionIndex = 0;
    this.crowdCaptainIds.clear();
    this.crowdRevealedAnswerIds.clear();
    this.crowdBigWagers.clear();
    this.crowdBigPlayerIds.clear();
    this.crowdBigWagerDrafts.clear();
    this.crowdBigPlayerDrafts.clear();
    this.crowdBigConfirmedTeams.clear();
    this.crowdBigPoints.clear();
    this.crowdBigTurnOrder = [];
    this.crowdBigTurnIndex = 0;
    this.crowdResponderId = null;
    this.crowdRoundPot = 0;
    this.crowdMisses = 0;
    this.offlineWinnerBotId = null;
    if (this.offlineBotHostActive) {
      for (const team of this.offlineTeams) {
        const captain = team.members[Math.floor(Math.random() * team.members.length)];
        if (captain) this.crowdCaptainIds.set(team.number, captain.id);
      }
      this.beginCrowdRounds();
    }
    void this.publishOnlineGameState();
  }

  setCrowdCaptain(team: number, botId: string): void {
    if (this.isParticipantGameView || this.crowdGamePhase !== "captain-selection") return;
    const bot = this.offlineBots.find((candidate) => candidate.id === botId && candidate.team === team);
    if (!bot) return;
    this.crowdCaptainIds.set(team, bot.id);
    void this.publishOnlineGameState();
  }

  get canBeginCrowdRounds(): boolean {
    return this.isCrowdGame && this.offlineTeams.every((team) => Boolean(this.crowdCaptain(team.number)));
  }

  beginCrowdRounds(): void {
    if ((this.isParticipantGameView && !this.offlineBotHostActive) || !this.canBeginCrowdRounds) return;
    this.crowdRoundIndex = 0;
    this.crowdQuestionIndex = 0;
    this.prepareCrowdRoundIntro();
  }

  private prepareCrowdRoundIntro(): void {
    const round = this.crowdRound;
    if (!round) {
      this.finishCrowdGame();
      return;
    }
    this.crowdGamePhase = "round-intro";
    this.crowdRoundWinnerTeam = null;
    this.crowdResponderId = null;
    this.crowdRevealedAnswerIds.clear();
    this.crowdRoundPot = 0;
    this.crowdMisses = 0;
    if (this.offlineBotHostActive) this.offlinePhaseTimer = setTimeout(() => this.startCrowdRoundQuestion(), 1000);
    void this.publishOnlineGameState();
  }

  startCrowdRoundQuestion(): void {
    if (this.onlineRole === "participant" || !this.crowdQuestion) return;
    this.crowdRevealedAnswerIds.clear();
    this.crowdRoundPot = 0;
    this.crowdMisses = 0;
    this.crowdResponderId = null;
    this.crowdRoundWinnerTeam = null;
    if (this.crowdRound?.kind === "big") {
      this.startCrowdBigSetup();
      return;
    }
    this.crowdActiveTeam = this.offlineTeams[this.crowdRoundIndex % this.offlineTeams.length]?.number ?? 1;
    this.crowdGamePhase = this.crowdRound?.kind === "reverse" ? "reverse-play" : "faceoff";
    this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  private canCrowdBotAct(botId: string): boolean {
    if (!this.isCrowdGame || !this.offlineGameStarted || this.offlineGamePaused || this.crowdResponderId) return false;
    const bot = this.offlineBots.find((candidate) => candidate.id === botId);
    if (!bot) return false;
    if (this.crowdGamePhase === "faceoff") return this.crowdCaptainIds.get(bot.team) === bot.id;
    if (this.crowdGamePhase === "team-play" || this.crowdGamePhase === "reverse-play") return bot.team === this.crowdActiveTeam;
    if (this.crowdGamePhase === "steal") return bot.team !== this.crowdActiveTeam;
    if (this.crowdGamePhase === "big-play") return this.crowdBigPlayerIds.get(this.crowdCurrentBigTeam ?? -1) === bot.id;
    return false;
  }

  private triggerCrowdAction(botId: string): void {
    if (!this.canCrowdBotAct(botId)) return;
    this.pulseOfflineAction(botId);
    this.crowdResponderId = botId;
    this.offlineResponderBotId = botId;
    this.offlineBotAnimations.set(botId, "raiseHand");
    this.offlineAnimationTimer = setTimeout(() => {
      if (this.crowdResponderId === botId) this.offlineBotAnimations.set(botId, "talk");
    }, 500);
    void this.publishOnlineGameState();
  }

  revealCrowdAnswer(answer: CrowdAnswer): void {
    if (this.onlineRole === "participant" || !this.crowdResponder || this.crowdRevealedAnswerIds.has(answer.id)) return;
    const responder = this.crowdResponder;
    this.crowdRevealedAnswerIds.add(answer.id);
    this.offlineBotAnimations.set(responder.id, "victory");
    if (this.crowdGamePhase === "big-play") {
      const team = responder.team;
      this.crowdBigPoints.set(team, (this.crowdBigPoints.get(team) ?? 0) + answer.points);
      this.advanceCrowdBigTurn();
      return;
    }
    const points = this.crowdAnswerScore(answer);
    if (this.crowdGamePhase === "reverse-play") {
      this.addOfflineScore(responder, points);
      this.clearCrowdResponder();
      if (this.crowdQuestion?.answers.every((candidate) => this.crowdRevealedAnswerIds.has(candidate.id))) this.finishCrowdQuestion(responder.team);
      else this.advanceCrowdActiveTeam();
      return;
    }
    this.crowdRoundPot += points;
    if (this.crowdGamePhase === "faceoff") {
      this.crowdActiveTeam = responder.team;
      this.crowdGamePhase = "team-play";
      this.crowdMisses = 0;
    } else if (this.crowdGamePhase === "steal") {
      this.finishCrowdQuestion(responder.team);
      return;
    }
    this.clearCrowdResponder();
    if (this.crowdQuestion?.answers.every((candidate) => this.crowdRevealedAnswerIds.has(candidate.id))) this.finishCrowdQuestion(this.crowdActiveTeam);
    else this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  markCrowdMiss(): void {
    if (this.onlineRole === "participant" || !this.crowdResponder) return;
    const responder = this.crowdResponder;
    this.offlineBotAnimations.set(responder.id, "upset");
    if (this.crowdGamePhase === "faceoff") {
      this.clearCrowdResponder();
    } else if (this.crowdGamePhase === "team-play") {
      this.crowdMisses += 1;
      this.clearCrowdResponder();
      if (this.crowdMisses >= 3) this.crowdGamePhase = "steal";
    } else if (this.crowdGamePhase === "steal") {
      this.finishCrowdQuestion(this.crowdActiveTeam);
      return;
    } else if (this.crowdGamePhase === "reverse-play") {
      this.clearCrowdResponder();
      this.advanceCrowdActiveTeam();
    } else if (this.crowdGamePhase === "big-play") {
      this.advanceCrowdBigTurn();
      return;
    }
    this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  private clearCrowdResponder(): void {
    if (this.crowdResponderId) this.offlineBotAnimations.set(this.crowdResponderId, "idle");
    this.crowdResponderId = null;
    this.offlineResponderBotId = null;
  }

  private advanceCrowdActiveTeam(): void {
    const teams = this.offlineTeams.map((team) => team.number);
    const index = teams.indexOf(this.crowdActiveTeam);
    this.crowdActiveTeam = teams[(index + 1) % teams.length] ?? teams[0] ?? 1;
    this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  private finishCrowdQuestion(winningTeam: number): void {
    const winner = this.offlineTeamRepresentative(winningTeam);
    if (winner && this.crowdRound?.kind !== "reverse") this.addOfflineScore(winner, this.crowdRoundPot);
    this.clearCrowdResponder();
    this.crowdRoundWinnerTeam = winningTeam;
    this.crowdGamePhase = "round-result";
    if (this.offlineBotHostActive) this.offlinePhaseTimer = setTimeout(() => this.continueCrowdGame(), 1200);
    void this.publishOnlineGameState();
  }

  continueCrowdGame(): void {
    if (this.onlineRole === "participant" || this.crowdGamePhase !== "round-result") return;
    if (this.crowdQuestionIndex + 1 < (this.crowdRound?.questions.length ?? 0)) {
      this.crowdQuestionIndex += 1;
      this.startCrowdRoundQuestion();
      return;
    }
    this.crowdRoundIndex += 1;
    this.crowdQuestionIndex = 0;
    this.prepareCrowdRoundIntro();
  }

  private startCrowdBigSetup(): void {
    this.crowdGamePhase = "big-setup";
    this.crowdBigWagers.clear();
    this.crowdBigPlayerIds.clear();
    this.crowdBigWagerDrafts.clear();
    this.crowdBigPlayerDrafts.clear();
    this.crowdBigConfirmedTeams.clear();
    this.crowdBigPoints.clear();
    if (this.offlineRoomMode === "bots" && !this.onlineRole) {
      for (const team of this.offlineTeams) {
        const player = team.members[Math.floor(Math.random() * team.members.length)];
        this.crowdBigWagers.set(team.number, Math.max(0, Math.floor(team.score / 4)));
        if (player) this.crowdBigPlayerIds.set(team.number, player.id);
        this.crowdBigConfirmedTeams.add(team.number);
      }
      this.beginCrowdBigPlay();
      return;
    }
    void this.publishOnlineGameState();
  }

  canConfigureCrowdBigTeam(team: number): boolean {
    if (this.crowdBigConfirmedTeams.has(team)) return false;
    if (this.onlineRole !== "participant") return !this.isParticipantGameView;
    return this.onlineParticipantBot?.id === this.crowdCaptainIds.get(team);
  }

  setCrowdBigWager(team: number, raw: string): void {
    if (!this.canConfigureCrowdBigTeam(team)) return;
    this.crowdBigWagerDrafts.set(team, Math.max(0, Math.min(this.offlineTeamScore(team), Math.round(Number(raw) || 0))));
  }

  setCrowdBigPlayer(team: number, botId: string): void {
    if (!this.canConfigureCrowdBigTeam(team) || !this.offlineBots.some((bot) => bot.id === botId && bot.team === team)) return;
    this.crowdBigPlayerDrafts.set(team, botId);
  }

  crowdBigWagerInput(team: number): number { return this.crowdBigWagerDrafts.get(team) ?? this.crowdBigWagers.get(team) ?? 0; }
  crowdBigPlayerInput(team: number): string { return this.crowdBigPlayerDrafts.get(team) ?? this.crowdBigPlayerIds.get(team) ?? ""; }

  confirmCrowdBigDecision(team: number): void {
    const playerId = this.crowdBigPlayerInput(team);
    const wager = this.crowdBigWagerInput(team);
    if (!this.canConfigureCrowdBigTeam(team) || !playerId) return;
    if (this.onlineRole === "participant") {
      void invoke("send_p2p_crowd_big_decision", { wager, playerId }).catch(() => undefined);
      this.crowdBigConfirmedTeams.add(team);
      return;
    }
    this.acceptCrowdBigDecision(team, wager, playerId);
  }

  private acceptCrowdBigDecision(team: number, wager: number, playerId: string): void {
    if (this.crowdGamePhase !== "big-setup" || this.crowdBigConfirmedTeams.has(team)) return;
    if (!this.offlineBots.some((bot) => bot.id === playerId && bot.team === team)) return;
    this.crowdBigWagers.set(team, Math.max(0, Math.min(this.offlineTeamScore(team), wager)));
    this.crowdBigPlayerIds.set(team, playerId);
    this.crowdBigWagerDrafts.delete(team);
    this.crowdBigPlayerDrafts.delete(team);
    this.crowdBigConfirmedTeams.add(team);
    if (this.crowdBigConfirmedTeams.size === this.offlineTeamCount) this.beginCrowdBigPlay();
    else void this.publishOnlineGameState();
  }

  private beginCrowdBigPlay(): void {
    if (this.crowdBigConfirmedTeams.size < this.offlineTeamCount) return;
    const teams = [...this.offlineTeams].sort((left, right) => left.score - right.score).map((team) => team.number);
    const target = this.offlineTeamCount === 3 ? 15 : 10;
    this.crowdBigTurnOrder = this.offlineTeamCount === 2
      ? [...Array.from({ length: target - 3 }, (_, index) => teams[index % teams.length]), teams[0], teams[0], teams[1]]
      : Array.from({ length: target }, (_, index) => teams[index % teams.length]);
    this.crowdBigTurnIndex = 0;
    this.crowdGamePhase = "big-play";
    this.clearCrowdResponder();
    if (!this.canUseRoomCommunication) {
      this.offlineChatOpen = false;
      this.isPushToTalkPressed = false;
      this.stopMicrophoneTest();
    }
    this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  private advanceCrowdBigTurn(): void {
    this.clearCrowdResponder();
    this.crowdBigTurnIndex += 1;
    if (this.crowdBigTurnIndex >= this.crowdBigTurnOrder.length || this.crowdQuestion?.answers.every((answer) => this.crowdRevealedAnswerIds.has(answer.id))) {
      this.finishCrowdBigGame();
      return;
    }
    this.scheduleCrowdBotTurn();
    void this.publishOnlineGameState();
  }

  private finishCrowdBigGame(): void {
    for (const team of this.offlineTeams) {
      const representative = team.members[0];
      if (!representative) continue;
      const points = this.crowdBigPoints.get(team.number) ?? 0;
      const wager = this.crowdBigWagers.get(team.number) ?? 0;
      this.addOfflineScore(representative, points + (points >= 100 ? wager : -wager));
    }
    this.finishCrowdGame();
  }

  private finishCrowdGame(): void {
    const winner = [...this.offlineTeams].sort((left, right) => right.score - left.score)[0];
    this.offlineWinnerBotId = winner?.members[0]?.id ?? null;
    this.crowdGamePhase = "winner";
    this.offlineGamePhase = "winner";
    void this.publishOnlineGameState();
  }

  private scheduleCrowdBotTurn(): void {
    if (this.offlineRoomMode !== "bots" || this.crowdResponderId || this.offlineGamePaused) return;
    this.clearOfflineBotTimer();
    const candidates = this.offlineBots.filter((bot) => bot.id !== this.offlineHumanBotId && this.canCrowdBotAct(bot.id));
    const bot = candidates[Math.floor(Math.random() * candidates.length)];
    if (!bot) return;
    this.offlineBotTimer = setTimeout(() => {
      this.triggerCrowdAction(bot.id);
      const remaining = this.crowdQuestion?.answers.filter((answer) => !this.crowdRevealedAnswerIds.has(answer.id)) ?? [];
      const answer = remaining[Math.floor(Math.random() * remaining.length)];
      this.offlineBotTimer = setTimeout(() => {
        if (!answer || this.crowdResponderId !== bot.id) return;
        this.showOfflineRoomMessage(bot.id, answer.text);
        this.revealCrowdAnswer(answer);
      }, 700);
    }, 700 + Math.floor(Math.random() * 900));
  }

  private resolveCrowdBotHostAnswer(value: string): void {
    const answer = this.crowdQuestion?.answers
      .filter((candidate) => !this.crowdRevealedAnswerIds.has(candidate.id))
      .find((candidate) => this.textSimilarity(value, candidate.text) >= .85);
    if (answer) this.revealCrowdAnswer(answer);
    else this.markCrowdMiss();
  }

  chooseOfflineChooser(botId: string): void {
    if (!this.offlineBots.some((bot) => bot.id === botId)) return;
    this.offlineChooserBotId = botId;
    this.showOfflineBoard();
  }

  chooseRandomOfflineChooser(): void {
    const bot = this.offlineBots[Math.floor(Math.random() * this.offlineBots.length)];
    if (bot) this.chooseOfflineChooser(bot.id);
  }

  selectOfflineQuestion(question: PackQuestion): void {
    if (this.offlineGamePhase !== "board" || this.offlineAnsweredQuestionIds.has(question.id)) return;
    this.offlineQuestionCheckpoint = {
      question,
      chooserBotId: this.offlineChooserBotId,
      botScores: new Map(this.offlineBots.map((bot) => [bot.id, bot.score])),
    };
    this.clearOfflineSelectionTimer();
    this.clearOfflineBotTimer();
    this.offlineAnsweredQuestionIds.add(question.id);
    this.offlineSelectedQuestion = question;
    this.offlineTypedQuestionText = "";
    this.offlineQuestionMediaVisible = false;
    this.offlineResponderBotId = null;
    this.offlineLastWrongBotId = null;
    this.offlineCatRecipientBotId = null;
    this.offlineGamePhase = "question";
    if (this.offlineChooserBotId) this.playOfflineBotAnimation(this.offlineChooserBotId, "point", 1100);
    if (question.isCatInBag) {
      this.offlineQuestionStage = "cat-announcement";
      this.offlineHostAnimation = "talk";
      this.offlinePhaseTimer = setTimeout(() => {
        this.offlineQuestionStage = "cat-recipient";
        this.offlineHostAnimation = "idle";
        this.scheduleOfflineCatRecipient();
      }, 1600);
      return;
    }
    this.beginOfflineQuestionPresentation();
  }

  chooseRandomOfflineQuestion(): void {
    const questions = this.offlineRound?.themes.flatMap((theme) => theme.questions)
      .filter((question) => !this.offlineAnsweredQuestionIds.has(question.id)) ?? [];
    const question = questions[Math.floor(Math.random() * questions.length)];
    if (question) this.selectOfflineQuestion(question);
  }

  assignOfflineCatRecipient(botId: string): void {
    if (this.offlineQuestionStage !== "cat-recipient" || botId === this.offlineChooserBotId || !this.offlineBots.some((bot) => bot.id === botId)) return;
    this.clearOfflineBotTimer();
    this.offlineCatRecipientBotId = botId;
    this.offlineQuestionStage = "cat-transfer";
    if (this.offlineChooserBotId) this.playOfflineBotAnimation(this.offlineChooserBotId, "point", 1500);
    this.offlinePhaseTimer = setTimeout(() => this.beginOfflineQuestionPresentation(), 1700);
  }

  onOfflineMediaEnded(): void {
    if (this.onlineRole === "participant") return;
    if (this.offlineQuestionStage === "media") this.startOfflineAnswerWindow();
  }

  onOfflineMediaReady(event: Event): void {
    if (this.offlineQuestionStage !== "media" || !(event.target instanceof HTMLMediaElement)) return;
    const media = event.target;
    media.volume = this.mediaPlaybackVolume;
    if (media.paused) void media.play().catch(() => undefined);
  }

  onOfflineMediaFailed(): void {
    if (this.onlineRole === "participant") return;
    if (this.offlineQuestionStage !== "media") return;
    this.feedback = this.tr("Question media could not be played", "Не удалось воспроизвести медиа вопроса");
    this.startOfflineAnswerWindow();
  }

  triggerOfflineAction(botId: string): void {
    if (this.isCrowdGame) {
      this.triggerCrowdAction(botId);
      return;
    }
    if (
      !this.offlineGameStarted
      || this.offlineGamePaused
      || this.offlineGamePhase !== "question"
      || ["judging", "answer-reveal"].includes(this.offlineQuestionStage)
      || this.offlineFalseStartIds.has(botId)
      || !this.offlineBots.some((bot) => bot.id === botId)
    ) return;
    this.pulseOfflineAction(botId);
    if (this.offlineQuestionStage !== "answering") {
      this.lockOfflineFalseStart(botId);
      return;
    }
    this.beginOfflineAnswer(botId);
  }

  triggerHumanOfflineAction(botId: string): void {
    if (this.onlineRole === "participant") this.sendOnlineAction();
    else this.triggerOfflineAction(botId);
  }

  async exitCurrentGame(): Promise<void> {
    if (this.onlineRole) {
      await this.exitOnlineRoom();
    } else {
      this.exitOfflineGame();
    }
  }

  private pulseOfflineAction(botId: string): void {
    const previous = this.offlineActionPulseTimers.get(botId);
    if (previous) clearTimeout(previous);
    this.offlineActionPressedIds.add(botId);
    this.offlineActionPulseTimers.set(botId, setTimeout(() => {
      this.offlineActionPressedIds.delete(botId);
      this.offlineActionPulseTimers.delete(botId);
    }, 180));
  }

  private lockOfflineFalseStart(botId: string): void {
    const previous = this.offlineFalseStartTimers.get(botId);
    if (previous) clearTimeout(previous);
    this.offlineFalseStartIds.add(botId);
    this.offlineFalseStartTimers.set(botId, setTimeout(() => {
      this.offlineFalseStartIds.delete(botId);
      this.offlineFalseStartTimers.delete(botId);
    }, 2000));
  }

  beginOfflineAnswer(botId: string): void {
    if (this.offlineQuestionStage !== "answering" || !this.offlineBots.some((bot) => bot.id === botId)) return;
    this.clearOfflineBotTimer();
    this.clearOfflineAnswerTimer();
    this.clearOfflineAnimationTimer();
    this.stopQuestionTimerSound();
    this.offlineResponderBotId = botId;
    this.offlineQuestionStage = "judging";
    this.offlineHostAnimation = "idle";
    this.offlineBotAnimations.set(botId, "raiseHand");
    this.offlineAnimationTimer = setTimeout(() => {
      if (this.offlineResponderBotId === botId && this.offlineQuestionStage === "judging") this.offlineBotAnimations.set(botId, "talk");
    }, 650);
    if (this.offlineBotHostActive) this.waitForOfflineResponderChat(botId);
  }

  private waitForOfflineResponderChat(botId: string): void {
    this.clearOfflineBotJudgeTimer();
    this.offlineBotHostPendingDecision = null;
    this.offlineBotJudgeTimer = setTimeout(() => {
      if (this.offlineQuestionStage !== "judging" || this.offlineResponderBotId !== botId) return;
      this.showOfflineRoomMessage("host", this.tr("I did not receive an answer in time", "Я не дождался ответа"));
      this.judgeOfflineAnswer(false);
    }, 20000);
  }

  private resolveOfflineBotHostAnswer(answer: string): void {
    if (!this.offlineBotHostActive || this.offlineQuestionStage !== "judging" || !this.offlineResponderBotId) return;
    this.clearOfflineBotJudgeTimer();
    const correct = this.textSimilarity(answer, this.offlineSelectedQuestion?.answerText ?? "") >= .85;
    this.offlineBotHostPendingDecision = correct;
    this.offlineBotJudgeTimer = setTimeout(() => {
      this.offlineBotJudgeTimer = null;
      this.judgeOfflineAnswer(correct);
    }, 700);
  }

  private textSimilarity(left: string, right: string): number {
    const normalize = (value: string) => value.toLocaleLowerCase(this.settings.language === "ru" ? "ru-RU" : "en-US")
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
    const source = normalize(left);
    const target = normalize(right);
    if (!source || !target) return 0;
    const previous = Array.from({ length: target.length + 1 }, (_, index) => index);
    for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
      let diagonal = previous[0];
      previous[0] = sourceIndex;
      for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
        const above = previous[targetIndex];
        previous[targetIndex] = source[sourceIndex - 1] === target[targetIndex - 1]
          ? diagonal
          : Math.min(diagonal, previous[targetIndex - 1], above) + 1;
        diagonal = above;
      }
    }
    return 1 - previous[target.length] / Math.max(source.length, target.length);
  }

  judgeOfflineAnswer(correct: boolean): void {
    const responder = this.offlineResponderBot;
    if (this.offlineQuestionStage !== "judging" || !responder) return;
    this.clearOfflineBotJudgeTimer();
    this.offlineBotHostPendingDecision = null;
    const value = this.offlineQuestionValue;
    this.clearOfflineAnimationTimer();
    if (correct) {
      this.offlinePendingJudgeResolution = "correct";
      this.addOfflineScore(responder, value);
      this.offlineChooserBotId = responder.id;
      this.offlineHostAnimation = "thumbsUp";
      this.offlineBotAnimations.set(responder.id, "victory");
      this.offlineQuestionStage = "answer-reveal";
      this.offlineAnimationTimer = setTimeout(() => { this.offlinePendingJudgeResolution = null; this.finishOfflineQuestion(); }, 5000);
      return;
    }
    this.addOfflineScore(responder, -value);
    this.offlinePendingJudgeResolution = "wrong";
    this.offlineLastWrongBotId = responder.id;
    this.offlineHostAnimation = "thumbsDown";
    this.offlineBotAnimations.set(responder.id, "upset");
    this.offlineAnimationTimer = setTimeout(() => {
      this.offlinePendingJudgeResolution = null;
      this.offlineHostAnimation = "idle";
      this.offlineBotAnimations.set(responder.id, "idle");
      this.offlineResponderBotId = null;
      this.offlineQuestionStage = "answering";
      if (this.offlineAnswerSeconds <= 0) this.finishOfflineQuestionByTimeout();
      else {
        this.startOfflineAnswerCountdown(false);
        this.startQuestionTimerSound();
        this.scheduleOfflineBotAnswer();
      }
    }, 1700);
  }

  isOfflineQuestionAnswered(question: PackQuestion): boolean {
    return this.offlineAnsweredQuestionIds.has(question.id);
  }

  rewindOfflineGame(): void {
    const checkpoint = this.offlineQuestionCheckpoint;
    if (!this.canRewindOfflineGame || !checkpoint) return;
    this.clearOfflineGameTimers();
    this.stopQuestionTimerSound();
    this.clearOfflineRoomMessages();
    this.offlineBotAnimations.clear();
    document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video").forEach((media) => media.pause());
    checkpoint.botScores.forEach((score, botId) => {
      const bot = this.offlineBots.find((candidate) => candidate.id === botId);
      if (bot) bot.score = score;
    });
    this.offlineChooserBotId = checkpoint.chooserBotId;
    this.offlineAnsweredQuestionIds.delete(checkpoint.question.id);
    if (this.offlineGamePhase === "question") {
      this.showOfflineBoard();
      return;
    }
    this.selectOfflineQuestion(checkpoint.question);
  }

  private showOfflineBoard(): void {
    this.resetOfflineQuestionState();
    this.offlineGamePhase = "board";
    this.offlineSelectionSeconds = 10;
    this.clearOfflineSelectionTimer();
    if (!this.offlineRoundHasQuestions) {
      this.completeOfflineRound();
      return;
    }
    if (this.offlineRoomMode === "bots") {
      this.offlineSelectionTimer = setInterval(() => {
        this.offlineSelectionSeconds -= 1;
        if (this.offlineSelectionSeconds <= 0) this.chooseRandomOfflineQuestion();
      }, 1000);
      this.scheduleOfflineBotQuestionChoice();
    }
  }

  private startOfflineQuestionTyping(question: PackQuestion): void {
    let index = this.offlineTypedQuestionText.length;
    const text = question.text.trim();
    const revealNext = () => {
      index += 1;
      this.offlineTypedQuestionText = text.slice(0, index);
      if (index >= text.length) {
        this.clearOfflineTypeTimer();
        if (question.media) {
          this.offlineQuestionStage = "text-hold";
          this.offlinePhaseTimer = setTimeout(() => this.showOfflineQuestionMedia(), 3000);
        }
        else this.startOfflineAnswerWindow();
      }
    };
    if (index === 0) {
      revealNext();
      if (this.onlineRole === "host") void this.publishOnlineGameState();
    }
    if (index < text.length) this.offlineTypeTimer = setInterval(revealNext, QUESTION_TYPING_INTERVAL_MS);
  }

  private beginOfflineQuestionPresentation(): void {
    const question = this.offlineSelectedQuestion;
    if (!question) return;
    this.offlineHostAnimation = "talk";
    if (question.text.trim()) {
      this.offlineQuestionStage = "typing";
      this.startOfflineQuestionTyping(question);
    } else if (question.media) {
      this.showOfflineQuestionMedia();
    } else {
      this.startOfflineAnswerWindow();
    }
  }

  private showOfflineQuestionMedia(): void {
    const media = this.offlineSelectedQuestion?.media;
    if (!media) {
      this.startOfflineAnswerWindow();
      return;
    }
    this.clearOfflineMediaSource();
    this.offlineQuestionStage = "media";
    try {
      this.offlineQuestionMediaUrl = this.createMediaObjectUrl(media);
    } catch {
      this.onOfflineMediaFailed();
      return;
    }
    this.offlineQuestionMediaVisible = true;
    this.offlineHostAnimation = "talk";
    this.clearOfflineMediaTimer();
    if (media.type === "image") {
      this.offlineMediaTimer = setTimeout(() => this.startOfflineAnswerWindow(), 5000);
      return;
    }
    this.stopMusic();
    const durationMs = Math.ceil((media.durationSeconds ?? (media.type === "video" ? 15 : 30)) * 1000);
    this.offlineMediaTimer = setTimeout(() => this.startOfflineAnswerWindow(), Math.max(3000, durationMs + 1500));
  }

  private startOfflineAnswerWindow(): void {
    this.clearOfflineMediaTimer();
    document.querySelectorAll<HTMLMediaElement>(".offline-game-scene audio,.offline-game-scene video").forEach((media) => media.pause());
    this.offlineHostAnimation = "idle";
    if (this.offlineIsFinalQuestion) {
      this.startOfflineFinalAnswers();
      return;
    }
    if (this.offlineSelectedQuestion?.isCatInBag && this.offlineCatRecipientBotId) {
      this.offlineQuestionStage = "answering";
      this.beginOfflineAnswer(this.offlineCatRecipientBotId);
      if (this.offlineBotHostActive && this.offlineCatRecipientBotId !== this.offlineHumanBotId) {
        const answer = this.offlineBotSuggestedAnswer();
        this.showOfflineRoomMessage(this.offlineCatRecipientBotId, answer);
        this.resolveOfflineBotHostAnswer(answer);
      }
      return;
    }
    this.offlineQuestionStage = "answering";
    this.offlineAnswerSeconds = 30;
    this.startOfflineAnswerCountdown(true);
    this.startQuestionTimerSound();
    this.scheduleOfflineBotAnswer();
  }

  private startOfflineAnswerCountdown(reset: boolean): void {
    this.clearOfflineAnswerTimer();
    if (reset) this.offlineAnswerSeconds = 30;
    this.offlineAnswerTimer = setInterval(() => {
      this.offlineAnswerSeconds -= 1;
      if (this.offlineAnswerSeconds <= 0) this.finishOfflineQuestionByTimeout();
    }, 1000);
  }

  private scheduleOfflineBotQuestionChoice(): void {
    if (this.offlineRoomMode === "hotseat" || this.offlineChooserBotId === this.offlineHumanBotId) return;
    this.clearOfflineBotTimer();
    this.offlineBotTimer = setTimeout(() => this.chooseRandomOfflineQuestion(), this.randomBotDelay());
  }

  private scheduleOfflineBotAnswer(): void {
    if (this.offlineRoomMode === "hotseat") return;
    const eligibleBots = this.offlineBots.filter((bot) => bot.id !== this.offlineHumanBotId);
    if (eligibleBots.length === 0) return;
    this.clearOfflineBotTimer();
    this.offlineBotTimer = setTimeout(() => {
      const bot = eligibleBots[Math.floor(Math.random() * eligibleBots.length)];
      if (bot) {
        const answer = this.offlineBotSuggestedAnswer();
        this.beginOfflineAnswer(bot.id);
        this.showOfflineRoomMessage(bot.id, answer);
        if (this.offlineBotHostActive) this.resolveOfflineBotHostAnswer(answer);
      }
    }, this.randomBotDelay());
  }

  private offlineBotSuggestedAnswer(): string {
    const correctAnswer = this.offlineSelectedQuestion?.answerText.trim() ?? "";
    if (correctAnswer && Math.random() < .6) return correctAnswer;
    const guesses = this.settings.language === "ru"
      ? ["Не знаю точно", "Другой вариант", "Затрудняюсь ответить"]
      : ["I am not sure", "Another option", "I do not know"];
    return guesses[Math.floor(Math.random() * guesses.length)] ?? guesses[0];
  }

  private scheduleOfflineCatRecipient(): void {
    if (this.offlineRoomMode === "hotseat" || this.offlineChooserBotId === this.offlineHumanBotId) return;
    this.clearOfflineBotTimer();
    this.offlineBotTimer = setTimeout(() => {
      const recipients = this.offlineBots.filter((bot) => bot.id !== this.offlineChooserBotId);
      const recipient = recipients[Math.floor(Math.random() * recipients.length)];
      if (recipient) this.assignOfflineCatRecipient(recipient.id);
    }, this.randomBotDelay());
  }

  private randomBotDelay(): number {
    return 1000 + Math.floor(Math.random() * 2001);
  }

  private finishOfflineQuestion(): void {
    this.stopQuestionTimerSound();
    this.offlineHostAnimation = "idle";
    if (this.offlineResponderBotId) this.offlineBotAnimations.set(this.offlineResponderBotId, "idle");
    this.offlineResponderBotId = null;
    if (this.offlineRoundHasQuestions) this.showOfflineBoard();
    else this.completeOfflineRound();
  }

  private finishOfflineQuestionByTimeout(): void {
    this.clearOfflineAnswerTimer();
    this.clearOfflineBotTimer();
    this.clearOfflineBotJudgeTimer();
    this.stopQuestionTimerSound();
    this.offlineChooserBotId = this.offlineLastWrongBotId ?? this.offlineChooserBotId;
    this.offlineResponderBotId = null;
    this.offlineHostAnimation = "idle";
    this.offlinePendingJudgeResolution = "timeout";
    this.offlineQuestionStage = "answer-reveal";
    this.clearOfflineAnimationTimer();
    this.offlineAnimationTimer = setTimeout(() => {
      this.offlinePendingJudgeResolution = null;
      this.finishOfflineQuestion();
    }, 5000);
  }

  private completeOfflineRound(): void {
    this.clearOfflineGameTimers();
    this.resetOfflineQuestionState();
    this.offlineGamePhase = "round-complete";
    this.offlinePhaseTimer = setTimeout(() => {
      if (this.offlineGamePack && this.offlineRoundIndex + 1 < this.offlineGamePack.rounds.length) {
        this.offlineRoundIndex += 1;
        this.announceOfflineRound(false);
      } else {
        this.startOfflineFinal();
      }
    }, 2600);
  }

  private announceOfflineRound(firstRound: boolean): void {
    this.offlineQuestionCheckpoint = null;
    this.offlineGamePhase = "round-title";
    this.offlinePhaseTimer = setTimeout(() => {
      this.offlineGamePhase = "themes";
      this.offlinePhaseTimer = setTimeout(() => {
        if (firstRound && !this.offlineChooserBotId) {
          this.offlineGamePhase = "chooser";
          if (this.offlineBotHostActive) this.scheduleOfflineBotHostFirstChooser();
        } else this.showOfflineBoard();
      }, 3000);
    }, 2200);
  }

  private scheduleOfflineBotHostFirstChooser(): void {
    this.clearOfflineBotTimer();
    this.offlineBotTimer = setTimeout(() => this.chooseRandomOfflineChooser(), 1200);
  }

  removeOfflineFinalTheme(themeId: string): void {
    if (!this.canRemoveOfflineFinalTheme) return;
    const remover = this.offlineFinalTurnBot;
    if (!remover) return;
    if (this.onlineRole === "participant") {
      void invoke("send_p2p_final_theme_removal", { themeId }).catch(() => {
        this.onlineFeedback = this.tr("Unable to remove the final theme", "Не удалось убрать тему финала");
      });
      return;
    }
    this.clearOfflineBotTimer();
    this.offlineFinalThemes = this.offlineFinalThemes.filter((theme) => theme.id !== themeId);
    this.playOfflineBotAnimation(remover.id, "point", 900);
    this.offlineFinalTurnIndex += 1;
    if (this.offlineFinalThemes.length <= 1) {
      this.startOfflineFinalWagers();
    } else {
      this.scheduleOfflineFinalThemeRemoval();
    }
  }

  setOfflineFinalWagerDraft(bot: OfflineBot, rawValue: string): void {
    if (this.onlineRole === "participant" && !this.isLocalOnlineFinalist(bot.id)) return;
    const value = Math.max(0, Math.min(bot.score, Math.round(Number(rawValue) || 0)));
    this.offlineFinalWagerDrafts.set(bot.id, value);
  }

  confirmOfflineFinalWager(bot: OfflineBot): void {
    if (this.offlineGamePaused || this.offlineGamePhase !== "final-wager" || this.offlineFinalWagers.has(bot.id)) return;
    const wager = Math.max(0, Math.min(bot.score, this.offlineFinalWagerDrafts.get(bot.id) ?? 0));
    if (this.onlineRole === "participant") {
      if (!this.isLocalOnlineFinalist(bot.id)) return;
      this.offlineFinalWagers.set(bot.id, wager);
      void invoke("send_p2p_final_wager", { wager }).catch(() => {
        this.offlineFinalWagers.delete(bot.id);
        this.onlineFeedback = this.tr("Unable to submit the wager", "Не удалось отправить ставку");
      });
      return;
    }
    this.offlineFinalWagers.set(bot.id, wager);
    if (this.offlineFinalWagers.size >= this.offlineFinalists.length) this.finishOfflineFinalWagers();
    else this.scheduleOfflineBotWager();
  }

  setOfflineFinalAnswerDraft(botId: string, value: string): void {
    if (this.onlineRole === "participant" && !this.isLocalOnlineFinalist(botId)) return;
    this.offlineFinalAnswerDrafts.set(botId, value.slice(0, 240));
  }

  confirmOfflineFinalAnswer(botId: string): void {
    if (this.offlineGamePaused || this.offlineGamePhase !== "final-answers" || this.offlineFinalAnswers.has(botId)) return;
    const answer = (this.offlineFinalAnswerDrafts.get(botId) ?? "").trim();
    if (this.onlineRole === "participant") {
      if (!this.isLocalOnlineFinalist(botId)) return;
      this.offlineFinalAnswers.set(botId, answer || "—");
      void invoke("send_p2p_final_answer", { answer }).catch(() => {
        this.offlineFinalAnswers.delete(botId);
        this.onlineFeedback = this.tr("Unable to submit the final answer", "Не удалось отправить ответ финала");
      });
      return;
    }
    this.offlineFinalAnswers.set(botId, answer || "—");
    if (this.offlineFinalAnswers.size >= this.offlineFinalists.length) this.finishOfflineFinalAnswers();
    else this.scheduleOfflineBotFinalAnswer();
  }

  judgeOfflineFinalAnswer(botId: string, correct: boolean): void {
    if (!this.offlineFinalAnswersVisible || this.offlineFinalJudgements.has(botId)) return;
    const bot = this.offlineBots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    const wager = this.offlineFinalWagers.get(botId) ?? 0;
    this.addOfflineScore(bot, correct ? wager : -wager);
    this.offlineFinalJudgements.set(botId, correct);
    this.offlineHostAnimation = correct ? "thumbsUp" : "thumbsDown";
    this.offlineBotAnimations.set(botId, correct ? "victory" : "upset");
    if (this.offlineFinalJudgements.size >= this.offlineFinalists.length) {
      this.clearOfflineAnimationTimer();
      this.offlineQuestionStage = "answer-reveal";
      this.offlineAnimationTimer = setTimeout(() => this.finishOfflineGame(), 5000);
    }
  }

  private startOfflineFinal(): void {
    this.clearOfflineGameTimers();
    this.resetOfflineQuestionState();
    this.offlineIsFinalQuestion = false;
    this.offlineFinalThemes = [...(this.offlineGamePack?.finalThemes ?? [])];
    const contestants = this.offlineTeamMode
      ? this.offlineTeams.map((team) => team.members[0]).filter((bot): bot is OfflineBot => Boolean(bot))
      : this.offlineBots;
    this.offlineFinalistIds = contestants.filter((bot) => bot.score > 0).sort((left, right) => right.score - left.score).map((bot) => bot.id);
    this.offlineFinalTurnIndex = 0;
    this.offlineFinalWagers.clear();
    this.offlineFinalWagerDrafts.clear();
    this.offlineFinalAnswers.clear();
    this.offlineFinalAnswerDrafts.clear();
    this.offlineFinalJudgements.clear();
    this.offlineFinalWagersVisible = false;
    this.offlineFinalAnswersVisible = false;
    this.offlineWinnerBotId = null;
    this.offlineGamePhase = "final-elimination";
    this.offlinePhaseTimer = setTimeout(() => {
      if (this.offlineFinalists.length === 0) {
        this.finishOfflineGame();
      } else if (this.offlineFinalThemes.length <= 1) {
        this.startOfflineFinalWagers();
      } else {
        this.offlineGamePhase = "final-themes";
        this.scheduleOfflineFinalThemeRemoval();
      }
    }, 1100);
  }

  private scheduleOfflineFinalThemeRemoval(): void {
    if (this.offlineRoomMode === "hotseat" || this.offlineFinalTurnBot?.id === this.offlineHumanBotId) return;
    this.clearOfflineBotTimer();
    this.offlineBotTimer = setTimeout(() => {
      const theme = this.offlineFinalThemes[Math.floor(Math.random() * this.offlineFinalThemes.length)];
      if (theme) this.removeOfflineFinalTheme(theme.id);
    }, this.randomBotDelay());
  }

  private startOfflineFinalWagers(): void {
    this.clearOfflineGameTimers();
    this.offlineGamePhase = "final-wager";
    this.offlineFinalSeconds = 30;
    this.offlineFinalWagersVisible = false;
    for (const bot of this.offlineFinalists) this.offlineFinalWagerDrafts.set(bot.id, 0);
    this.startOfflineFinalCountdown(() => this.finishOfflineFinalWagers());
    this.scheduleOfflineBotWager();
  }

  private scheduleOfflineBotWager(): void {
    if (this.offlineRoomMode === "hotseat") return;
    this.clearOfflineBotTimer();
    const bot = this.offlineFinalists.find((candidate) => candidate.id !== this.offlineHumanBotId && !this.offlineFinalWagers.has(candidate.id));
    if (!bot) return;
    this.offlineBotTimer = setTimeout(() => {
      this.offlineFinalWagerDrafts.set(bot.id, Math.floor(Math.random() * (bot.score + 1)));
      this.confirmOfflineFinalWager(bot);
    }, this.randomBotDelay());
  }

  private finishOfflineFinalWagers(): void {
    this.clearOfflineFinalTimer();
    this.clearOfflineBotTimer();
    for (const bot of this.offlineFinalists) {
      if (!this.offlineFinalWagers.has(bot.id)) this.offlineFinalWagers.set(bot.id, 0);
    }
    this.offlineFinalWagersVisible = true;
    this.offlinePhaseTimer = setTimeout(() => this.playOfflineFinalQuestion(), 1800);
  }

  private playOfflineFinalQuestion(): void {
    const question = this.offlineFinalTheme?.questions[0];
    if (!question) {
      this.startOfflineFinalAnswers();
      return;
    }
    this.resetOfflineQuestionState();
    this.offlineIsFinalQuestion = true;
    this.offlineSelectedQuestion = question;
    this.offlineGamePhase = "final-question";
    this.beginOfflineQuestionPresentation();
  }

  private startOfflineFinalAnswers(): void {
    this.clearOfflineMediaTimer();
    this.clearOfflineTypeTimer();
    this.offlineHostAnimation = "idle";
    this.offlineGamePhase = "final-answers";
    this.offlineQuestionStage = "answering";
    this.offlineFinalSeconds = 30;
    this.offlineFinalAnswersVisible = false;
    this.startOfflineFinalCountdown(() => this.finishOfflineFinalAnswers());
    this.startQuestionTimerSound();
    this.scheduleOfflineBotFinalAnswer();
  }

  private scheduleOfflineBotFinalAnswer(): void {
    if (this.offlineRoomMode === "hotseat") return;
    this.clearOfflineBotTimer();
    const bot = this.offlineFinalists.find((candidate) => candidate.id !== this.offlineHumanBotId && !this.offlineFinalAnswers.has(candidate.id));
    if (!bot) return;
    this.offlineBotTimer = setTimeout(() => {
      const correctAnswer = this.offlineSelectedQuestion?.answerText.trim() ?? "";
      const answer = Math.random() < .6 && correctAnswer ? correctAnswer : this.tr("Answer option", "Вариант ответа");
      this.offlineFinalAnswerDrafts.set(bot.id, answer);
      this.confirmOfflineFinalAnswer(bot.id);
    }, this.randomBotDelay());
  }

  private finishOfflineFinalAnswers(): void {
    this.clearOfflineFinalTimer();
    this.clearOfflineBotTimer();
    this.stopQuestionTimerSound();
    for (const bot of this.offlineFinalists) {
      if (!this.offlineFinalAnswers.has(bot.id)) this.offlineFinalAnswers.set(bot.id, "—");
    }
    this.offlineFinalAnswersVisible = true;
    this.offlineQuestionStage = "judging";
  }

  private startOfflineFinalCountdown(onEnd: () => void): void {
    this.clearOfflineFinalTimer();
    this.offlineFinalTimer = setInterval(() => {
      this.offlineFinalSeconds -= 1;
      if (this.offlineFinalSeconds <= 0) onEnd();
    }, 1000);
  }

  private finishOfflineGame(): void {
    this.clearOfflineGameTimers();
    const finalists = this.offlineFinalists;
    const winner = finalists.reduce<OfflineBot | undefined>((best, bot) => !best || bot.score > best.score ? bot : best, undefined);
    this.offlineWinnerBotId = winner?.id ?? null;
    this.offlineHostAnimation = "idle";
    this.offlineBotAnimations.clear();
    if (winner) {
      const winners = this.offlineTeamMode ? this.offlineBots.filter((bot) => bot.team === winner.team) : [winner];
      winners.forEach((bot) => this.offlineBotAnimations.set(bot.id, "victory"));
    }
    this.offlineGamePhase = "winner";
  }

  private resumeOfflineGameState(): void {
    if (this.isCrowdGame) {
      if (this.offlineBotHostActive && this.crowdGamePhase === "round-intro") {
        this.offlinePhaseTimer = setTimeout(() => this.startCrowdRoundQuestion(), 700);
      } else if (this.offlineBotHostActive && this.crowdGamePhase === "round-result") {
        this.offlinePhaseTimer = setTimeout(() => this.continueCrowdGame(), 700);
      } else this.scheduleCrowdBotTurn();
      return;
    }
    if (this.offlineGamePhase === "round-title") {
      this.offlinePhaseTimer = setTimeout(() => {
        this.offlineGamePhase = "themes";
        this.resumeOfflineGameState();
      }, 1200);
      return;
    }
    if (this.offlineGamePhase === "themes") {
      this.offlinePhaseTimer = setTimeout(() => {
        if (this.offlineRoundIndex === 0 && !this.offlineChooserBotId) {
          this.offlineGamePhase = "chooser";
          if (this.offlineBotHostActive) this.scheduleOfflineBotHostFirstChooser();
        } else this.showOfflineBoard();
      }, 1600);
      return;
    }
    if (this.offlineGamePhase === "chooser" && this.offlineBotHostActive) {
      this.scheduleOfflineBotHostFirstChooser();
      return;
    }
    if (this.offlineGamePhase === "board") {
      if (this.offlineRoomMode === "bots") {
        this.offlineSelectionTimer = setInterval(() => {
          this.offlineSelectionSeconds -= 1;
          if (this.offlineSelectionSeconds <= 0) this.chooseRandomOfflineQuestion();
        }, 1000);
        this.scheduleOfflineBotQuestionChoice();
      }
      return;
    }
    if (this.offlineGamePhase === "question" || this.offlineGamePhase === "final-question") {
      if (this.offlineQuestionStage === "typing" && this.offlineSelectedQuestion) this.startOfflineQuestionTyping(this.offlineSelectedQuestion);
      else if (this.offlineQuestionStage === "text-hold") this.offlinePhaseTimer = setTimeout(() => this.showOfflineQuestionMedia(), 3000);
      else if (this.offlineQuestionStage === "cat-announcement") this.offlinePhaseTimer = setTimeout(() => { this.offlineQuestionStage = "cat-recipient"; this.scheduleOfflineCatRecipient(); }, 1000);
      else if (this.offlineQuestionStage === "cat-recipient") this.scheduleOfflineCatRecipient();
      else if (this.offlineQuestionStage === "cat-transfer") this.offlinePhaseTimer = setTimeout(() => this.beginOfflineQuestionPresentation(), 1000);
      else if (this.offlineQuestionStage === "media" && this.offlineSelectedQuestion?.media) {
        const media = this.offlineSelectedQuestion.media;
        const durationMs = media.type === "image"
          ? 3500
          : Math.ceil((media.durationSeconds ?? (media.type === "video" ? 15 : 30)) * 1000) + 1500;
        this.offlineMediaTimer = setTimeout(() => this.startOfflineAnswerWindow(), Math.max(3000, durationMs));
      }
      else if (this.offlineQuestionStage === "answering") { this.startOfflineAnswerCountdown(false); this.startQuestionTimerSound(); this.scheduleOfflineBotAnswer(); }
      else if (this.offlineQuestionStage === "answer-reveal" && ["correct", "timeout"].includes(this.offlinePendingJudgeResolution ?? "")) this.offlineAnimationTimer = setTimeout(() => { this.offlinePendingJudgeResolution = null; this.finishOfflineQuestion(); }, 5000);
      else if (this.offlineQuestionStage === "judging" && this.offlinePendingJudgeResolution === "wrong") this.offlineAnimationTimer = setTimeout(() => { this.offlinePendingJudgeResolution = null; this.offlineHostAnimation = "idle"; if (this.offlineResponderBotId) this.offlineBotAnimations.set(this.offlineResponderBotId, "idle"); this.offlineResponderBotId = null; this.offlineQuestionStage = "answering"; this.startOfflineAnswerCountdown(false); this.startQuestionTimerSound(); this.scheduleOfflineBotAnswer(); }, 900);
      else if (this.offlineQuestionStage === "judging" && this.offlineBotHostActive && this.offlineResponderBotId) {
        if (this.offlineBotHostPendingDecision !== null) {
          const decision = this.offlineBotHostPendingDecision;
          this.offlineBotJudgeTimer = setTimeout(() => { this.offlineBotJudgeTimer = null; this.judgeOfflineAnswer(decision); }, 700);
        } else this.waitForOfflineResponderChat(this.offlineResponderBotId);
      }
      return;
    }
    if (this.offlineGamePhase === "round-complete") {
      this.offlinePhaseTimer = setTimeout(() => {
        if (this.offlineGamePack && this.offlineRoundIndex + 1 < this.offlineGamePack.rounds.length) { this.offlineRoundIndex += 1; this.announceOfflineRound(false); }
        else this.startOfflineFinal();
      }, 1500);
      return;
    }
    if (this.offlineGamePhase === "final-elimination") {
      this.startOfflineFinal();
      return;
    }
    if (this.offlineGamePhase === "final-themes") {
      if (this.offlineFinalThemes.length <= 1) this.offlinePhaseTimer = setTimeout(() => this.startOfflineFinalWagers(), 800);
      else this.scheduleOfflineFinalThemeRemoval();
      return;
    }
    if (this.offlineGamePhase === "final-wager") {
      if (this.offlineFinalWagersVisible) this.offlinePhaseTimer = setTimeout(() => this.playOfflineFinalQuestion(), 900);
      else { this.startOfflineFinalCountdown(() => this.finishOfflineFinalWagers()); this.scheduleOfflineBotWager(); }
      return;
    }
    if (this.offlineGamePhase === "final-answers" && this.offlineQuestionStage === "answer-reveal") {
      this.offlineAnimationTimer = setTimeout(() => this.finishOfflineGame(), 5000);
    } else if (this.offlineGamePhase === "final-answers" && !this.offlineFinalAnswersVisible) {
      this.startOfflineFinalCountdown(() => this.finishOfflineFinalAnswers());
      this.scheduleOfflineBotFinalAnswer();
    } else if (this.offlineGamePhase === "final-answers" && this.offlineFinalAnswersVisible && this.offlineFinalJudgements.size >= this.offlineFinalists.length) {
      this.offlineAnimationTimer = setTimeout(() => this.finishOfflineGame(), 5000);
    }
  }

  private resetOfflineQuestionState(): void {
    this.stopQuestionTimerSound();
    this.offlineSelectedQuestion = null;
    this.offlineTypedQuestionText = "";
    this.offlineQuestionMediaVisible = false;
    this.clearOfflineMediaSource();
    this.offlineQuestionStage = "typing";
    this.offlineResponderBotId = null;
    this.offlineCatRecipientBotId = null;
    this.offlineLastWrongBotId = null;
    this.offlinePendingJudgeResolution = null;
    this.offlineBotHostPendingDecision = null;
    this.offlineHostAnimation = "idle";
    this.clearOfflineTypeTimer();
    this.clearOfflineAnswerTimer();
    this.clearOfflineMediaTimer();
    this.clearOfflineAnimationTimer();
  }

  private clearOfflineRoomMessages(): void {
    this.offlineMessageTimers.forEach((timer) => clearTimeout(timer));
    this.offlineAuraBoostTimers.forEach((timer) => clearTimeout(timer));
    this.offlineMessageTimers.clear();
    this.offlineAuraBoostTimers.clear();
    this.offlineRoomMessages.clear();
    this.offlineAuraBoosts.clear();
    this.offlineActionPulseTimers.forEach((timer) => clearTimeout(timer));
    this.offlineFalseStartTimers.forEach((timer) => clearTimeout(timer));
    this.offlineActionPulseTimers.clear();
    this.offlineFalseStartTimers.clear();
    this.offlineActionPressedIds.clear();
    this.offlineFalseStartIds.clear();
    this.offlineChatOpen = false;
    this.offlineChatDraft = "";
  }

  private playOfflineBotAnimation(botId: string, animation: AvatarAnimationName, duration: number): void {
    this.offlineBotAnimations.set(botId, animation);
    this.clearOfflineAnimationTimer();
    this.offlineAnimationTimer = setTimeout(() => this.offlineBotAnimations.set(botId, "idle"), duration);
  }

  private clearOfflineSelectionTimer(): void {
    if (this.offlineSelectionTimer) clearInterval(this.offlineSelectionTimer);
    this.offlineSelectionTimer = null;
  }

  private clearOfflineTypeTimer(): void {
    if (this.offlineTypeTimer) clearInterval(this.offlineTypeTimer);
    this.offlineTypeTimer = null;
  }

  private clearOfflineAnswerTimer(): void {
    if (this.offlineAnswerTimer) clearInterval(this.offlineAnswerTimer);
    this.offlineAnswerTimer = null;
  }

  private clearOfflineBotTimer(): void {
    if (this.offlineBotTimer) clearTimeout(this.offlineBotTimer);
    this.offlineBotTimer = null;
  }

  private clearOfflineBotJudgeTimer(): void {
    if (this.offlineBotJudgeTimer) clearTimeout(this.offlineBotJudgeTimer);
    this.offlineBotJudgeTimer = null;
  }

  private clearOfflineMediaTimer(): void {
    if (this.offlineMediaTimer) clearTimeout(this.offlineMediaTimer);
    this.offlineMediaTimer = null;
  }

  private createMediaObjectUrl(media: PackMedia): string {
    if (!media.dataUrl.startsWith("data:")) return media.dataUrl;
    const commaIndex = media.dataUrl.indexOf(",");
    if (commaIndex < 0) throw new Error("Invalid media data URL");
    const metadata = media.dataUrl.slice(0, commaIndex);
    const payload = media.dataUrl.slice(commaIndex + 1);
    const decoded = metadata.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    this.offlineMediaObjectUrl = URL.createObjectURL(new Blob([bytes], { type: media.mimeType }));
    return this.offlineMediaObjectUrl;
  }

  private clearOfflineMediaSource(): void {
    if (this.offlineMediaObjectUrl) URL.revokeObjectURL(this.offlineMediaObjectUrl);
    this.offlineMediaObjectUrl = null;
    this.offlineQuestionMediaUrl = "";
  }

  private clearOfflineAnimationTimer(): void {
    if (this.offlineAnimationTimer) clearTimeout(this.offlineAnimationTimer);
    this.offlineAnimationTimer = null;
  }

  private clearOfflineFinalTimer(): void {
    if (this.offlineFinalTimer) clearInterval(this.offlineFinalTimer);
    this.offlineFinalTimer = null;
  }

  private clearOfflineGameTimers(): void {
    if (this.offlinePhaseTimer) clearTimeout(this.offlinePhaseTimer);
    this.offlinePhaseTimer = null;
    this.clearOfflineSelectionTimer();
    this.clearOfflineTypeTimer();
    this.clearOfflineAnswerTimer();
    this.clearOfflineBotTimer();
    this.clearOfflineBotJudgeTimer();
    this.clearOfflineMediaTimer();
    this.clearOfflineAnimationTimer();
    this.clearOfflineFinalTimer();
  }

  openScoreEditor(targetId: string): void {
    if (!this.offlineBots.some((bot) => bot.id === targetId)) return;
    this.scoreEditorTargetId = targetId;
    this.scoreEditorValue = this.offlineBots.find((bot) => bot.id === targetId)?.score ?? 0;
  }

  closeScoreEditor(): void {
    this.scoreEditorTargetId = null;
  }

  saveScore(): void {
    if (!this.scoreEditorTargetId) return;
    const score = Math.max(-999999, Math.min(999999, Math.round(Number(this.scoreEditorValue) || 0)));
    const bot = this.offlineBots.find((candidate) => candidate.id === this.scoreEditorTargetId);
    if (bot) this.setOfflineScore(bot, score);
    this.scoreEditorTargetId = null;
  }

  private randomBotAvatarId(): AvatarDefinition["id"] {
    const avatars = this.availableBotAvatars;
    return avatars[Math.floor(Math.random() * avatars.length)]?.id ?? "male";
  }

  async openPacks(): Promise<void> {
    this.playClick();
    this.view = "packs";
    this.packFeedback = "";
    this.isLoadingPacks = true;
    try {
      const listing = await this.packStorage.list();
      this.packSummaries = listing.packs;
      this.packsDirectory = listing.directory;
    } catch {
      this.packFeedback = this.tr("Unable to read the packs folder", "Не удалось прочитать папку packs");
    } finally {
      this.isLoadingPacks = false;
    }
  }

  async importPackFile(): Promise<void> {
    if (this.isImportingPack || this.isChangingPacksDirectory || this.packOperationFileName) return;
    this.packFeedback = "";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: this.tr("Import a game pack", "Импорт игрового пака"),
      filters: [{ name: this.tr("Mind Jam pack", "Пак Mind Jam"), extensions: ["json"] }],
    });
    if (!sourcePath) return;
    this.isImportingPack = true;
    try {
      const imported = await this.packStorage.import(sourcePath);
      const listing = await this.packStorage.list();
      this.packSummaries = listing.packs;
      this.packsDirectory = listing.directory;
      this.packFeedback = this.tr(`Pack “${imported.name}” imported`, `Пак «${imported.name}» импортирован`);
    } catch {
      this.packFeedback = this.tr("Unable to import this pack. Check that it is a valid Mind Jam JSON pack.", "Не удалось импортировать пак. Проверьте, что это корректный JSON-пак Mind Jam.");
    } finally {
      this.isImportingPack = false;
    }
  }

  async exportPack(summary: PackSummary): Promise<void> {
    if (this.isImportingPack || this.isChangingPacksDirectory || this.packOperationFileName) return;
    this.packFeedback = "";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const directoryPath = await open({
      multiple: false,
      directory: true,
      title: this.tr("Choose a folder for the pack", "Выберите папку для пака"),
    });
    if (!directoryPath) return;
    this.packOperationFileName = summary.fileName;
    try {
      const exportedPath = await this.packStorage.export(summary.fileName, directoryPath);
      this.packFeedback = this.tr(`Pack exported to ${exportedPath}`, `Пак экспортирован: ${exportedPath}`);
    } catch {
      this.packFeedback = this.tr("Unable to export this pack", "Не удалось экспортировать пак");
    } finally {
      this.packOperationFileName = null;
    }
  }

  async deletePack(summary: PackSummary): Promise<void> {
    if (this.isImportingPack || this.isChangingPacksDirectory || this.packOperationFileName) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const approved = await confirm(
      this.tr(`Delete “${summary.name}”? This cannot be undone.`, `Удалить «${summary.name}»? Это действие нельзя отменить.`),
      { title: "Mind Jam", kind: "warning" },
    );
    if (!approved) return;
    this.packOperationFileName = summary.fileName;
    try {
      await this.packStorage.delete(summary.fileName);
      this.packSummaries = this.packSummaries.filter((pack) => pack.fileName !== summary.fileName);
      if (this.selectedOfflinePackFile === summary.fileName) this.selectedOfflinePackFile = "";
      this.packFeedback = this.tr(`Pack “${summary.name}” deleted`, `Пак «${summary.name}» удалён`);
    } catch {
      this.packFeedback = this.tr("Unable to delete this pack", "Не удалось удалить пак");
    } finally {
      this.packOperationFileName = null;
    }
  }

  async changePacksDirectory(): Promise<void> {
    if (this.isLoadingPacks || this.isImportingPack || this.isChangingPacksDirectory || this.packOperationFileName) return;
    this.packFeedback = "";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const directoryPath = await open({
      multiple: false,
      directory: true,
      title: this.tr("Choose the packs folder", "Выберите папку паков"),
    });
    if (!directoryPath) return;
    this.isChangingPacksDirectory = true;
    try {
      const listing = await this.packStorage.setDirectory(directoryPath);
      this.packSummaries = listing.packs;
      this.packsDirectory = listing.directory;
      this.selectedOfflinePackFile = "";
      this.onlineSelectedPackFile = "";
      this.packFeedback = this.tr(
        "Packs folder changed. Existing files were left in their previous folder.",
        "Папка паков изменена. Существующие файлы остались в прежней папке.",
      );
    } catch {
      this.packFeedback = this.tr(
        "Unable to use this folder. Check that it exists and is writable.",
        "Не удалось использовать эту папку. Проверьте, что она существует и доступна для записи.",
      );
    } finally {
      this.isChangingPacksDirectory = false;
    }
  }

  startPackSetup(): void {
    this.playClick();
    this.newPackName = "";
    this.newPackType = "topic-clash";
    this.newPackTags = [];
    this.packFeedback = "";
    this.view = "pack-setup";
  }

  createPackDraft(): void {
    this.playClick();
    const name = this.newPackName.trim();
    if (!name) {
      this.packFeedback = this.tr("Enter a pack name", "Введите название пака");
      return;
    }
    const now = new Date().toISOString();
    this.packDraft = {
      schemaVersion: 1,
      id: this.makeId("pack"),
      name,
      gameType: this.newPackType,
      createdAt: now,
      updatedAt: now,
      tags: [...this.newPackTags],
      rounds: this.newPackType === "topic-clash" ? [this.makeRound(1), this.makeRound(2)] : [],
      finalThemes: this.newPackType === "topic-clash"
        ? [this.makeTheme(true), this.makeTheme(true), this.makeTheme(true)]
        : [],
      crowdRounds: this.newPackType === "crowd-code"
        ? (["simple", "double", "triple", "reverse", "big"] as CrowdRoundKind[]).map((kind) => this.makeCrowdRound(kind))
        : [],
    };
    this.activeRoundIndex = 0;
    this.expandedQuestionId = null;
    this.packFeedback = "";
    this.view = "pack-editor";
  }

  toggleNewPackTag(tag: PackTag, checked: boolean): void {
    if (checked && !this.newPackTags.includes(tag) && this.newPackTags.length < 3) {
      this.newPackTags = [...this.newPackTags, tag];
    } else if (!checked) {
      this.newPackTags = this.newPackTags.filter((candidate) => candidate !== tag);
    }
  }

  togglePackTag(pack: GamePack, tag: PackTag, checked: boolean): void {
    if (checked && !pack.tags.includes(tag) && pack.tags.length < 3) {
      pack.tags = [...pack.tags, tag];
    } else if (!checked) {
      pack.tags = pack.tags.filter((candidate) => candidate !== tag);
    }
  }

  async editPack(summary: PackSummary): Promise<void> {
    this.playClick();
    this.packFeedback = "";
    try {
      this.packDraft = await this.packStorage.load(summary.fileName);
      this.normalizePackQuestions(this.packDraft);
      this.activeRoundIndex = 0;
      this.expandedQuestionId = null;
      this.view = "pack-editor";
    } catch {
      this.packFeedback = this.tr("Unable to open this pack", "Не удалось открыть пак");
    }
  }

  backFromPackEditor(): void {
    this.playClick();
    this.packDraft = null;
    void this.openPacks();
  }

  selectEditorRound(index: number): void {
    this.activeRoundIndex = index;
    this.expandedQuestionId = null;
  }

  toggleQuestion(event: MouseEvent, questionId: string): void {
    event.preventDefault();
    this.expandedQuestionId = this.expandedQuestionId === questionId ? null : questionId;
  }

  isStandardQuestionComplete(question: PackQuestion): boolean {
    return Boolean(
      (question.text.trim() || question.media)
      && question.answerText.trim()
      && question.value !== null
      && (!question.isCatInBag || question.catValue !== null),
    );
  }

  isStandardThemeComplete(theme: PackTheme): boolean {
    return Boolean(theme.name.trim())
      && theme.questions.length >= 4
      && theme.questions.length <= 9
      && theme.questions.every((question) => this.isStandardQuestionComplete(question));
  }

  addRound(): void {
    if (!this.packDraft || this.packDraft.rounds.length >= 8) return;
    this.playClick();
    this.packDraft.rounds.push(this.makeRound(this.packDraft.rounds.length + 1));
    this.activeRoundIndex = this.packDraft.rounds.length - 1;
  }

  removeRound(index: number): void {
    if (!this.packDraft || this.packDraft.rounds.length <= 2) return;
    this.playClick();
    this.packDraft.rounds.splice(index, 1);
    this.activeRoundIndex = Math.min(this.activeRoundIndex, this.packDraft.rounds.length - 1);
  }

  addTheme(round: PackRound): void {
    if (round.themes.length >= 8) return;
    this.playClick();
    const roundNumber = Math.max(1, (this.packDraft?.rounds.indexOf(round) ?? 0) + 1);
    round.themes.push(this.makeTheme(false, roundNumber));
  }

  removeTheme(round: PackRound, index: number): void {
    if (round.themes.length <= 3) return;
    this.playClick();
    round.themes.splice(index, 1);
  }

  addQuestion(theme: PackTheme): void {
    if (theme.questions.length >= 9) return;
    this.playClick();
    const roundNumber = Math.max(1, (this.packDraft?.rounds.findIndex((round) => round.themes.includes(theme)) ?? 0) + 1);
    theme.questions.push(this.makeQuestion(roundNumber, theme.questions.length + 1));
  }

  removeQuestion(theme: PackTheme, index: number): void {
    if (theme.questions.length <= 4) return;
    this.playClick();
    const [removed] = theme.questions.splice(index, 1);
    if (removed?.id === this.expandedQuestionId) this.expandedQuestionId = null;
  }

  addFinalTheme(): void {
    if (!this.packDraft || this.packDraft.finalThemes.length >= 12) return;
    this.playClick();
    this.packDraft.finalThemes.push(this.makeTheme(true));
  }

  removeFinalTheme(index: number): void {
    if (!this.packDraft || this.packDraft.finalThemes.length <= 3) return;
    this.playClick();
    this.packDraft.finalThemes.splice(index, 1);
  }

  setQuestionValue(question: PackQuestion, rawValue: string): void {
    question.value = rawValue === "" ? null : Number(rawValue);
  }

  setCatInBag(question: PackQuestion, enabled: boolean): void {
    question.isCatInBag = enabled;
    if (!enabled) question.catValue = null;
  }

  setCatValue(question: PackQuestion, rawValue: string): void {
    question.catValue = rawValue === "" ? null : Number(rawValue);
  }

  async attachQuestionMedia(question: PackQuestion, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      question.media = await this.readMedia(file, false);
      this.packFeedback = "";
    } catch (error) {
      input.value = "";
      this.packFeedback = error instanceof Error ? error.message : this.tr("Unable to attach media", "Не удалось добавить медиа");
    }
  }

  async attachAnswerImage(question: PackQuestion, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      question.answerImage = await this.readMedia(file, true);
      this.packFeedback = "";
    } catch (error) {
      input.value = "";
      this.packFeedback = error instanceof Error ? error.message : this.tr("Unable to attach the image", "Не удалось добавить изображение");
    }
  }

  async saveCurrentPack(): Promise<void> {
    if (!this.packDraft || this.isSavingPack) return;
    this.playClick();
    this.normalizePackQuestions(this.packDraft);
    const validationError = this.validatePack(this.packDraft);
    if (validationError) {
      this.packFeedback = validationError;
      return;
    }
    this.isSavingPack = true;
    this.packFeedback = "";
    this.packDraft.updatedAt = new Date().toISOString();
    try {
      await this.packStorage.save(this.packDraft);
      this.packFeedback = this.tr("Pack saved", "Пак сохранён");
    } catch {
      this.packFeedback = this.tr("Unable to save the pack", "Не удалось сохранить пак");
    } finally {
      this.isSavingPack = false;
    }
  }

  private makeId(prefix: string): string {
    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${id}`;
  }

  private makeRound(index: number): PackRound {
    return {
      id: this.makeId("round"),
      name: this.tr(`Round ${index}`, `Раунд ${index}`),
      themes: [this.makeTheme(false, index), this.makeTheme(false, index), this.makeTheme(false, index)],
    };
  }

  private makeTheme(isFinal: boolean, roundNumber = 1): PackTheme {
    return {
      id: this.makeId("theme"),
      name: "",
      questions: isFinal
        ? [this.makeQuestion()]
        : Array.from({ length: 4 }, (_, questionIndex) => this.makeQuestion(roundNumber, questionIndex + 1)),
    };
  }

  private makeQuestion(roundNumber?: number, questionNumber?: number): PackQuestion {
    return {
      id: this.makeId("question"),
      text: "",
      value: roundNumber && questionNumber ? 100 * roundNumber * questionNumber : null,
      isCatInBag: false,
      catValue: null,
      media: null,
      answerText: "",
      answerImage: null,
    };
  }

  crowdRoundLabel(kind: CrowdRoundKind): string {
    const labels: Record<CrowdRoundKind, [string, string]> = {
      simple: ["Simple game", "Простая игра"], double: ["Double game", "Двойная игра"],
      triple: ["Triple game", "Тройная игра"], reverse: ["Reverse game", "Игра наоборот"],
      big: ["Big game", "Большая игра"],
    };
    return this.tr(...labels[kind]);
  }

  addCrowdQuestion(round: CrowdRound): void {
    if (round.questions.length >= 8) return;
    round.questions.push(this.makeCrowdQuestion(round.kind));
  }

  removeCrowdQuestion(round: CrowdRound, index: number): void {
    if (round.questions.length <= 1) return;
    round.questions.splice(index, 1);
  }

  addCrowdAnswer(question: CrowdQuestion): void {
    const max = this.crowdQuestionRoundKind(question) === "big" ? 15 : 12;
    if (question.answers.length >= max) return;
    question.answers.push({ id: this.makeId("answer"), text: "", points: Math.max(1, 100 - question.answers.length * 10) });
  }

  removeCrowdAnswer(question: CrowdQuestion, index: number): void {
    const min = this.crowdQuestionRoundKind(question) === "big" ? 15 : 6;
    if (question.answers.length <= min) return;
    question.answers.splice(index, 1);
  }

  setCrowdAnswerPoints(answer: CrowdAnswer, raw: string): void {
    answer.points = Math.max(1, Math.min(999, Math.round(Number(raw) || 1)));
  }

  async attachCrowdQuestionImage(question: CrowdQuestion, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await this.readMedia(file, true);
      question.image = image;
      this.packFeedback = "";
    } catch (error) {
      input.value = "";
      this.packFeedback = error instanceof Error ? error.message : this.tr("Unable to attach the image", "Не удалось добавить изображение");
    }
  }

  private crowdQuestionRoundKind(question: CrowdQuestion): CrowdRoundKind | undefined {
    return this.packDraft?.crowdRounds.find((round) => round.questions.includes(question))?.kind;
  }

  private makeCrowdRound(kind: CrowdRoundKind): CrowdRound {
    return { id: this.makeId("crowd-round"), name: this.crowdRoundLabel(kind), kind, questions: [this.makeCrowdQuestion(kind)] };
  }

  private makeCrowdQuestion(kind: CrowdRoundKind): CrowdQuestion {
    const answerCount = kind === "big" ? 15 : 6;
    return {
      id: this.makeId("crowd-question"), text: "", image: null,
      answers: Array.from({ length: answerCount }, (_, index) => ({
        id: this.makeId("answer"), text: "", points: Math.max(1, 100 - index * (kind === "big" ? 6 : 12)),
      })),
    };
  }

  private normalizePackQuestions(pack: GamePack): void {
    pack.rounds = Array.isArray(pack.rounds) ? pack.rounds : [];
    pack.finalThemes = Array.isArray(pack.finalThemes) ? pack.finalThemes : [];
    pack.crowdRounds = Array.isArray(pack.crowdRounds) ? pack.crowdRounds : [];
    pack.tags = Array.isArray(pack.tags)
      ? pack.tags.filter((tag): tag is PackTag => this.packTagOptions.includes(tag as PackTag)).slice(0, 3)
      : [];
    for (const round of pack.rounds) {
      for (const theme of round.themes) {
        for (const question of theme.questions) {
          question.isCatInBag = question.isCatInBag === true;
          question.catValue = question.isCatInBag && typeof question.catValue === "number"
            ? question.catValue
            : null;
        }
      }
    }
    for (const theme of pack.finalThemes) {
      for (const question of theme.questions) {
        question.value = null;
        question.isCatInBag = false;
        question.catValue = null;
      }
    }
    for (const round of pack.crowdRounds) {
      round.questions = Array.isArray(round.questions) ? round.questions : [];
      for (const question of round.questions) {
        question.image = question.image?.type === "image" ? question.image : null;
        question.answers = Array.isArray(question.answers) ? question.answers : [];
      }
    }
  }

  private async readMedia(file: File, answerOnly: boolean): Promise<PackMedia> {
    const type = file.type.startsWith("image/") ? "image"
      : file.type.startsWith("video/") ? "video"
      : file.type.startsWith("audio/") ? "audio"
      : null;
    if (!type || (answerOnly && type !== "image")) {
      throw new Error(answerOnly
        ? this.tr("Only an image can be attached to an answer", "К ответу можно прикрепить только изображение")
        : this.tr("Choose an image, video or audio file", "Выберите изображение, видео или аудиофайл"));
    }

    let durationSeconds: number | undefined;
    if (type === "video" || type === "audio") {
      durationSeconds = await this.mediaDuration(file, type);
      const limit = type === "video" ? 15 : 30;
      if (durationSeconds > limit + 0.05) {
        throw new Error(type === "video"
          ? this.tr("Video must be no longer than 15 seconds", "Видео должно быть не длиннее 15 секунд")
          : this.tr("Audio must be no longer than 30 seconds", "Аудио должно быть не длиннее 30 секунд"));
      }
    }

    return { type, name: file.name, mimeType: file.type, dataUrl: await this.fileAsDataUrl(file), durationSeconds };
  }

  private mediaDuration(file: File, type: "video" | "audio"): Promise<number> {
    return new Promise((resolve, reject) => {
      const element = document.createElement(type);
      const objectUrl = URL.createObjectURL(file);
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        URL.revokeObjectURL(objectUrl);
        Number.isFinite(element.duration) ? resolve(element.duration) : reject(new Error("Invalid duration"));
      };
      element.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(this.tr("Unable to read media duration", "Не удалось определить длительность файла")));
      };
      element.src = objectUrl;
    });
  }

  private fileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private validatePack(pack: GamePack): string | null {
    if (!pack.name.trim()) return this.tr("Pack name is required", "Название пака обязательно");
    if (pack.gameType === "crowd-code") return this.validateCrowdPack(pack);
    if (pack.rounds.length < 2 || pack.rounds.length > 8) return this.tr("There must be 2–8 rounds", "Количество раундов должно быть от 2 до 8");
    if (pack.finalThemes.length < 3 || pack.finalThemes.length > 12) return this.tr("The final must contain 3–12 themes", "В финале должно быть от 3 до 12 тем");

    for (const [roundIndex, round] of pack.rounds.entries()) {
      if (!round.name.trim()) return this.tr(`Enter the name of round ${roundIndex + 1}`, `Введите название раунда ${roundIndex + 1}`);
      if (round.themes.length < 3 || round.themes.length > 8) return this.tr("Each round must contain 3–8 themes", "В каждом раунде должно быть от 3 до 8 тем");
      for (const [themeIndex, theme] of round.themes.entries()) {
        const error = this.validateTheme(theme, false);
        if (error) return this.tr(`Round ${roundIndex + 1}, theme ${themeIndex + 1}: ${error}`, `Раунд ${roundIndex + 1}, тема ${themeIndex + 1}: ${error}`);
      }
    }
    for (const [themeIndex, theme] of pack.finalThemes.entries()) {
      const error = this.validateTheme(theme, true);
      if (error) return this.tr(`Final, theme ${themeIndex + 1}: ${error}`, `Финал, тема ${themeIndex + 1}: ${error}`);
    }
    return null;
  }

  private validateCrowdPack(pack: GamePack): string | null {
    const requiredKinds: CrowdRoundKind[] = ["simple", "double", "triple", "reverse", "big"];
    for (const kind of requiredKinds) {
      if (!pack.crowdRounds.some((round) => round.kind === kind)) {
        return this.tr(`Add the “${this.crowdRoundLabel(kind)}” stage`, `Добавьте этап «${this.crowdRoundLabel(kind)}»`);
      }
    }
    for (const [roundIndex, round] of pack.crowdRounds.entries()) {
      if (!round.name.trim()) return this.tr(`Enter the name of stage ${roundIndex + 1}`, `Введите название этапа ${roundIndex + 1}`);
      if (round.questions.length < 1 || round.questions.length > 8) return this.tr("Each stage must contain 1–8 questions", "В каждом этапе должно быть от 1 до 8 вопросов");
      for (const [questionIndex, question] of round.questions.entries()) {
        if (!question.text.trim()) return this.tr(`Stage ${roundIndex + 1}, question ${questionIndex + 1}: enter question text`, `Этап ${roundIndex + 1}, вопрос ${questionIndex + 1}: введите текст вопроса`);
        const min = round.kind === "big" ? 15 : 6;
        const max = round.kind === "big" ? 15 : 12;
        if (question.answers.length < min || question.answers.length > max) return this.tr(`This question needs ${min}–${max} answers`, `В этом вопросе должно быть ${min}–${max} ответов`);
        if (question.answers.some((answer) => !answer.text.trim() || answer.points < 1)) return this.tr("Fill every answer and its points", "Заполните все ответы и очки");
      }
    }
    return null;
  }

  private validateTheme(theme: PackTheme, isFinal: boolean): string | null {
    if (!theme.name.trim()) return this.tr("theme name is required", "нужно название темы");
    const min = isFinal ? 1 : 4;
    const max = isFinal ? 1 : 9;
    if (theme.questions.length < min || theme.questions.length > max) return this.tr(`there must be ${min}–${max} questions`, `должно быть вопросов: ${min}–${max}`);
    for (const [questionIndex, question] of theme.questions.entries()) {
      if (!question.text.trim() && !question.media) return this.tr(`question ${questionIndex + 1} needs text or media`, `в вопросе ${questionIndex + 1} нужен текст или медиафайл`);
      if (!question.answerText.trim()) return this.tr(`question ${questionIndex + 1} needs a text answer`, `в вопросе ${questionIndex + 1} нужен текст ответа`);
      if (!isFinal && question.value === null) return this.tr(`question ${questionIndex + 1} needs a value`, `в вопросе ${questionIndex + 1} нужна ценность`);
      if (!isFinal && question.isCatInBag && question.catValue === null) return this.tr(`question ${questionIndex + 1} needs a second value`, `в вопросе ${questionIndex + 1} нужна вторая ценность`);
    }
    return null;
  }

  setVolume(kind: VolumeSetting, value: string): void {
    this.settings = { ...this.settings, [kind]: Number(value) };
    if (this.questionTimerAudio) this.questionTimerAudio.volume = this.settings.masterVolume / 100 * this.settings.musicVolume / 100;
    this.applyMediaVolumes();
    this.saveSettings();
  }

  setLanguage(language: Language): void {
    this.playClick();
    this.settings = { ...this.settings, language };
    document.documentElement.lang = language;
    this.saveSettings();
  }

  async setDisplay(displayId: string): Promise<void> {
    this.settings = { ...this.settings, displayId: Number(displayId) };
    this.saveSettings();
    await this.applyDisplaySettings();
  }

  async setResolution(resolution: string): Promise<void> {
    this.settings = { ...this.settings, resolution };
    this.saveSettings();
    await this.applyDisplaySettings();
  }

  async setDisplayMode(displayMode: DisplayMode): Promise<void> {
    this.settings = { ...this.settings, displayMode };
    this.saveSettings();
    await this.applyDisplaySettings();
  }

  setPushToTalk(enabled: boolean): void {
    this.settings = { ...this.settings, pushToTalk: enabled };
    this.saveSettings();
    this.isPushToTalkPressed = false;
    if (enabled) this.stopMicrophoneTest();
    else if (this.view === "offline-game" && !this.offlineGamePaused) void this.startRoomMicrophoneMonitoring();
  }

  setBinding(setting: BindingSetting, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.settings = { ...this.settings, [setting]: event.code };
    this.saveSettings();
    (event.currentTarget as HTMLElement | null)?.blur();
  }

  keyLabel(code: string): string {
    const labels: Record<string, string> = {
      Space: this.tr("Space", "Пробел"),
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl",
      ShiftLeft: "Shift",
      ShiftRight: "Shift",
      AltLeft: "Alt",
      AltRight: "Alt",
      Enter: "Enter",
      Escape: "Esc",
    };
    return labels[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "");
  }

  private async loadDisplays(applySavedSettings: boolean): Promise<void> {
    try {
      const monitors = await availableMonitors();
      this.displayOptions = monitors.map((monitor, index) => ({
        id: index,
        label: `${monitor.name || `${this.t("display")} ${index + 1}`} · ${monitor.size.width}×${monitor.size.height}`,
        monitor,
      }));
      const nativeResolutions = monitors.map((monitor) => `${monitor.size.width}x${monitor.size.height}`);
      this.resolutionOptions = [...new Set([...this.resolutionOptions, ...nativeResolutions])]
        .sort((left, right) => Number(left.split("x")[0]) - Number(right.split("x")[0]));
      if (!this.displayOptions.some((display) => display.id === this.settings.displayId)) {
        this.settings = { ...this.settings, displayId: 0 };
        this.saveSettings();
      }
      if (applySavedSettings) await this.applyDisplaySettings();
    } catch {
      this.displayOptions = [];
    }
  }

  private async applyDisplaySettings(): Promise<void> {
    const selected = this.displayOptions.find((display) => display.id === this.settings.displayId)?.monitor;
    if (!selected) return;
    const appWindow = getCurrentWindow();
    await appWindow.setFullscreen(false);
    const [rawWidth, rawHeight] = this.settings.resolution.split("x").map(Number);
    const width = Math.min(rawWidth || 1280, selected.size.width);
    const height = Math.min(rawHeight || 720, selected.size.height);
    if (this.settings.displayMode === "fullscreen") {
      await appWindow.setDecorations(true);
      await appWindow.setPosition(new PhysicalPosition(selected.position.x, selected.position.y));
      await appWindow.setFullscreen(true);
      return;
    }
    if (this.settings.displayMode === "borderless") {
      await appWindow.setDecorations(false);
      await appWindow.setPosition(new PhysicalPosition(selected.position.x, selected.position.y));
      await appWindow.setSize(new PhysicalSize(selected.size.width, selected.size.height));
      return;
    }
    await appWindow.setDecorations(true);
    await appWindow.setSize(new PhysicalSize(width, height));
    await appWindow.setPosition(new PhysicalPosition(
      selected.position.x + Math.max(0, Math.round((selected.size.width - width) / 2)),
      selected.position.y + Math.max(0, Math.round((selected.size.height - height) / 2)),
    ));
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.playClick();
    try {
      await invoke("set_output_device", { deviceId });
      this.settings = { ...this.settings, outputDeviceId: deviceId };
      this.saveSettings();
      this.deviceFeedback = "";
    } catch {
      this.deviceFeedback = this.t("outputUnsupported");
    }
  }

  setInputDevice(deviceId: string): void {
    this.playClick();
    this.settings = { ...this.settings, inputDeviceId: deviceId };
    this.saveSettings();
    if (this.microphoneCaptureMode === "test") void this.startMicrophoneTest();
    else if (this.microphoneCaptureMode === "room") void this.startRoomMicrophoneMonitoring();
  }

  setMicrophoneSensitivity(rawValue: string): void {
    const microphoneSensitivity = Math.min(200, Math.max(25, Math.round(Number(rawValue) || 100)));
    this.settings = { ...this.settings, microphoneSensitivity };
    this.saveSettings();
  }

  async toggleMicrophoneTest(): Promise<void> {
    this.playClick();
    if (this.isTestingMicrophone) this.stopMicrophoneTest();
    else await this.startMicrophoneTest();
  }

  private loadSettings(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.settingsStorageKey) ?? "null") as Partial<AudioSettings> | null;
      if (saved) this.settings = { ...this.settings, ...saved };
    } catch { localStorage.removeItem(this.settingsStorageKey); }
    document.documentElement.lang = this.settings.language;
  }
  private saveSettings(): void { localStorage.setItem(this.settingsStorageKey, JSON.stringify(this.settings)); }

  private applyMediaVolumes(): void {
    document.querySelectorAll("audio, video").forEach((element) => {
      if (element instanceof HTMLMediaElement) element.volume = this.mediaPlaybackVolume;
    });
  }

  private playClick(): void {
    const now = performance.now();
    if (now - this.lastClickSoundAt < 35) return;
    this.lastClickSoundAt = now;
    if (this.settings.masterVolume === 0 || this.settings.effectsVolume === 0) return;
    void invoke("play_tone", {
      frequency: 440,
      duration: 0.085,
      waveform: "sine",
      volume: 0.05 * this.settings.masterVolume / 100 * this.settings.effectsVolume / 100,
    }).catch(() => undefined);
  }

  private startMusic(): void {
    if (this.musicTimer) return;
    this.playBeatStep();
    this.musicTimer = setInterval(() => this.playBeatStep(), 280);
  }
  private stopMusic(): void { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; this.beatStep = 0; }

  private startQuestionTimerSound(): void {
    if (this.questionTimerSoundActive) return;
    this.questionTimerSoundActive = true;
    this.stopMusic();
    const clock = new Audio("assets/soundlists/clock.mp3");
    clock.loop = true;
    clock.volume = this.settings.masterVolume / 100 * this.settings.musicVolume / 100;
    this.questionTimerAudio = clock;
    void clock.play().catch(() => {
      if (this.questionTimerAudio !== clock || !this.questionTimerSoundActive) return;
      this.questionTimerAudio = null;
      this.startNativeQuestionTimerTicks();
    });
  }

  private stopQuestionTimerSound(resumeMusic = true): void {
    this.questionTimerSoundActive = false;
    if (this.questionTimerTickTimer) clearInterval(this.questionTimerTickTimer);
    this.questionTimerTickTimer = null;
    this.questionTimerAudio?.pause();
    if (this.questionTimerAudio) this.questionTimerAudio.currentTime = 0;
    this.questionTimerAudio = null;
    if (resumeMusic) this.startMusic();
  }

  private pauseQuestionTimerSound(): void {
    this.questionTimerAudio?.pause();
    if (this.questionTimerTickTimer) clearInterval(this.questionTimerTickTimer);
    this.questionTimerTickTimer = null;
  }

  private resumeQuestionTimerSound(): void {
    if (!this.questionTimerSoundActive) return;
    if (this.questionTimerAudio) {
      void this.questionTimerAudio.play().catch(() => {
        this.questionTimerAudio = null;
        this.startNativeQuestionTimerTicks();
      });
    } else this.startNativeQuestionTimerTicks();
  }

  private startNativeQuestionTimerTicks(): void {
    if (this.questionTimerTickTimer) return;
    this.playNativeQuestionTimerTick();
    this.questionTimerTickTimer = setInterval(() => this.playNativeQuestionTimerTick(), 1000);
  }

  private playNativeQuestionTimerTick(): void {
    const volume = 0.18 * this.settings.masterVolume / 100 * this.settings.musicVolume / 100;
    if (volume <= 0) return;
    void invoke("play_tone", {
      frequency: 1100,
      duration: 0.08,
      waveform: "square",
      volume,
    }).catch(() => undefined);
  }
  private playBeatStep(): void {
    if (this.settings.masterVolume === 0 || this.settings.musicVolume === 0) return;
    const chords = [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
    ];
    const bass = [130.81, 110.0, 87.31, 98.0];
    const melody: Array<number | null> = [
      329.63, null, 392.0, null, 440.0, 392.0, 329.63, null,
      329.63, null, 293.66, null, 329.63, 392.0, 329.63, null,
      261.63, null, 329.63, null, 349.23, 329.63, 261.63, null,
      293.66, null, 329.63, null, 392.0, 329.63, 293.66, null,
    ];
    const chordIndex = Math.floor(this.beatStep / 8);
    const chord = chords[chordIndex] ?? chords[0];
    const arpNote = chord[this.beatStep % chord.length];
    if (arpNote) this.playTone(arpNote, 0.25, "sine", 0.035);
    const leadNote = melody[this.beatStep];
    if (leadNote) this.playTone(leadNote, 0.34, "triangle", 0.065);
    if (this.beatStep % 4 === 0) this.playTone(bass[chordIndex] ?? bass[0], 0.72, "triangle", 0.07);
    if (this.beatStep % 8 === 0) this.playTone(72, 0.14, "sine", 0.075);
    if (this.beatStep % 2 === 1) this.playTone(1250, 0.018, "square", 0.006);
    this.beatStep = (this.beatStep + 1) % melody.length;
  }
  private playTone(frequency: number, duration: number, type: OscillatorType, volume: number): void {
    void invoke("play_tone", {
      frequency,
      duration,
      waveform: type,
      volume: volume * this.settings.masterVolume / 100 * this.settings.musicVolume / 100,
    }).catch(() => undefined);
  }

  private async loadAudioDevices(): Promise<void> {
    try {
      const devices = await invoke<NativeAudioDevices>("list_audio_devices");
      this.inputDevices = devices.inputs;
      this.outputDevices = devices.outputs;
      this.outputSelectionSupported = true;
      const inputExists = this.settings.inputDeviceId === "default" || devices.inputs.some((device) => device.deviceId === this.settings.inputDeviceId);
      const outputExists = this.settings.outputDeviceId === "default" || devices.outputs.some((device) => device.deviceId === this.settings.outputDeviceId);
      if (!inputExists) this.settings = { ...this.settings, inputDeviceId: "default" };
      if (!outputExists) {
        this.settings = { ...this.settings, outputDeviceId: "default" };
        await invoke("set_output_device", { deviceId: "default" });
      }
      if (!inputExists || !outputExists) this.saveSettings();
      this.deviceFeedback = "";
    } catch {
      this.deviceFeedback = this.t("noDevices");
    }
  }

  private async startMicrophoneTest(): Promise<void> {
    await this.startMicrophoneCapture("test");
  }

  private async startRoomMicrophoneMonitoring(): Promise<void> {
    if (!this.canUseRoomCommunication) {
      this.stopMicrophoneTest();
      return;
    }
    if (this.settings.pushToTalk && !this.isPushToTalkPressed) {
      this.stopMicrophoneTest();
      return;
    }
    await this.startMicrophoneCapture("room");
  }

  private async startMicrophoneCapture(mode: Exclude<MicrophoneCaptureMode, "off">): Promise<void> {
    try {
      if (this.micLevelTimer) clearInterval(this.micLevelTimer);
      this.micLevelTimer = null;
      await invoke("stop_microphone_test");
      await invoke("start_microphone_test", { deviceId: this.settings.inputDeviceId });
      if (mode === "room" && this.settings.pushToTalk && !this.isPushToTalkPressed) {
        await invoke("stop_microphone_test");
        this.microphoneCaptureMode = "off";
        this.microphoneLevel = 0;
        return;
      }
      this.microphoneCaptureMode = mode;
      this.isTestingMicrophone = mode === "test";
      this.deviceFeedback = "";
      this.micLevelTimer = setInterval(() => {
        void invoke<number>("microphone_level").then((level) => {
          if (this.microphoneCaptureMode !== mode) return;
          if (mode === "room" && this.settings.pushToTalk && !this.isPushToTalkPressed) {
            this.updateMicrophoneLevel(0);
            return;
          }
          this.updateMicrophoneLevel(level);
        }).catch(() => undefined);
      }, 80);
    } catch {
      this.microphoneCaptureMode = "off";
      this.isTestingMicrophone = false;
      this.microphoneLevel = 0;
      this.deviceFeedback = this.t("noDevices");
    }
  }

  private stopMicrophoneTest(): void {
    if (this.micLevelTimer) clearInterval(this.micLevelTimer);
    this.micLevelTimer = null;
    void invoke("stop_microphone_test").catch(() => undefined);
    this.microphoneCaptureMode = "off";
    this.isTestingMicrophone = false;
    this.microphoneLevel = 0;
  }

  private updateMicrophoneLevel(rawLevel: number): void {
    const adjustedLevel = rawLevel * this.settings.microphoneSensitivity / 100;
    const target = adjustedLevel < 3 ? 0 : Math.max(0, Math.min(100, adjustedLevel));
    const response = target > this.microphoneLevel ? .68 : .18;
    const smoothed = this.microphoneLevel + (target - this.microphoneLevel) * response;
    this.microphoneLevel = smoothed < 1 ? 0 : Math.round(smoothed);
  }

}
