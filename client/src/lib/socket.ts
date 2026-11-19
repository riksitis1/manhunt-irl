import { io, type Socket } from 'socket.io-client';
import type { SocketAck } from '@shared/types';

export interface StoredSession {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  name: string;
  savedAt: number;
}

const SESSION_KEY = 'manhunt_irl_session_v1';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
  }
  return socketInstance;
}

export function emitAck<TPayload, TResult = undefined>(
  event: string,
  payload: TPayload
): Promise<SocketAck<TResult>> {
  const socket = getSocket();
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          ok: false,
          error: 'Connection timed out. Check signal and try again.',
          errorCode: 'NETWORK_TIMEOUT',
        });
      }
    }, 10_000);

    socket.emit(event, payload, (res: SocketAck<TResult>) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(res ?? { ok: false, error: 'Invalid server response.' });
      }
    });
  });
}

export function saveSession(session: Omit<StoredSession, 'savedAt'>): void {
  try {
    const data: StoredSession = { ...session, savedAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.roomCode || !parsed.playerId || !parsed.sessionToken) return null;
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore
  }
}
