let radioCtx: AudioContext | null = null;
let noiseBufferCache: AudioBuffer | null = null;

function getRadioAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!radioCtx) {
      radioCtx = new Ctor();
    }
    if (radioCtx.state === 'suspended') {
      void radioCtx.resume().catch(() => {});
    }
    return radioCtx;
  } catch {
    return null;
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCache.sampleRate === ctx.sampleRate) {
    return noiseBufferCache;
  }
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBufferCache = buffer;
  return buffer;
}

export function unlockRadioAudio(): void {
  getRadioAudioContext();
}

export function playSquelchStart(): void {
  const ctx = getRadioAudioContext();
  if (!ctx || ctx.state === 'suspended') return;
  const now = ctx.currentTime;

  try {
    // Filtered static burst ("KSSHH")
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1450, now);
    filter.Q.setValueAtTime(1.2, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.09);

    // Tactile radio key-up pip
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1080, now + 0.02);
    oscGain.gain.setValueAtTime(0.06, now + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now + 0.02);
    osc.stop(now + 0.065);
  } catch {
    // Ignore audio errors
  }
}

export function playSquelchEnd(): void {
  const ctx = getRadioAudioContext();
  if (!ctx || ctx.state === 'suspended') return;
  const now = ctx.currentTime;

  try {
    // Classic 2-tone walkie-talkie Roger beep
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, now);
    osc.frequency.setValueAtTime(980, now + 0.05);
    oscGain.gain.setValueAtTime(0.065, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.115);

    // Static tail ("KSHH")
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1700, now + 0.06);
    filter.Q.setValueAtTime(1.1, now + 0.06);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now + 0.06);
    nGain.gain.linearRampToValueAtTime(0.095, now + 0.08);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now + 0.06);
    noise.stop(now + 0.19);
  } catch {
    // Ignore
  }
}

export interface StaticBedHandle {
  stop: () => void;
}

/**
 * Plays a gentle walkie-talkie static hiss bed while transmitting or receiving.
 */
export function startStaticBed(volume = 0.028): StaticBedHandle | null {
  const ctx = getRadioAudioContext();
  if (!ctx || ctx.state === 'suspended') return null;

  try {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1500, ctx.currentTime);
    filter.Q.setValueAtTime(0.9, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();

    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          noise.stop();
          noise.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // Ignore
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Decodes and plays an incoming radio voice clip with walkie-talkie bandpass DSP + static overlay.
 */
export async function playIncomingRadioClip(
  audioBytes: ArrayBuffer | Uint8Array,
  mimeType: string,
  withStatic: boolean
): Promise<void> {
  const uint8 = audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
  const copyBuffer = new ArrayBuffer(uint8.byteLength);
  new Uint8Array(copyBuffer).set(uint8);

  if (withStatic) {
    playSquelchStart();
  }

  const ctx = getRadioAudioContext();
  if (ctx && ctx.state === 'running') {
    try {
      const decoded = await ctx.decodeAudioData(copyBuffer.slice(0));
      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = decoded;

        // Walkie-talkie vocal bandpass (340Hz - 2900Hz) + compressor for outdoor clarity
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 340;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2900;

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24;
        comp.ratio.value = 6;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.25;

        source.connect(hp);
        hp.connect(lp);
        lp.connect(comp);
        comp.connect(outGain);
        outGain.connect(ctx.destination);

        const staticBed = withStatic ? startStaticBed(0.03) : null;

        source.onended = () => {
          staticBed?.stop();
          if (withStatic) playSquelchEnd();
          resolve();
        };

        source.start();
      });
      return;
    } catch {
      // Fallback to native HTMLAudioElement below if Web Audio couldn't decode codec
    }
  }

  // Fallback playback
  await new Promise<void>((resolve) => {
    const blob = new Blob([copyBuffer], { type: mimeType || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const staticBed = withStatic ? startStaticBed(0.025) : null;

    const finish = () => {
      staticBed?.stop();
      URL.revokeObjectURL(url);
      if (withStatic) playSquelchEnd();
      resolve();
    };

    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(finish);
  });
}
