// Starts the app, runs the menu, and runs the game loop once per rendered frame.
import { PLACES } from "../config.js";
import { createWorld, placeCamera, setSunForLongitude, updateTileDetail } from "./world.js";
import { PROFILES, createFlight, pointAhead, stepFlight } from "./flight.js";
import { controls, lockPointer, readControls, setupInput } from "./input.js";
import { buildHud, updateHud } from "./hud.js";
import { playModeChirp, setMuted, startSound, updateSound } from "./sound.js";

// iPhone, iPad (which says it is a Mac) and Android get touch controls and lighter graphics.
const isMobile =
  /iPhone|iPad|iPod|Android/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const $ = (id) => document.getElementById(id);
const menu = $("menu");
const status = $("status");
const startButton = $("btn-start");
const soundButton = $("btn-sound");

let world;
let flight;
let running = false;
let muted = false;
let lastFrame = performance.now();
let lastGroundSample = 0;

main();

async function main() {
  document.body.classList.toggle("touch", isMobile);
  try {
    world = await createWorld(isMobile);
  } catch (error) {
    status.textContent = `Could not load the 3D Earth (${error.message}). Check CESIUM_ION_TOKEN in config.js.`;
    return;
  }
  world.tileset.initialTilesLoaded.addEventListener(() => status.classList.add("hidden"));

  flight = createFlight(PLACES[0], "hero");
  setMode("hero");
  buildMenu();
  setupInput({
    canvas: world.viewer.canvas,
    mobile: isMobile,
    isRunning: () => running,
    onToggleMode: () => setMode(flight.mode === "hero" ? "drone" : "hero"),
    onMenu: openMenu,
  });
  window.addEventListener("resize", () => buildHud(PROFILES[flight.mode].fov));

  world.viewer.scene.preUpdate.addEventListener(frame);
  world.viewer.scene.postRender.addEventListener(sampleGround);
  startButton.disabled = false;
}

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.1); // a stalled frame must not fling you across the map
  lastFrame = now;

  if (running) {
    readControls(dt);
    stepFlight(flight, controls, dt);
  }
  updateTileDetail(world, flight);
  setSunForLongitude(world.viewer, flight.lon);
  placeCamera(world.viewer, flight, now / 1000);
  updateHud(flight, controls.throttle, running ? dt : 0);
  updateSound(flight, controls.throttle, running);
}

// Ground height comes from the tiles just drawn, so read it after a render. Ten times a second is plenty.
function sampleGround() {
  const now = performance.now();
  if (now - lastGroundSample < 100) return;
  lastGroundSample = now;
  const scene = world.viewer.scene;
  flight.groundBelow = scene.sampleHeight(Cesium.Cartographic.fromCartesian(flight.position));
  flight.groundAhead = flight.speed > 20 ? scene.sampleHeight(pointAhead(flight, flight.speed)) : undefined;
}

function setMode(mode) {
  flight.mode = mode;
  document.body.classList.toggle("mode-hero", mode === "hero");
  document.body.classList.toggle("mode-drone", mode === "drone");
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
  world.viewer.camera.frustum.fov = Cesium.Math.toRadians(PROFILES[mode].fov);
  world.sensorStage.enabled = mode === "drone";
  buildHud(PROFILES[mode].fov);
  playModeChirp(mode);
}

function buildMenu() {
  const places = $("places");
  for (const place of PLACES) {
    const button = document.createElement("button");
    button.textContent = place.name;
    button.addEventListener("click", () => {
      flight = createFlight(place, flight.mode);
      controls.throttle = 0;
      startFlying();
    });
    places.append(button);
  }
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  startButton.addEventListener("click", startFlying);
  soundButton.addEventListener("click", () => {
    muted = !muted;
    setMuted(muted);
    soundButton.textContent = muted ? "Sound: off" : "Sound: on";
  });
}

function startFlying() {
  menu.classList.add("hidden");
  startButton.textContent = "Resume";
  running = true;
  startSound();
  if (!isMobile) lockPointer(world.viewer.canvas);
}

function openMenu() {
  running = false;
  menu.classList.remove("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
}
