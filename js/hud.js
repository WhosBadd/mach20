// Draws both cockpit displays from the flight state, once per frame.
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const MPH = 2.23694;
const KNOTS = 1.94384;
const FEET = 3.28084;
const COMPASS_PX_PER_DEG = 4;

const hero = {
  speed: $("hero-speed"),
  mach: $("hero-mach"),
  g: $("hero-g"),
  alt: $("hero-alt"),
  vs: $("hero-vs"),
  agl: $("hero-agl"),
  throttle: $("hero-throttle"),
  ladder: $("hero-ladder"),
  compass: $("hero-compass"),
};
const drone = {
  noise: $("drone-noise"),
  horizon: $("drone-horizon"),
  time: $("drone-time"),
  hdg: $("drone-hdg"),
  lat: $("drone-lat"),
  lon: $("drone-lon"),
  gs: $("drone-gs"),
  mach: $("drone-mach"),
  throttle: $("drone-throttle"),
  alt: $("drone-alt"),
  agl: $("drone-agl"),
  vs: $("drone-vs"),
};
const heat = $("heat");
const warning = $("warning");
const throttleFill = $("throttle-fill");
const throttleLabel = $("throttle-label");

let pxPerDeg = 10;
let noise = 0;
let lastMach = 0;

buildCompass();
drone.noise.style.backgroundImage = makeNoiseTile();

// Size the pitch ladder so 1° on the HUD matches 1° in the 3D view. Call on resize and mode change.
export function buildHud(fovDeg) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfFov = (fovDeg * DEG) / 2; // Cesium's fov spans the wider side of the screen
  const halfFovY = w > h ? Math.atan((Math.tan(halfFov) * h) / w) : halfFov;
  pxPerDeg = (h / 2 / Math.tan(halfFovY)) * DEG;

  const rungs = [];
  for (let deg = -80; deg <= 80; deg += 10) {
    const rung = document.createElement("div");
    rung.className = deg === 0 ? "rung horizon" : deg < 0 ? "rung below" : "rung";
    rung.style.top = `${-deg * pxPerDeg}px`;
    if (deg !== 0) rung.innerHTML = `<span class="l">${Math.abs(deg)}</span><span class="r">${Math.abs(deg)}</span>`;
    rungs.push(rung);
  }
  hero.ladder.replaceChildren(...rungs);
}

export function updateHud(f, throttle, dt) {
  const aboveGround = f.groundBelow === undefined ? undefined : f.height - f.groundBelow;
  if (f.mode === "hero") updateHero(f, throttle, aboveGround);
  else updateDrone(f, throttle, aboveGround, dt);

  heat.style.opacity = (f.heat * 0.85).toFixed(3);
  throttleFill.style.height = `${throttle * 100}%`;
  throttleLabel.textContent = `${Math.round(throttle * 100)}%`;

  // Ground-proximity warning: less than 4 seconds to impact, or something taller than you just ahead.
  const sinking = f.verticalSpeed < -1 && aboveGround !== undefined;
  const secondsToImpact = sinking ? aboveGround / -f.verticalSpeed : Infinity;
  const blocked = f.groundAhead !== undefined && f.groundAhead > f.height;
  warning.textContent = f.mode === "hero" ? "PULL UP" : "TERRAIN";
  warning.classList.toggle("hidden", !(f.speed > 50 && (secondsToImpact < 4 || blocked)));
}

function updateHero(f, throttle, aboveGround) {
  hero.speed.textContent = thousands(f.speed * MPH);
  hero.mach.textContent = `M ${f.mach.toFixed(2)}`;
  hero.g.textContent = `${f.gLoad.toFixed(1)} G`;
  hero.alt.textContent = thousands(f.height * FEET);
  const fpm = f.verticalSpeed * FEET * 60;
  hero.vs.textContent = `${fpm >= 0 ? "▲" : "▼"} ${thousands(Math.abs(fpm))} FPM`;
  hero.agl.textContent = aboveGround === undefined ? "AGL ---" : `AGL ${thousands(aboveGround * FEET)}`;
  hero.throttle.textContent = `THR ${Math.round(throttle * 100)}%`;
  hero.ladder.style.transform = `rotate(${-f.roll}deg) translateY(${f.pitch * pxPerDeg}px)`;
  hero.compass.style.transform = `translateX(${-(compassHeading(f.heading) + 180) * COMPASS_PX_PER_DEG}px)`;
}

function updateDrone(f, throttle, aboveGround, dt) {
  // Sensor noise flickers up when the Mach number changes fast, and after a ground strike.
  const machRate = dt > 0 ? Math.abs(f.mach - lastMach) / dt : 0;
  lastMach = f.mach;
  noise += (Math.min(0.5, machRate * 0.5) + f.bump - noise) * Math.min(1, dt * 6);
  drone.noise.style.opacity = (0.07 + noise).toFixed(3);
  // Jumping one noise tile to a random spot each frame looks like live sensor static.
  drone.noise.style.backgroundPosition = `${Math.random() * 256}px ${Math.random() * 256}px`;

  drone.horizon.style.transform = `rotate(${-f.roll}deg) translateY(${f.pitch * pxPerDeg}px)`;
  drone.time.textContent = `${new Date().toISOString().slice(11, 19)}Z`;
  drone.hdg.textContent = `HDG ${String(Math.round(compassHeading(f.heading)) % 360).padStart(3, "0")}°`;
  drone.lat.textContent = `LAT ${dms(f.lat, "N", "S")}`;
  drone.lon.textContent = `LON ${dms(f.lon, "E", "W")}`;
  drone.gs.textContent = `GS ${thousands(f.speed * KNOTS)} KT`;
  drone.mach.textContent = `MACH ${f.mach.toFixed(2)}`;
  drone.throttle.textContent = `THR ${Math.round(throttle * 100)}%`;
  drone.alt.textContent = `ALT ${thousands(f.height * FEET)} FT`;
  drone.agl.textContent = aboveGround === undefined ? "AGL --- FT" : `AGL ${thousands(aboveGround * FEET)} FT`;
  drone.vs.textContent = `VS ${f.verticalSpeed >= 0 ? "+" : "-"}${thousands(Math.abs(f.verticalSpeed * FEET * 60))} FPM`;
}

// Heading tape from -180° to 540°, so any heading has 180° of tape either side.
function buildCompass() {
  const labels = { 0: "N", 90: "E", 180: "S", 270: "W" };
  const ticks = [];
  for (let deg = -180; deg <= 540; deg += 5) {
    const tick = document.createElement("i");
    const heading = compassHeading(deg);
    tick.className = deg % 30 === 0 ? "tick major" : "tick";
    tick.style.left = `${(deg + 180) * COMPASS_PX_PER_DEG}px`;
    if (deg % 30 === 0) tick.innerHTML = `<b>${labels[heading] ?? heading / 10}</b>`;
    ticks.push(tick);
  }
  hero.compass.replaceChildren(...ticks);
}

function makeNoiseTile() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const image = context.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return `url(${canvas.toDataURL()})`;
}

function compassHeading(deg) {
  return ((deg % 360) + 360) % 360;
}

function thousands(value) {
  return Math.round(value).toLocaleString("en-US");
}

// 40.685 → 40°41'06.0"N
function dms(value, positive, negative) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = Math.floor((abs - degrees) * 60);
  const seconds = ((abs - degrees) * 60 - minutes) * 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = seconds.toFixed(1).padStart(4, "0");
  return `${degrees}°${mm}'${ss}"${value >= 0 ? positive : negative}`;
}
