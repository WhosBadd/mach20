// The 3D Earth: Cesium viewer, Google's photorealistic tiles, the camera, the sun and tile detail.
import { CESIUM_ION_TOKEN, GOOGLE_TILES_API_KEY } from "../config.js";
import { PROFILES } from "./flight.js";

// Lower screen-space error (sse) = sharper tiles but more downloading. Phones get less memory.
const QUALITY = {
  desktop: { pixelRatio: 2, msaa: 4, sse: 12, cacheMB: 1024 },
  mobile: { pixelRatio: 1.5, msaa: 2, sse: 16, cacheMB: 384 },
};

// Chase view, per mode: metres behind and above the flyer, field of view and downward tilt in degrees,
// and how many seconds the camera takes to swing round after a turn.
export const CHASE = {
  hero: { distance: 6, lift: 1.5, fov: 70, lookDown: 8, lag: 0.25 },
  drone: { distance: 3.2, lift: 1.5, fov: 65, lookDown: 17, lag: 0.4 },
};
const CHASE_ROLL = 0.3; // the chase camera leans this much of your bank, so the flyer visibly tilts
let chase; // the chase camera's own heading, pitch and roll, trailing the flyer's

// Drone camera feed: monochrome with a faint green cast and a little extra contrast.
const SENSOR_SHADER = `
  uniform sampler2D colorTexture;
  in vec2 v_textureCoordinates;
  void main() {
    vec3 color = texture(colorTexture, v_textureCoordinates).rgb;
    float light = smoothstep(0.03, 0.97, dot(color, vec3(0.299, 0.587, 0.114)));
    out_FragColor = vec4(light * vec3(0.9, 1.0, 0.9), 1.0);
  }`;

export async function createWorld(mobile) {
  const quality = mobile ? QUALITY.mobile : QUALITY.desktop;
  Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  if (GOOGLE_TILES_API_KEY) Cesium.GoogleMaps.defaultApiKey = GOOGLE_TILES_API_KEY;

  const viewer = new Cesium.Viewer("globe", {
    globe: false, // Google's tiles already include the ground
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    msaaSamples: quality.msaa,
    useBrowserRecommendedResolution: false,
  });
  viewer.resolutionScale = Math.min(window.devicePixelRatio, quality.pixelRatio) / window.devicePixelRatio;
  viewer.clock.shouldAnimate = false;

  const scene = viewer.scene;
  scene.skyAtmosphere.show = true; // hidden by default when there is no globe
  scene.screenSpaceCameraController.enableInputs = false; // we fly the camera ourselves

  const tileset = await Cesium.createGooglePhotorealistic3DTileset(
    { onlyUsingWithGoogleGeocoder: true }, // there is no geocoder at all, which Google's terms allow
    {
      maximumScreenSpaceError: quality.sse,
      cacheBytes: quality.cacheMB * 1024 * 1024,
      showCreditsOnScreen: true, // Google requires its attribution to stay visible
    },
  );
  scene.primitives.add(tileset);

  const sensorStage = scene.postProcessStages.add(new Cesium.PostProcessStage({ fragmentShader: SENSOR_SHADER }));
  sensorStage.enabled = false;

  return { viewer, tileset, sensorStage, baseSse: quality.sse };
}

// view is "cockpit" (looking out from the flyer) or "chase" (watching it from behind).
export function placeCamera(viewer, f, view, seconds) {
  // Buffeting: a smooth, uneven wobble from mixed sine waves. Per-frame random jitter reads as a glitch.
  const wobble = f.buffet * PROFILES[f.mode].shake + f.bump;
  const shakeHeading = wobble * (Math.sin(seconds * 29) + 0.5 * Math.sin(seconds * 53));
  const shakePitch = wobble * (Math.sin(seconds * 23) + 0.5 * Math.sin(seconds * 61));
  const eye = view === "chase" ? trailFlyer(f, seconds) : f;
  viewer.camera.setView({
    destination: eye.position,
    orientation: {
      heading: Cesium.Math.toRadians(eye.heading + shakeHeading),
      pitch: Cesium.Math.toRadians(eye.pitch + shakePitch),
      roll: Cesium.Math.toRadians(eye.roll),
    },
  });
}

// Chase camera: behind and above the flyer, swinging round after it with a short lag,
// so you see it lean into turns instead of the world spinning round it.
function trailFlyer(f, seconds) {
  const c = CHASE[f.mode];
  // Start fresh after a jump to a new place, or when switching to this view.
  if (!chase || chase.flight !== f || seconds - chase.seconds > 0.5) {
    chase = { flight: f, heading: f.heading, pitch: f.pitch, roll: 0, seconds };
  }
  const follow = 1 - Math.exp(-(seconds - chase.seconds) / c.lag);
  chase.seconds = seconds;
  chase.heading += (((f.heading - chase.heading + 540) % 360) - 180) * follow; // the short way round
  chase.pitch += (f.pitch - chase.pitch) * follow;
  chase.roll += (f.roll * CHASE_ROLL - chase.roll) * follow;

  // Step back along the line of flight and up, in metres east, north and up from the flyer.
  const h = Cesium.Math.toRadians(chase.heading);
  const p = Cesium.Math.toRadians(chase.pitch);
  const back = new Cesium.Cartesian3(
    -Math.sin(h) * (c.distance * Math.cos(p) + c.lift * Math.sin(p)),
    -Math.cos(h) * (c.distance * Math.cos(p) + c.lift * Math.sin(p)),
    c.lift * Math.cos(p) - c.distance * Math.sin(p),
  );
  const toEarth = Cesium.Transforms.eastNorthUpToFixedFrame(f.position);
  const place = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(toEarth, back, back));
  // Climbing steeply puts the camera below you: keep it out of the ground.
  if (f.groundBelow !== undefined) place.height = Math.max(place.height, f.groundBelow + 1);

  return {
    position: Cesium.Cartographic.toCartesian(place),
    heading: chase.heading,
    pitch: chase.pitch - c.lookDown,
    roll: chase.roll,
  };
}

// The faster the ground sweeps past, the coarser the tiles: they arrive in time, so the view blurs
// like motion blur instead of breaking up. At Mach 20 high up the ground barely moves, so it stays sharp.
export function updateTileDetail(world, f) {
  const aboveGround = Math.max(f.height - (f.groundBelow ?? 0), 100);
  const sweep = f.speed / aboveGround; // your own height's worth of ground passing per second
  const blur = Math.min(Math.max((sweep - 2) / 8, 0), 1);
  world.tileset.maximumScreenSpaceError = world.baseSse * (1 + 3 * blur);
}

// Keep it mid-morning wherever you fly, so the sky matches Google's daylight photography.
export function setSunForLongitude(viewer, lon) {
  const utcHours = 10.5 - lon / 15;
  const midsummer = Date.UTC(2026, 5, 21);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(midsummer + utcHours * 3600e3));
}
