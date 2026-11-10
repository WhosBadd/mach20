// Flight physics. Everything is true scale: metres, seconds, the real Earth.
const { Cartesian3, Cartographic, Matrix4, Transforms } = Cesium;

const G = 9.81;
const DEG = Math.PI / 180;

// Top speed is orbital velocity: 7.8 km/s, about Mach 23 at sea level.
const MAX_SPEED = 7800;

// How each mode flies. Angles in degrees, rates in degrees per second, times in seconds.
export const PROFILES = {
  hero: {
    fov: 75, // camera field of view
    shake: 0.8, // degrees of buffet at full dynamic pressure
    maxBank: 75,
    bankTime: 0.15, // how quickly you lean into a bank
    turnRate: 90,
    pitchRate: 70,
    yawRate: 60,
    maxG: 40, // turning is capped by g-force, so turns widen as speed builds
    maxPitch: 88,
    accel: 25, // m/s² from a hover...
    accelPerSpeed: 0.18, // ...plus this much per m/s of speed
    brakeFactor: 4, // stops far harder than it speeds up
    minSpeed: 0,
    clearance: 2, // metres kept above the ground
    autoLevel: false,
  },
  drone: {
    fov: 50,
    shake: 0.15,
    maxBank: 30,
    bankTime: 1.2,
    turnRate: 12,
    pitchRate: 8,
    yawRate: 6,
    maxG: 4,
    maxPitch: 30,
    accel: 6,
    accelPerSpeed: 0.08,
    brakeFactor: 1,
    minSpeed: 30, // always drifting forward
    clearance: 30,
    autoLevel: true, // the nose settles back to level when you let go
  },
};

// International Standard Atmosphere: [altitude m, temperature K].
const ATMOSPHERE = [
  [0, 288.15],
  [11000, 216.65],
  [20000, 216.65],
  [32000, 228.65],
  [47000, 270.65],
  [51000, 270.65],
  [71000, 214.65],
  [84852, 186.87],
];

export function createFlight(place, mode) {
  return {
    mode,
    position: Cartesian3.fromDegrees(place.lon, place.lat, place.height),
    lat: place.lat,
    lon: place.lon,
    height: place.height,
    heading: place.heading,
    pitch: place.pitch,
    roll: 0,
    speed: PROFILES[mode].minSpeed,
    verticalSpeed: 0,
    mach: 0,
    gLoad: 1,
    dynamicPressure: 0,
    buffet: 0, // 0..1, drives camera shake and rumble
    heat: 0, // 0..1, drives the plasma glow
    bump: 0, // 0..1, a jolt after hitting the ground
    groundBelow: undefined, // ground (or rooftop) height under you, sampled by main.js
    groundAhead: undefined, // ground height one second ahead
  };
}

