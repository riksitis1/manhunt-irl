import { vibrate } from './geo';

export type AlertTone = 'reveal' | 'urgent' | 'phase' | 'radar' | 'elimination';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new Ctor();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  getAudioContext();
}

export function playAlertChime(tone: AlertTone): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    const playNote = (freq: number, startOffset: number, dur: number, type: OscillatorType, vol = 0.08) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(vol, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.01);
    };

    if (tone === 'reveal') {
      playNote(587.33, 0, 0.14, 'sine', 0.1);
      playNote(880, 0.14, 0.22, 'sine', 0.1);
    } else if (tone === 'urgent') {
      playNote(920, 0, 0.12, 'triangle', 0.11);
      playNote(920, 0.16, 0.12, 'triangle', 0.11);
      playNote(1180, 0.32, 0.2, 'triangle', 0.11);
    } else if (tone === 'phase') {
      playNote(440, 0, 0.12, 'sine', 0.09);
      playNote(659.25, 0.12, 0.12, 'sine', 0.09);
      playNote(880, 0.24, 0.26, 'sine', 0.1);
    } else if (tone === 'radar') {
      playNote(523.25, 0, 0.1, 'sine', 0.08);
      playNote(783.99, 0.1, 0.16, 'sine', 0.08);
    } else if (tone === 'elimination') {
      playNote(392, 0, 0.16, 'sawtooth', 0.06);
      playNote(261.63, 0.16, 0.28, 'sawtooth', 0.06);
    }
  } catch {
    // Ignore Web Audio edge errors
  }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  unlockAudio();
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function triggerSystemAlert(params: {
  title: string;
  body: string;
  tone: AlertTone;
  vibratePattern?: number[];
  tag?: string;
}): void {
  playAlertChime(params.tone);
  if (params.vibratePattern) {
    vibrate(params.vibratePattern);
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(params.title, {
        body: params.body,
        tag: params.tag,
        silent: false,
      });
    } catch {
      // Some Android browsers block direct `new Notification` without a service worker; audio + vibrate + toast still fire cleanly
    }
  }
}
