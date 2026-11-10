// The flyer you watch in chase view: the armored suit (Superhero) or the recon quadcopter (Drone).
// The models are built by tools/build-models.mjs.
const { Cartesian3, Ellipsoid, HeadingPitchRoll, Matrix4, Model, Transforms } = Cesium;

const HOVER_SPEED = 40; // m/s: slower than this the suit straightens up to hover, feet first
const HOVER_PITCH = 85; // degrees: nearly upright when hovering
const DRONE_LEAN = 0.6; // degrees of forward lean per m/s, the way a quadcopter flies...
const DRONE_MAX_LEAN = 25; // ...up to this much
const FLAMES = ["flame-1", "flame-2", "flame-3", "flame-4"];

export async function loadFlyers(scene) {
  // Redraw the sky reflected in the armor every 10 km travelled instead of Cesium's 1 km,
  // which at Mach 20 would be several times a second.
  const options = { environmentMapOptions: { maximumPositionEpsilon: 10000 } };
  const [hero, drone] = await Promise.all([
    Model.fromGltfAsync({ url: "models/hero.glb", ...options }),
    Model.fromGltfAsync({ url: "models/drone.glb", ...options }),
  ]);
  scene.primitives.add(hero);
  scene.primitives.add(drone);
  return { hero, drone };
}

export function updateFlyers(flyers, f, view, throttle, seconds) {
  flyers.hero.show = view === "chase" && f.mode === "hero";
  flyers.drone.show = view === "chase" && f.mode === "drone";
  if (view !== "chase") return;

  let pitch = f.pitch;
  if (f.mode === "hero") {
    // Slow down and the suit straightens up to hover; speed up and it lies flat, head first like a dart.
    const upright = Math.max(0, 1 - f.speed / HOVER_SPEED);
    pitch += (HOVER_PITCH - f.pitch) * upright;
  } else {
    pitch -= Math.min(DRONE_MAX_LEAN, f.speed * DRONE_LEAN);
  }
  const model = flyers[f.mode];
  const turn = HeadingPitchRoll.fromDegrees(f.heading, pitch, f.roll);
  // North-west-up makes heading 0 face north with the model's nose along its forward axis.
  Transforms.headingPitchRollToFixedFrame(f.position, turn, Ellipsoid.WGS84, Transforms.northWestUpToFixedFrame, model.modelMatrix);

  // Model nodes exist once the model has finished loading onto the GPU, a frame or two after it is added.
  if (f.mode === "hero" && model.ready) setFlames(model, throttle, seconds);
}

// The thruster flames stretch with the throttle and flicker a little, each out of step with the others.
function setFlames(model, throttle, seconds) {
  FLAMES.forEach((name, i) => {
    const flicker = 1 + 0.08 * Math.sin(seconds * 41 + i * 1.7) + 0.05 * Math.sin(seconds * 67 + i * 2.9);
    const length = (0.3 + 1.5 * throttle) * flicker;
    const width = 1 + 0.5 * throttle;
    model.getNode(name).matrix = Matrix4.fromScale(new Cartesian3(width, length, width));
  });
}