export function stepFlight(f, input, dt) {
  const p = PROFILES[f.mode];

  // Throttle sets a target speed. Cubing it gives fine control when slow and still reaches orbital speed.
  const target = p.minSpeed + (MAX_SPEED - p.minSpeed) * input.throttle ** 3;
  let rate = p.accel + p.accelPerSpeed * f.speed;
  if (target < f.speed) rate *= p.brakeFactor;
  f.speed = moveToward(f.speed, target, rate * dt);

  // Turn rate is limited by g-force: at Mach 20 even 40 g only turns about 3° a second.
  const gLimit = (p.maxG * G) / Math.max(f.speed, 1) / DEG;
  f.roll += (input.roll * p.maxBank - f.roll) * Math.min(1, dt / p.bankTime);
  const turn = (f.roll / p.maxBank) * Math.min(p.turnRate, gLimit) + input.yaw * Math.min(p.yawRate, gLimit);
  let climb = input.pitch * Math.min(p.pitchRate, gLimit);
  if (p.autoLevel && Math.abs(input.pitch) < 0.05) climb = -f.pitch * 0.5;
  f.heading += turn * dt;
  f.pitch = clamp(f.pitch + climb * dt, -p.maxPitch, p.maxPitch);
  f.gLoad = 1 + (f.speed * Math.hypot(turn, climb) * DEG) / G;

  // Move along the ground at the current heading, and up or down by the pitch.
  const forward = horizontalForward(f.position, f.heading);
  const distance = f.speed * dt;
  const step = Cartesian3.multiplyByScalar(forward, distance * Math.cos(f.pitch * DEG), new Cartesian3());
  const place = Cartographic.fromCartesian(Cartesian3.add(f.position, step, step));
  place.height = f.height + distance * Math.sin(f.pitch * DEG);
  keepAboveGround(f, place, p, dt);

  f.verticalSpeed = (place.height - f.height) / dt;
  f.height = place.height;
  f.lat = place.latitude / DEG;
  f.lon = place.longitude / DEG;
  f.position = Cartographic.toCartesian(place);

  // Carry the heading to the new spot, so long flights follow great circles like real ones.
  const toLocal = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(f.position), new Matrix4());
  const local = Matrix4.multiplyByPointAsVector(toLocal, forward, new Cartesian3());
  f.heading = Math.atan2(local.x, local.y) / DEG;

  const density = airDensity(f.height);
  f.mach = f.speed / speedOfSound(f.height);
  f.dynamicPressure = 0.5 * density * f.speed ** 2;
  f.buffet = Math.sqrt(Math.min(1, f.dynamicPressure / 2.8e7)); // 1 = Mach 20 at sea level
  // Sutton–Graves heating: glows from about Mach 8 down low, or Mach 20 at 60 km.
  f.heat = Math.min(1, (Math.sqrt(density) * f.speed ** 3) / 1e10);
  f.bump *= Math.exp(-dt * 3);
}

// Ground position `distance` metres straight ahead, for sampling terrain before you reach it.
export function pointAhead(f, distance) {
  const forward = horizontalForward(f.position, f.heading);
  const ahead = Cartesian3.multiplyByScalar(forward, distance, forward);
  return Cartographic.fromCartesian(Cartesian3.add(f.position, ahead, ahead));
}

// Never pass through the ground. groundAhead is one second ahead, so faster flight starts climbing sooner.
function keepAboveGround(f, place, p, dt) {
  if (f.groundAhead !== undefined && place.height < f.groundAhead + p.clearance) {
    place.height += (f.groundAhead + p.clearance - place.height) * Math.min(1, dt * 3);
  }
  if (f.groundBelow === undefined || place.height >= f.groundBelow + p.clearance) return;

  place.height = f.groundBelow + p.clearance;
  if (f.pitch < 0) {
    // Touchdown: the downward part of the motion is absorbed and you level out.
    f.bump = Math.min(1, (f.speed * -Math.sin(f.pitch * DEG)) / 200);
    f.speed *= Math.cos(f.pitch * DEG);
    f.pitch = 0;
  }
}

// Unit vector along the ground at this heading, in Earth-centred coordinates.
function horizontalForward(position, headingDeg) {
  const h = headingDeg * DEG;
  const eastNorthUp = Transforms.eastNorthUpToFixedFrame(position);
  return Matrix4.multiplyByPointAsVector(eastNorthUp, new Cartesian3(Math.sin(h), Math.cos(h), 0), new Cartesian3());
}

function speedOfSound(altitude) {
  return Math.sqrt(1.4 * 287.05 * temperatureAt(altitude));
}

function temperatureAt(altitude) {
  if (altitude <= 0) return ATMOSPHERE[0][1];
  for (let i = 1; i < ATMOSPHERE.length; i++) {
    const [h1, t1] = ATMOSPHERE[i];
    if (altitude > h1) continue;
    const [h0, t0] = ATMOSPHERE[i - 1];
    return t0 + ((t1 - t0) * (altitude - h0)) / (h1 - h0);
  }
  return ATMOSPHERE[ATMOSPHERE.length - 1][1];
}

// Air density in kg/m³. An exponential fit: close enough for wind noise, buffet and heating.
function airDensity(altitude) {
  return 1.225 * Math.exp(-Math.max(altitude, 0) / 8000);
}

function moveToward(value, target, maxStep) {
  if (value < target) return Math.min(value + maxStep, target);
  return Math.max(value - maxStep, target);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
