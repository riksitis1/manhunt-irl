export type GameMode = 'VIDEO' | 'GPS';

export type GamePhase = 'LOBBY' | 'WHEEL' | 'HEADSTART' | 'ACTIVE' | 'ENDED';

export type PlayerRole = 'UNASSIGNED' | 'HUNTER' | 'RUNNER';

export type PlayerStatus = 'ALIVE' | 'ELIMINATED';

export type EliminationReason =
  | 'CAUGHT'
  | 'OUT_OF_BOUNDS'
  | 'MISSED_VIDEO_PING'
  | 'FORFEIT';

export interface LatLng {
  lat: number;
  lng: number;
}

export type Boundary =
  | { type: 'NONE' }
  | { type: 'CIRCLE'; center: LatLng; radiusMeters: number }
  | { type: 'POLYGON'; points: LatLng[] };

export interface RoomSettings {
  mode: GameMode;
  maxPlayers: number;
  hunterCount: number;
  headstartSec: number;
  pingIntervalSec: number;
  videoDeadlineSec: number;
  videoMaxDurationSec: number;
  keepVideos: boolean;
  boundaryGraceSec: number;
  hunterRadarToken: boolean;
  boundary: Boundary;
}

export interface HunterRadarSpot {
  hunterId: string;
  hunterName: string;
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: number;
}

export interface SecretRadarTokenState {
  available: boolean;
  usedAt?: number;
  revealedHunters?: HunterRadarSpot[];
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface PendingPingInfo {
  round: number;
  deadlineAt: number;
  challengeCode?: string;
}

export interface PendingTagClaim {
  byHunterId: string;
  byHunterName: string;
  expiresAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  gpsReady: boolean;
  role: PlayerRole;
  status: PlayerStatus;
  eliminatedAt?: number;
  eliminationReason?: EliminationReason;
  outOfBoundsSince?: number;
  hunterLocation?: GeoPoint;
  pendingPing?: PendingPingInfo;
  pingSubmittedRound?: number;
  pendingTagClaim?: PendingTagClaim;
}

export interface WheelCandidate {
  id: string;
  name: string;
}

export interface WheelSpinState {
  spinIndex: number;
  totalSpins: number;
  candidates: WheelCandidate[];
  winnerId: string;
  winnerIndex: number;
  winnerName: string;
  startedAt: number;
  durationMs: number;
  extraRotations: number;
  selectedHunters: WheelCandidate[];
}

export interface VideoPingItem {
  id: string;
  round: number;
  playerId: string;
  playerName: string;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
  url: string;
  challengeCode: string;
}

export interface GpsPingItem {
  id: string;
  round: number;
  playerId: string;
  playerName: string;
  lat: number;
  lng: number;
  accuracy: number;
  createdAt: number;
  isFallbackLastKnown?: boolean;
}

export interface MatchEvent {
  id: string;
  timestamp: number;
  type: 'ELIMINATION' | 'PING_ROUND' | 'VIDEO_SENT' | 'GPS_SENT' | 'PHASE' | 'SYSTEM';
  message: string;
}

export interface RoomSnapshot {
  code: string;
  serverNow: number;
  phase: GamePhase;
  settings: RoomSettings;
  players: PublicPlayer[];
  meId: string;
  wheel: WheelSpinState | null;
  headstartEndsAt: number | null;
  gameStartedAt: number | null;
  gameEndedAt: number | null;
  winnerSide: 'HUNTERS' | 'RUNNERS' | null;
  pingRound: number;
  nextPingAt: number | null;
  videoPings: VideoPingItem[];
  gpsPings: GpsPingItem[];
  events: MatchEvent[];
  /** Private: viewer's current walkie-talkie channel (1..20). Never shown to other players. */
  myRadioChannel: number;
  /** Private: only populated for the single runner randomly granted the 1-time Hunter Radar Token. */
  myRadarToken?: SecretRadarTokenState;
}

export const RADIO_CHANNEL_COUNT = 20;

export interface RadioIncomingPayload {
  id: string;
  channel: number;
  mimeType: string;
  durationMs: number;
  sentAt: number;
  audio: ArrayBuffer | Uint8Array;
}

export interface RadioActivityPayload {
  channel: number;
  active: boolean;
}

export interface JoinSuccessPayload {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface SocketAck<T = undefined> {
  ok: boolean;
  error?: string;
  errorCode?: 'SESSION_EXPIRED' | 'NETWORK_TIMEOUT' | 'BAD_REQUEST';
  data?: T;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mode: 'VIDEO',
  maxPlayers: 8,
  hunterCount: 2,
  headstartSec: 60,
  pingIntervalSec: 300,
  videoDeadlineSec: 120,
  videoMaxDurationSec: 10,
  keepVideos: true,
  boundaryGraceSec: 10,
  hunterRadarToken: false,
  boundary: { type: 'NONE' },
};
