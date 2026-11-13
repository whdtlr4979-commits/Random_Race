// 효과음은 파일 없이 WebAudio로 합성한다.
let ctx = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }
export function setMuted(v) { muted = v; }
export function isMuted() { return muted; }

function tone(freq, dur, { type = 'square', gain = 0.12, when = 0, slide = 0 } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.3, when = 0, freq = 1200 } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  beep: () => tone(660, 0.18, { type: 'square', gain: 0.1 }),
  go: () => { tone(1320, 0.4, { type: 'square', gain: 0.1 }); noise(0.35, { gain: 0.5, freq: 3000 }); },
  boost: () => tone(500, 0.25, { type: 'sawtooth', gain: 0.05, slide: 2.4 }),
  fall: () => { tone(300, 0.3, { type: 'triangle', gain: 0.12, slide: 0.4 }); noise(0.15, { gain: 0.25, freq: 600, when: 0.12 }); },
  finish: () => tone(880, 0.12, { type: 'triangle', gain: 0.1 }),
  fanfare: () => {
    const notes = [523, 659, 784, 1047, 784, 1047];
    const times = [0, 0.13, 0.26, 0.39, 0.6, 0.73];
    notes.forEach((n, i) => tone(n, i === notes.length - 1 ? 0.7 : 0.16, { type: 'square', gain: 0.08, when: times[i] }));
    notes.forEach((n, i) => tone(n / 2, i === notes.length - 1 ? 0.7 : 0.16, { type: 'triangle', gain: 0.08, when: times[i] }));
  },
};
