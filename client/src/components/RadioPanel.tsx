import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { RADIO_CHANNEL_COUNT } from '@shared/types';
import { vibrate } from '../lib/geo';
import {
  playSquelchEnd,
  playSquelchStart,
  startStaticBed,
  unlockRadioAudio,
  type StaticBedHandle,
} from '../lib/radioAudio';

interface RadioPanelProps {
  channel: number;
  canTransmit: boolean;
  isHunter: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  staticEnabled: boolean;
  incomingActive: boolean;
  incomingCount: number;
  onChangeChannel: (ch: number) => void;
  onToggleMicMute: () => void;
  onToggleSpeakerMute: () => void;
  onToggleStatic: () => void;
  onTxStart: () => void;
  onTxEnd: () => void;
  onTransmitClip: (audio: ArrayBuffer, mimeType: string, durationMs: number) => Promise<void>;
}

const AUDIO_CODEC_PREFERENCE = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

const MAX_TX_MS = 15_000;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of AUDIO_CODEC_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function RadioPanel({
  channel,
  canTransmit,
  isHunter,
  micMuted,
  speakerMuted,
  staticEnabled,
  incomingActive,
  incomingCount,
  onChangeChannel,
  onToggleMicMute,
  onToggleSpeakerMute,
  onToggleStatic,
  onTxStart,
  onTxEnd,
  onTransmitClip,
}: RadioPanelProps) {
  const [transmitting, setTransmitting] = useState(false);
  const [txElapsedMs, setTxElapsedMs] = useState(0);
  const [radioError, setRadioError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const txStartAtRef = useRef<number>(0);
  const staticBedRef = useRef<StaticBedHandle | null>(null);
  const isHoldingRef = useRef(false);

  const cleanupHardware = useCallback(() => {
    staticBedRef.current?.stop();
    staticBedRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupHardware();
    };
  }, [cleanupHardware]);

  const stopTransmit = useCallback(() => {
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;
    onTxEnd();

    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.stop();
      } catch {
        cleanupHardware();
        setTransmitting(false);
      }
    } else {
      cleanupHardware();
      setTransmitting(false);
    }
  }, [cleanupHardware, onTxEnd]);

  // Timer while holding PTT (auto-stops at 15s)
  useEffect(() => {
    if (!transmitting) {
      setTxElapsedMs(0);
      return;
    }
    const id = window.setInterval(() => {
      const ms = Date.now() - txStartAtRef.current;
      setTxElapsedMs(ms);
      if (ms >= MAX_TX_MS) {
        stopTransmit();
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [transmitting, stopTransmit]);

  const startTransmit = async () => {
    if (!canTransmit || micMuted || isHoldingRef.current) return;
    unlockRadioAudio();
    setRadioError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRadioError('Microphone unavailable. Open this app over HTTPS.');
      return;
    }

    isHoldingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // User released button before mic opened
      if (!isHoldingRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const options: MediaRecorderOptions = { audioBitsPerSecond: 24_000 };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const duration = Math.max(200, Date.now() - txStartAtRef.current);
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        chunksRef.current = [];
        cleanupHardware();
        setTransmitting(false);

        if (staticEnabled && !speakerMuted) {
          playSquelchEnd();
        }
        vibrate(25);

        if (blob.size > 200 && duration >= 250) {
          void blob.arrayBuffer().then((buf) => onTransmitClip(buf, finalMime, duration));
        }
      };

      recorderRef.current = recorder;
      txStartAtRef.current = Date.now();
      recorder.start(250);
      setTransmitting(true);
      onTxStart();
      vibrate(35);

      if (staticEnabled && !speakerMuted) {
        playSquelchStart();
        staticBedRef.current = startStaticBed(0.022);
      }
    } catch (err) {
      isHoldingRef.current = false;
      cleanupHardware();
      setTransmitting(false);
      const msg = err instanceof Error ? err.message : 'Microphone permission denied.';
      setRadioError(`Mic blocked: ${msg}`);
    }
  };

  const handleStepChannel = (delta: number) => {
    unlockRadioAudio();
    const next = ((channel - 1 + delta + RADIO_CHANNEL_COUNT) % RADIO_CHANNEL_COUNT) + 1;
    onChangeChannel(next);
    if (staticEnabled && !speakerMuted) {
      playSquelchStart();
    }
  };

  const handlePickChannel = (ch: number) => {
    if (ch === channel) return;
    unlockRadioAudio();
    onChangeChannel(ch);
    if (staticEnabled && !speakerMuted) {
      playSquelchStart();
    }
  };

  const chLabel = `CH ${String(channel).padStart(2, '0')}`;

  return (
    <div className="space-y-3">
      {/* Walkie-Talkie LCD Display */}
      <div className="rounded-3xl border border-borderSubtle bg-gradient-to-b from-surfaceElevated to-surface p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio
              className={`h-4 w-4 ${
                transmitting
                  ? 'text-red-400 animate-pulse'
                  : incomingActive
                    ? 'text-emerald-400 animate-pulse'
                    : 'text-slate-400'
              }`}
            />
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
              Tactical Radio
            </span>
          </div>
          <span className="rounded-md border border-borderSubtle bg-obsidian px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400">
            {isHunter ? 'SPY SCAN READY' : 'STEALTH CHANNELS'}
          </span>
        </div>

        {/* Big Frequency / Channel Readout */}
        <div className="mt-3 flex items-center justify-between rounded-2xl border border-emerald-500/25 bg-[#050a08] px-3 py-4">
          <button
            type="button"
            disabled={transmitting}
            onClick={() => handleStepChannel(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-borderSubtle bg-surface text-slate-200 active:scale-95 disabled:opacity-40"
            aria-label="Previous channel"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="text-center">
            <p className="font-mono text-4xl font-black tracking-widest text-emerald-400">
              {chLabel}
            </p>
            <p className="mt-1 font-mono text-[11px] font-bold uppercase tracking-wider">
              {transmitting ? (
                <span className="text-red-400">
                  ● TX LIVE {(txElapsedMs / 1000).toFixed(1)}s / 15s
                </span>
              ) : incomingActive ? (
                <span className="text-amber-300 animate-pulse">◉ RECEIVING SIGNAL...</span>
              ) : speakerMuted ? (
                <span className="text-slate-500">SPEAKER MUTED</span>
              ) : (
                <span className="text-emerald-500/75">
                  LISTENING · {incomingCount} RX
                </span>
              )}
            </p>
          </div>

          <button
            type="button"
            disabled={transmitting}
            onClick={() => handleStepChannel(1)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-borderSubtle bg-surface text-slate-200 active:scale-95 disabled:opacity-40"
            aria-label="Next channel"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Mute & Static Quick Controls */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onToggleMicMute}
            className={`flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] font-bold transition active:scale-95 ${
              micMuted
                ? 'border-red-500/50 bg-red-500/15 text-red-300'
                : 'border-borderSubtle bg-obsidian text-slate-200'
            }`}
          >
            {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-emerald-400" />}
            {micMuted ? 'Mic Muted' : 'Mic Live'}
          </button>

          <button
            type="button"
            onClick={onToggleSpeakerMute}
            className={`flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] font-bold transition active:scale-95 ${
              speakerMuted
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                : 'border-borderSubtle bg-obsidian text-slate-200'
            }`}
          >
            {speakerMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4 text-emerald-400" />
            )}
            {speakerMuted ? 'Audio Off' : 'Audio On'}
          </button>

          <button
            type="button"
            onClick={onToggleStatic}
            className={`flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] font-bold transition active:scale-95 ${
              staticEnabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-borderSubtle bg-obsidian text-slate-400'
            }`}
          >
            <Waves className="h-4 w-4" />
            {staticEnabled ? 'Static ON' : 'Static OFF'}
          </button>
        </div>
      </div>

      {/* Big Push-To-Talk Button */}
      <div className="rounded-3xl border border-borderSubtle bg-surface p-4 text-center">
        {radioError && (
          <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
            {radioError}
          </div>
        )}

        <button
          type="button"
          disabled={!canTransmit || micMuted}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            void startTransmit();
          }}
          onPointerUp={stopTransmit}
          onPointerCancel={stopTransmit}
          onContextMenu={(e) => e.preventDefault()}
          className={`mx-auto flex h-28 w-28 select-none touch-none flex-col items-center justify-center rounded-full border-4 font-black uppercase tracking-wider transition ${
            transmitting
              ? 'scale-95 border-red-300 bg-red-600 text-white shadow-[0_0_32px_rgba(239,68,68,0.65)]'
              : !canTransmit || micMuted
                ? 'border-slate-700 bg-slate-800/80 text-slate-500'
                : 'border-emerald-400/70 bg-emerald-500 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.35)] active:scale-95'
          }`}
        >
          {micMuted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          <span className="mt-1 text-xs">
            {transmitting ? 'TALKING' : micMuted ? 'MUTED' : !canTransmit ? 'LISTEN' : 'HOLD PTT'}
          </span>
        </button>

        <p className="mt-3 text-[11px] text-slate-400">
          {!canTransmit
            ? 'Eliminated players can listen on any channel but cannot transmit.'
            : micMuted
              ? 'Unmute your mic above to transmit on this channel.'
              : `Hold to talk on ${chLabel}. Anyone tuned to ${chLabel} hears you — hunters can scan channels to spy!`}
        </p>
      </div>

      {/* 20-Channel Quick Switcher Grid */}
      <div className="rounded-3xl border border-borderSubtle bg-surface p-3.5">
        <div className="mb-2.5 flex items-center justify-between px-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            20 Radio Channels
          </h4>
          <span className="text-[10px] font-semibold text-slate-500">
            Channel choice is hidden from others
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: RADIO_CHANNEL_COUNT }, (_, idx) => {
            const ch = idx + 1;
            const active = ch === channel;
            return (
              <button
                key={ch}
                type="button"
                disabled={transmitting}
                onClick={() => handlePickChannel(ch)}
                className={`rounded-xl py-2.5 font-mono text-xs font-black transition active:scale-95 ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'border border-borderSubtle bg-obsidian text-slate-300 hover:border-slate-500'
                }`}
              >
                {String(ch).padStart(2, '0')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
