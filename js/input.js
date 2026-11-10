// Turns keyboard, mouse, touch and device tilt into one set of controls.
// pitch / roll / yaw run -1..1 (up, right, right are positive); throttle runs 0..1.
export const controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

const DEG = Math.PI / 180;
const MOUSE_SENSITIVITY = 0.004; // stick travel per pixel of mouse movement
const MOUSE_RECENTRE = 0.35; // seconds for the mouse stick to drift back to centre
const KEY_THROTTLE_RATE = 0.3; // W/S: full throttle in about 3 seconds
const WHEEL_THROTTLE_RATE = 0.0005; // per pixel of scroll
const TILT_FULL_BANK = 30; // degrees of device tilt for full bank
const TILT_FULL_PITCH = 25; // degrees of device tilt for full climb or dive

const keys = new Set();
const mouseStick = { x: 0, y: 0 };
const touchStick = { x: 0, y: 0 };
const tilt = { on: false, calibrate: false, flip: 1, neutralPitch: 0, x: 0, y: 0 };

export function setupInput({ canvas, mobile, isRunning, onToggleMode, onMenu }) {
  window.addEventListener("keydown", (e) => {
    if (e.code.startsWith("Arrow")) e.preventDefault();
    if (e.code === "KeyV" && !e.repeat) onToggleMode();
    if (e.code === "Escape" && !document.pointerLockElement) onMenu();
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear()); // otherwise keys stay "held" after alt-tab

  canvas.addEventListener("click", () => {
    if (isRunning() && !mobile) lockPointer(canvas);
  });
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement && isRunning()) onMenu(); // Esc released the mouse
  });
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    mouseStick.x = clamp(mouseStick.x + e.movementX * MOUSE_SENSITIVITY, -1, 1);
    mouseStick.y = clamp(mouseStick.y - e.movementY * MOUSE_SENSITIVITY, -1, 1);
  });
  window.addEventListener(
    "wheel",
    (e) => {
      if (isRunning()) controls.throttle = clamp(controls.throttle - e.deltaY * WHEEL_THROTTLE_RATE, 0, 1);
    },
    { passive: true },
  );

  if (mobile) setupTouch({ onToggleMode, onMenu });
}

export function lockPointer(canvas) {
  // Chrome returns a promise that rejects when it refuses (for example right after Esc);
  // Safari returns nothing. Either way, clicking the view tries again.
  const request = canvas.requestPointerLock();
  if (request) request.catch(() => {});
}

export function readControls(dt) {
  if (keys.has("KeyW")) controls.throttle += KEY_THROTTLE_RATE * dt;
  if (keys.has("KeyS")) controls.throttle -= KEY_THROTTLE_RATE * dt;
  controls.throttle = clamp(controls.throttle, 0, 1);

  const recentre = Math.exp(-dt / MOUSE_RECENTRE);
  mouseStick.x *= recentre;
  mouseStick.y *= recentre;

  controls.pitch = clamp(keyAxis("ArrowUp", "ArrowDown") + mouseStick.y + touchStick.y + tilt.y, -1, 1);
  controls.roll = clamp(keyAxis("ArrowRight", "ArrowLeft") + mouseStick.x + touchStick.x + tilt.x, -1, 1);
  controls.yaw = keyAxis("KeyE", "KeyQ");
}

function keyAxis(plus, minus) {
  return (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
}

function setupTouch({ onToggleMode, onMenu }) {
  const stick = document.getElementById("stick");
  const knob = document.getElementById("stick-knob");
  const throttle = document.getElementById("throttle");
  const tiltButton = document.getElementById("btn-tilt");

  stick.addEventListener("pointerdown", (e) => {
    stick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener("pointermove", (e) => {
    if (stick.hasPointerCapture(e.pointerId)) moveStick(e);
  });
  stick.addEventListener("pointerup", releaseStick);
  stick.addEventListener("pointercancel", releaseStick);

  function moveStick(e) {
    const box = stick.getBoundingClientRect();
    const radius = box.width / 2;
    let x = (e.clientX - box.left - radius) / radius;
    let y = (e.clientY - box.top - radius) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    touchStick.x = x;
    touchStick.y = -y; // drag up to climb
    knob.style.transform = `translate(${x * radius * 0.55}px, ${y * radius * 0.55}px)`;
  }

  function releaseStick() {
    touchStick.x = 0;
    touchStick.y = 0;
    knob.style.transform = "";
  }

  throttle.addEventListener("pointerdown", (e) => {
    throttle.setPointerCapture(e.pointerId);
    setThrottle(e);
  });
  throttle.addEventListener("pointermove", (e) => {
    if (throttle.hasPointerCapture(e.pointerId)) setThrottle(e);
  });

  function setThrottle(e) {
    const box = throttle.getBoundingClientRect();
    controls.throttle = clamp(1 - (e.clientY - box.top) / box.height, 0, 1);
  }

  document.getElementById("btn-menu").addEventListener("click", onMenu);
  document.getElementById("btn-mode").addEventListener("click", onToggleMode);
  tiltButton.addEventListener("click", async () => {
    await toggleTilt();
    tiltButton.classList.toggle("active", tilt.on);
  });
  window.addEventListener("deviceorientation", readTilt);
  // Stop iPhone/iPad pinch gestures from zooming the page.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

async function toggleTilt() {
  if (tilt.on) {
    tilt.on = false;
    tilt.x = 0;
    tilt.y = 0;
    return;
  }
  // iPhone and iPad ask the user before sharing motion; the button tap counts as their go-ahead.
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const answer = await DeviceOrientationEvent.requestPermission();
    if (answer !== "granted") return;
  }
  tilt.on = true;
  tilt.calibrate = true; // however the device is held right now becomes "level"
}

function readTilt(e) {
  if (!tilt.on || e.beta === null) return;
  const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
  let g = screenGravity(e.beta, e.gamma, screenAngle * tilt.flip);
  if (tilt.calibrate) {
    // Gravity can't point up the screen while you hold the device in front of you.
    // If it does, this browser reports screen rotation the other way round.
    if (g.y > 0.3) {
      tilt.flip = -tilt.flip;
      g = screenGravity(e.beta, e.gamma, screenAngle * tilt.flip);
    }
    tilt.neutralPitch = Math.atan2(-g.y, -g.z) / DEG;
    tilt.calibrate = false;
  }
  const pitchAngle = Math.atan2(-g.y, -g.z) / DEG; // 0 = lying flat, 90 = upright
  const bankAngle = Math.asin(clamp(g.x, -1, 1)) / DEG; // right side down = positive
  tilt.x = clamp(bankAngle / TILT_FULL_BANK, -1, 1);
  tilt.y = clamp((pitchAngle - tilt.neutralPitch) / TILT_FULL_PITCH, -1, 1);
}

// Direction of gravity in screen axes (x right, y up, z out of the screen), from the
// W3C DeviceOrientation angles. Working from gravity avoids gimbal flips when held upright.
function screenGravity(betaDeg, gammaDeg, screenAngleDeg) {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const x = Math.sin(g) * Math.cos(b);
  const y = -Math.sin(b);
  const z = -Math.cos(b) * Math.cos(g);
  const a = screenAngleDeg * DEG;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a), z };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
