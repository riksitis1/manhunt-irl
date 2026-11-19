import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, Send, ShieldAlert, Square, X } from 'lucide-react';
import { formatBytes, formatCountdown, vibrate } from '../lib/geo';

interface LiveVideoRecorderProps {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  pingRound: number;
  challengeCode: string;
  deadlineAt: number;
  maxDurationSec: number;
  clockOffsetMs: number;
  onSuccess: () => void;
  onClose: () => void;
}

const CODEC_PREFERENCE = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of CODEC_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function LiveVideoRecorder({
  roomCode,
  playerId,
  sessionToken,
  pingRound,
  challengeCode,
  deadlineAt,
  maxDurationSec,
  clockOffsetMs,
  onSuccess,
  onClose,
}: LiveVideoRecorderProps) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);

  const [cameraState, setCameraState] = useState<'INIT' | 'READY' | 'RECORDING' | 'REVIEW' | 'UPLOADING' | 'ERROR'>('INIT');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [deadlineLeftMs, setDeadlineLeftMs] = useState(() =>
    Math.max(0, deadlineAt - (Date.now() + clockOffsetMs))
  );

  const stopCameraTracks = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCameraTracks();
    setCameraState('INIT');
    setErrorMsg(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('ERROR');
      setErrorMsg('Live camera API unavailable. Open this site over HTTPS on a mobile browser.');
      return;
    }

    // Sharp low-res constraints: 640x360 @ 24fps keeps clips ~0.8-1MB while staying crisp
    const videoConstraints: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' },
      width: { ideal: 640, max: 854 },
      height: { ideal: 360, max: 480 },
      frameRate: { ideal: 24, max: 24 },
    };

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: true,
        });
      } catch {
        // Fallback to video-only if microphone permission is denied
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      }

      streamRef.current = stream;
      setCameraState('READY');
    } catch (err) {
      setCameraState('ERROR');
      const msg = err instanceof Error ? err.message : 'Camera permission denied.';
      setErrorMsg(`Cannot access live rear camera: ${msg}`);
    }
  }, [stopCameraTracks]);

  // Attach live MediaStream to preview video when READY/RECORDING
  useEffect(() => {
    if ((cameraState === 'READY' || cameraState === 'RECORDING') && previewVideoRef.current && streamRef.current) {
      previewVideoRef.current.srcObject = streamRef.current;
      void previewVideoRef.current.play().catch(() => {});
    }
  }, [cameraState]);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCameraTracks();
    };
  }, [startCamera, stopCameraTracks]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  // Deadline countdown ticker (1s)
  useEffect(() => {
    const id = window.setInterval(() => {
      setDeadlineLeftMs(Math.max(0, deadlineAt - (Date.now() + clockOffsetMs)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadlineAt, clockOffsetMs]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  // Recording progress ticker (250ms only while recording)
  useEffect(() => {
    if (cameraState !== 'RECORDING') return;
    const maxMs = maxDurationSec * 1000;
    const id = window.setInterval(() => {
      const ms = Date.now() - recordStartRef.current;
      setElapsedMs(ms);
      if (ms >= maxMs) {
        stopRecording();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [cameraState, maxDurationSec, stopRecording]);

  const handleStartRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickSupportedMimeType();
    chunksRef.current = [];

    try {
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: 650_000,
        audioBitsPerSecond: 64_000,
      };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const duration = Math.max(500, Date.now() - recordStartRef.current);
        const finalMime = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        chunksRef.current = [];

        // Immediately release camera hardware to save battery during review/upload
        if (streamRef.current) {
          for (const t of streamRef.current.getTracks()) t.stop();
          streamRef.current = null;
        }

        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        const nextUrl = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedUrl(nextUrl);
        setRecordedDurationMs(duration);
        setCameraState('REVIEW');
        vibrate(50);
      };

      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setElapsedMs(0);
      recorder.start(500);
      setCameraState('RECORDING');
      vibrate(30);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start live video recorder.');
      setCameraState('ERROR');
    }
  };

  const handleRetake = () => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    setRecordedBlob(null);
    setElapsedMs(0);
    void startCamera();
  };

  const handleUpload = async () => {
    if (!recordedBlob) return;
    if (recordedDurationMs < 1800) {
      setErrorMsg('Clip too short — record at least 2 seconds of your 360° surroundings.');
      return;
    }

    setCameraState('UPLOADING');
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/video`, {
        method: 'POST',
        headers: {
          'Content-Type': recordedBlob.type || 'video/webm',
          'x-player-id': playerId,
          'x-session-token': sessionToken,
          'x-ping-round': String(pingRound),
          'x-challenge-code': challengeCode,
          'x-duration-ms': String(recordedDurationMs),
        },
        body: recordedBlob,
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setCameraState('REVIEW');
        setErrorMsg(data?.error ?? `Upload failed (HTTP ${res.status}). Tap Send to retry.`);
        return;
      }

      vibrate([40, 40, 80]);
      onSuccess();
    } catch {
      setCameraState('REVIEW');
      setErrorMsg('Network error uploading video. Tap Send to retry.');
    }
  };

  const progressPct = Math.min(100, (elapsedMs / (maxDurationSec * 1000)) * 100);

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-obsidian">
      {/* Top HUD */}
      <div className="flex items-center justify-between gap-2 border-b border-borderSubtle bg-surface px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-wider text-white">
              Live 360° Ping #{pingRound}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Live camera only · No gallery uploads · 360p sharp
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-right">
            <p className="text-[9px] font-bold uppercase text-red-300">Deadline</p>
            <p className="font-mono text-sm font-black text-red-400">
              {formatCountdown(deadlineLeftMs)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraTracks();
              onClose();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-borderSubtle bg-surfaceElevated text-slate-300"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Live viewfinder or review playback */}
      <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
        {(cameraState === 'READY' || cameraState === 'RECORDING') && (
          <>
            <video
              ref={previewVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {/* Anti-cheat live code overlay */}
            <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-white/20 bg-black/70 px-3 py-1.5 backdrop-blur">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Live Verification Code
              </p>
              <p className="font-mono text-lg font-black tracking-widest text-white">
                {challengeCode}
              </p>
            </div>

            {cameraState === 'RECORDING' && (
              <div className="pointer-events-none absolute right-3 top-3 rounded-xl bg-red-600/90 px-3 py-1.5 font-mono text-sm font-black text-white shadow-lg">
                REC {(elapsedMs / 1000).toFixed(1)}s / {maxDurationSec}s
              </div>
            )}

            <div className="pointer-events-none absolute bottom-4 left-4 right-4 text-center">
              <span className="inline-block rounded-full bg-black/70 px-3.5 py-1 text-xs font-semibold text-slate-100 backdrop-blur">
                {cameraState === 'RECORDING'
                  ? 'Spin 360° slowly to show your surroundings'
                  : `Hold phone up & tap Record (max ${maxDurationSec}s)`}
              </span>
            </div>
          </>
        )}

        {(cameraState === 'REVIEW' || cameraState === 'UPLOADING') && recordedUrl && (
          <div className="relative flex h-full w-full flex-col items-center justify-center bg-black">
            <video
              src={recordedUrl}
              controls
              playsInline
              className="max-h-full w-full object-contain"
            />
            {recordedBlob && (
              <div className="absolute left-3 top-3 rounded-lg bg-black/75 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                Ready · {(recordedDurationMs / 1000).toFixed(1)}s · {formatBytes(recordedBlob.size)}
              </div>
            )}
          </div>
        )}

        {cameraState === 'INIT' && (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <Camera className="h-10 w-10 animate-pulse text-amber-400" />
            <p className="text-sm font-semibold">Starting rear camera...</p>
          </div>
        )}

        {cameraState === 'ERROR' && (
          <div className="mx-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-center">
            <ShieldAlert className="mx-auto h-9 w-9 text-red-400" />
            <p className="mt-2 text-sm font-bold text-white">Camera Unavailable</p>
            <p className="mt-1 text-xs text-red-200">{errorMsg}</p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Camera
            </button>
          </div>
        )}
      </div>

      {/* Recording progress strip */}
      {cameraState === 'RECORDING' && (
        <div className="h-1.5 w-full bg-surfaceElevated">
          <div
            className="h-full bg-red-500 transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Error banner */}
      {errorMsg && cameraState !== 'ERROR' && (
        <div className="bg-red-500/15 px-4 py-2 text-center text-xs font-semibold text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Bottom shutter / send bar */}
      <div className="safe-bottom border-t border-borderSubtle bg-surface px-4 py-4">
        {cameraState === 'READY' && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleStartRecording}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 shadow-[0_0_24px_rgba(239,68,68,0.55)] active:scale-95"
              aria-label="Start recording 360 video"
            >
              <span className="h-6 w-6 rounded-full bg-white" />
            </button>
          </div>
        )}

        {cameraState === 'RECORDING' && (
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              disabled={elapsedMs < 2000}
              onClick={stopRecording}
              className={`flex h-16 w-16 items-center justify-center rounded-full border-4 border-white transition active:scale-95 ${
                elapsedMs < 2000 ? 'bg-slate-700 opacity-60' : 'bg-red-600'
              }`}
              aria-label="Stop recording"
            >
              <Square className="h-6 w-6 fill-white text-white" />
            </button>
          </div>
        )}

        {(cameraState === 'REVIEW' || cameraState === 'UPLOADING') && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={cameraState === 'UPLOADING'}
              onClick={handleRetake}
              className="flex items-center justify-center gap-2 rounded-2xl border border-borderSubtle bg-surfaceElevated py-3.5 text-sm font-bold text-slate-200 active:scale-98 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Retake
            </button>
            <button
              type="button"
              disabled={cameraState === 'UPLOADING'}
              onClick={() => void handleUpload()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-black text-slate-950 active:scale-98 disabled:opacity-60"
            >
              {cameraState === 'UPLOADING' ? (
                <>
                  <CheckCircle2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send 360° Ping
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
