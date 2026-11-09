/** Tiny WebAudio cues + haptics. No assets, no dependencies. */

type Cue = "roll" | "keep" | "bank" | "farkle" | "win";

let ctx: AudioContext | null = null;
let muted = false;
let hapticsOn = true;

export function setMuted(value: boolean): void {
  muted = value;
}

export function setHapticsEnabled(value: boolean): void {
  hapticsOn = value;
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(frequency: number, duration: number, type: OscillatorType, gain: number, delay = 0): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const start = ac.currentTime + delay;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playCue(cue: Cue): void {
  if (muted) return;
  switch (cue) {
    case "roll":
      tone(180, 0.09, "triangle", 0.05);
      tone(240, 0.07, "triangle", 0.03, 0.04);
      break;
    case "keep":
      tone(520, 0.07, "sine", 0.05);
      break;
    case "bank":
      tone(392, 0.09, "sine", 0.06);
      tone(587, 0.14, "sine", 0.05, 0.07);
      break;
    case "farkle":
      tone(160, 0.22, "sawtooth", 0.035);
      tone(110, 0.3, "sine", 0.04, 0.06);
      break;
    case "win":
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, "sine", 0.05, i * 0.1));
      break;
  }
}

export function haptic(pattern: number | number[] = 12): void {
  if (!hapticsOn) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
