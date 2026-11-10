// The 3D Earth: Cesium viewer, Google's photorealistic tiles, the camera, the sun and tile detail.
import { CESIUM_ION_TOKEN, GOOGLE_TILES_API_KEY } from "../config.js";
import { PROFILES } from "./flight.js";

// Lower screen-space error (sse) = sharper tiles but more downloading. Phones get less memory.
const QUALITY = {
  desktop: { pixelRatio: 2, msaa: 4, sse: 12, cacheMB: 1024 },
  mobile: { pixelRatio: 1.5, msaa: 2, sse: 16, cacheMB: 384 },
};

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

export function placeCamera(viewer, f, seconds) {
  // Buffeting: a smooth, uneven wobble from mixed sine waves. Per-frame random jitter reads as a glitch.
  const wobble = f.buffet * PROFILES[f.mode].shake + f.bump;
  const shakeHeading = wobble * (Math.sin(seconds * 29) + 0.5 * Math.sin(seconds * 53));
  const shakePitch = wobble * (Math.sin(seconds * 23) + 0.5 * Math.sin(seconds * 61));
  viewer.camera.setView({
    destination: f.position,
    orientation: {
      heading: Cesium.Math.toRadians(f.heading + shakeHeading),
      pitch: Cesium.Math.toRadians(f.pitch + shakePitch),
      roll: Cesium.Math.toRadians(f.roll),
    },
  });
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
