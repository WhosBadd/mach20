// Wind, thruster and motor sounds, made in code with Web Audio (no audio files).
let ctx;
let master;
let wind;
let windFilter;
let rumble;
let thruster;
let motor;
let muted = false;
const motorOscillators = [];

// Browsers only allow sound after a tap or click, so call this from one. Safe to call again.
export function startSound() {
  if (ctx) {
    ctx.resume();
    return;
  }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = whiteNoise(2);
  noise.loop = true;
  noise.start();

  // Rushing air: noise through a low-pass filter that opens up as the air hits harder.
  windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  wind = gainNode();
  noise.connect(windFilter).connect(wind).connect(master);

  // Deep buffeting rumble at high dynamic pressure.
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.value = 90;
  rumble = gainNode();
  noise.connect(rumbleFilter).connect(rumble).connect(master);

  // Superhero thrusters: a soft hiss that follows the throttle.
  const thrusterFilter = ctx.createBiquadFilter();
  thrusterFilter.type = "bandpass";
  thrusterFilter.frequency.value = 500;
  thrusterFilter.Q.value = 0.7;
  thruster = gainNode();
  noise.connect(thrusterFilter).connect(thruster).connect(master);

  // Drone motor: two slightly detuned saw waves, softened.
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = "lowpass";
  motorFilter.frequency.value = 700;
  motor = gainNode();
  for (const detune of [0, 8]) {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.detune.value = detune;
    oscillator.connect(motorFilter);
    oscillator.start();
    motorOscillators.push(oscillator);
  }
  motorFilter.connect(motor).connect(master);
}

export function updateSound(f, throttle, running) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const on = running ? 1 : 0;
  const isDrone = f.mode === "drone";
  // 0 in still air or space, 1 from about Mach 2 at sea level.
  const air = Math.min(1, Math.sqrt(f.dynamicPressure / 2e5));

  wind.gain.setTargetAtTime(on * air * (isDrone ? 0.15 : 0.6), now, 0.15);
  windFilter.frequency.setTargetAtTime(250 + air * 4500, now, 0.15);
  rumble.gain.setTargetAtTime(on * f.buffet * (isDrone ? 0.2 : 1.2), now, 0.15);
  thruster.gain.setTargetAtTime(on * (isDrone ? 0 : 0.05 + throttle * 0.12), now, 0.15);
  motor.gain.setTargetAtTime(on * (isDrone ? 0.05 + throttle * 0.05 : 0), now, 0.15);
  for (const oscillator of motorOscillators) oscillator.frequency.setTargetAtTime(70 + throttle * 90, now, 0.15);
}

// A short cue when switching modes: a rising tone for the suit, two terminal beeps for the drone.
export function playModeChirp(mode) {
  if (!ctx) return;
  const start = ctx.currentTime;
  const beeps = mode === "drone" ? [[0, 1000], [0.12, 1000]] : [[0, 600]];
  for (const [delay, frequency] of beeps) {
    const oscillator = ctx.createOscillator();
    const envelope = gainNode();
    oscillator.type = mode === "drone" ? "square" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start + delay);
    if (mode !== "drone") oscillator.frequency.exponentialRampToValueAtTime(1300, start + delay + 0.18);
    envelope.gain.setValueAtTime(0.08, start + delay);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.18);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 0.2);
  }
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.8;
}

function gainNode() {
  const node = ctx.createGain();
  node.gain.value = 0;
  return node;
}

function whiteNoise(seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}
