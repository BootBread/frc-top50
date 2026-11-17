// Little synthesised sound effects (no audio files). Browsers only allow sound after the player has
// pressed a key or clicked, which they always have by the time anything here plays.
let ac = null;
function ctx() {
  try { ac = ac || new AudioContext(); if (ac.state === "suspended") ac.resume(); return ac; } catch { return null; }
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  const a = ctx(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq, delay = 0) {
  const a = ctx(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + delay;
  s.buffer = buf; f.type = "lowpass"; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}
export const sfx = {
  thunk() { tone("sine", 140, 55, 0.25, 0.35); noise(0.12, 0.15, 900); },               // a log landing on the stack
  honk() { tone("square", 392, 380, 0.35, 0.06); tone("square", 330, 320, 0.35, 0.05); },  // a vehicle that wants you to move
  oink() { tone("sawtooth", 520, 260, 0.18, 0.05); tone("sawtooth", 480, 240, 0.16, 0.04, 0.2); },
  ding() { tone("sine", 880, 870, 0.5, 0.12); tone("sine", 1320, 1300, 0.4, 0.06, 0.08); },  // a job done
  cheer() { for (let k = 0; k < 6; k++) noise(0.5, 0.05, 1800 + k * 300, k * 0.06); },     // a small crowd
  splash() { noise(0.6, 0.2, 700); },
  rumble() { tone("sine", 50, 35, 1.2, 0.25); noise(1.0, 0.12, 160); },
};
