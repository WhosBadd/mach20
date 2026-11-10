// Builds the two chase-view models: an armored flyer (Superhero) and a recon quadcopter (Drone).
// Every part is a smooth rounded shape with a metal, plastic or glow material: no textures, no downloads.
//
//   node tools/build-models.mjs      → writes models/hero.glb and models/drone.glb
//
// glTF axes: +Y up, +Z forward, +X the model's left. Sizes are in metres.
import { mkdirSync, writeFileSync } from "node:fs";

const SEGMENTS = 28; // points around each round part
const CAP_STEPS = 7; // rings in each rounded end

// ---------- Materials ----------
const MATERIALS = {
  armor: { color: [0.11, 0.12, 0.135, 1], metallic: 0.6, roughness: 0.4 }, // graphite under-armor
  plate: { color: [0.84, 0.85, 0.87, 1], metallic: 0.05, roughness: 0.32 }, // white ceramic plates
  joint: { color: [0.035, 0.04, 0.045, 1], metallic: 0.1, roughness: 0.7 }, // black flex suit
  nozzle: { color: [0.08, 0.08, 0.09, 1], metallic: 1, roughness: 0.4, doubleSided: true },
  glowCyan: { color: [0, 0, 0, 1], emissive: [0.55, 0.91, 1], metallic: 0, roughness: 1 },
  flame: { color: [1, 1, 1, 1], unlit: true, blend: true, doubleSided: true },
  shell: { color: [0.86, 0.87, 0.88, 1], metallic: 0, roughness: 0.35 }, // white plastic
  carbon: { color: [0.05, 0.05, 0.055, 1], metallic: 0.3, roughness: 0.38 },
  lens: { color: [0.01, 0.01, 0.015, 1], metallic: 0, roughness: 0.04 },
  glowGreen: { color: [0, 0, 0, 1], emissive: [0.45, 1, 0.4], metallic: 0, roughness: 1 },
  glowRed: { color: [0, 0, 0, 1], emissive: [1, 0.18, 0.12], metallic: 0, roughness: 1 },
  rotor: { color: [0.08, 0.08, 0.09, 1], metallic: 0, roughness: 0.6, blend: true, doubleSided: true },
};

// ---------- Shapes ----------
// A shape is turned around the Y axis from a profile of [radius, y] points listed bottom to top.
function lathe(profile, colorAt) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const before = profile[Math.max(i - 1, 0)];
    const after = profile[Math.min(i + 1, profile.length - 1)];
    // The surface normal is the profile's slope turned outwards.
    const nr = after[1] - before[1];
    const ny = -(after[0] - before[0]);
    const length = Math.hypot(nr, ny) || 1;
    for (let j = 0; j <= SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      positions.push(r * Math.cos(a), y, r * Math.sin(a));
      normals.push((nr / length) * Math.cos(a), ny / length, (nr / length) * Math.sin(a));
      if (colorAt) colors.push(...colorAt(r, y));
    }
  }
  const row = SEGMENTS + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, c, d, b);
    }
  }
  return { positions, normals, colors: colorAt ? colors : null, indices };
}

function sphere() {
  const profile = [];
  for (let k = 0; k <= CAP_STEPS * 2; k++) {
    const angle = -Math.PI / 2 + (k / (CAP_STEPS * 2)) * Math.PI;
    profile.push([Math.cos(angle), Math.sin(angle)]);
  }
  return lathe(profile);
}

// A limb: rounded at both ends, radius r0 at the bottom (y = 0) and r1 at the top (y = length).
function capsule(r0, r1, length) {
  const profile = [];
  for (let k = 0; k <= CAP_STEPS; k++) {
    const angle = -Math.PI / 2 + (k / CAP_STEPS) * (Math.PI / 2);
    profile.push([r0 * Math.cos(angle), r0 * Math.sin(angle)]);
  }
  for (let k = 0; k <= CAP_STEPS; k++) {
    const angle = (k / CAP_STEPS) * (Math.PI / 2);
    profile.push([r1 * Math.cos(angle), length + r1 * Math.sin(angle)]);
  }
  return lathe(profile);
}

// An open cone, for thruster nozzles: radius r0 at y = 0 widening or narrowing to r1 at y = height.
function bell(r0, r1, height) {
  return lathe([
    [r0, 0],
    [r1, height],
  ]);
}

// A flat disc of radius r at y = 0, facing up.
function disc(r, colorAt) {
  return lathe(
    [
      [r, 0],
      [r * 0.7, 0],
      [r * 0.35, 0],
      [0, 0],
    ],
    colorAt,
  );
}

// A flame one metre long and one metre wide, pointing down -Y from its base at y = 0.
// It fades from a white-hot core to clear blue at the tip; the game stretches it with the throttle.
function flame() {
  const profile = [
    [0, -1],
    [0.18, -0.8],
    [0.42, -0.5],
    [0.66, -0.22],
    [0.8, -0.06],
    [0.55, 0.02],
    [0, 0.03],
  ];
  return lathe(profile, (r, y) => {
    const along = Math.min(1, -y); // 0 at the nozzle, 1 at the tip
    const hot = 1 - along;
    return [0.35 + 0.6 * hot ** 2, 0.7 + 0.28 * hot, 1, 0.85 * hot ** 1.4];
  });
}

// ---------- Placing parts ----------
// Bake a shape into the model: scale it, turn its Y axis to point `from` → `to` (or keep it upright),
// and move it into place. Normals are scaled inversely so lighting stays right on squashed shapes.
function place(shape, { at = [0, 0, 0], scale = [1, 1, 1], from, to }) {
  let rotation = identity();
  let origin = at;
  if (from && to) {
    const direction = subtract(to, from);
    rotation = rotateYTo(normalize(direction));
    origin = from;
  }
  const positions = [];
  const normals = [];
  for (let i = 0; i < shape.positions.length; i += 3) {
    const p = [shape.positions[i] * scale[0], shape.positions[i + 1] * scale[1], shape.positions[i + 2] * scale[2]];
    const n = [shape.normals[i] / scale[0], shape.normals[i + 1] / scale[1], shape.normals[i + 2] / scale[2]];
    positions.push(...sum(multiply(rotation, p), origin));
    normals.push(...normalize(multiply(rotation, n)));
  }
  return { positions, normals, colors: shape.colors, indices: shape.indices };
}

// A limb from one joint to the next.
function limb(from, to, r0, r1) {
  const length = Math.hypot(...subtract(to, from));
  return place(capsule(r0, r1, length), { from, to });
}

// Mirror a part to the model's other side.
function mirrorX([x, y, z]) {
  return [-x, y, z];
}

// ---------- The armored flyer ----------
// Built standing up, facing +Z, feet at y = 0. The whole body is then tipped forward to fly head first.
// White ceramic plates over a graphite under-armor, with cyan light from the visor and thrusters.
function buildHero() {
  const parts = [];
  const add = (material, mesh) => parts.push({ material, mesh });
  const ball = (material, at, scale) => add(material, place(sphere(), { at, scale }));
  const thrusters = []; // [x, y, z, nozzle radius]: where flames come out, pointing down -Y

  // Head
  ball("plate", [0, 1.72, 0.005], [0.11, 0.13, 0.122]);
  ball("armor", [0, 1.705, 0.03], [0.1, 0.075, 0.105]); // dark face mask
  ball("glowCyan", [0, 1.725, 0.03], [0.088, 0.02, 0.108]); // visor slit
  ball("armor", [0, 1.755, -0.012], [0.024, 0.1, 0.13]); // crest
  add("joint", limb([0, 1.52, -0.005], [0, 1.62, 0], 0.068, 0.058)); // neck

  // Torso: broad chest, narrow waist
  ball("armor", [0, 1.37, 0], [0.22, 0.18, 0.14]);
  ball("plate", [0, 1.4, 0.05], [0.18, 0.13, 0.1]); // chest plate
  ball("plate", [0.1, 1.37, -0.06], [0.11, 0.14, 0.08]); // shoulder blades
  ball("plate", [-0.1, 1.37, -0.06], [0.11, 0.14, 0.08]);
  ball("joint", [0, 1.17, 0], [0.14, 0.1, 0.105]); // waist
  ball("plate", [0, 1.17, 0.05], [0.095, 0.075, 0.065]); // abdomen plate
  ball("armor", [0, 1.07, 0], [0.165, 0.055, 0.118]); // belt
  ball("plate", [0, 0.99, 0], [0.175, 0.085, 0.12]); // hips

  // Jetpack: a spine and two thruster pods. From the chase camera this is most of what you see.
  add("armor", limb([0, 1.18, -0.15], [0, 1.47, -0.14], 0.055, 0.05));
  for (const x of [0.1, -0.1]) {
    add("plate", limb([x, 1.2, -0.175], [x, 1.47, -0.165], 0.066, 0.056));
    ball("glowCyan", [x, 1.34, -0.236], [0.011, 0.075, 0.009]); // light strip down each pod
    add("nozzle", place(bell(0.054, 0.046, 0.07), { at: [x, 1.1, -0.175] }));
    ball("glowCyan", [x, 1.125, -0.175], [0.044, 0.006, 0.044]); // hot throat inside the nozzle
    thrusters.push([x, 1.1, -0.175, 0.05]);
  }

  for (const side of [1, -1]) {
    const s = (point) => (side === 1 ? point : mirrorX(point));
    // Arm, held along the body like a diver
    ball("plate", s([0.255, 1.475, 0]), [0.105, 0.078, 0.1]); // shoulder armor
    add("armor", limb(s([0.28, 1.42, 0]), s([0.3, 1.15, -0.01]), 0.07, 0.06));
    ball("joint", s([0.3, 1.14, -0.01]), [0.056, 0.056, 0.056]); // elbow
    add("plate", limb(s([0.3, 1.12, -0.005]), s([0.3, 0.9, 0.01]), 0.062, 0.068)); // gauntlet, flared at the wrist
    ball("joint", s([0.3, 0.81, 0.01]), [0.042, 0.072, 0.05]); // hand

    // Leg, toes pointed so the boot thrusters push straight back
    add("plate", limb(s([0.1, 0.95, 0]), s([0.11, 0.56, 0.01]), 0.105, 0.08)); // thigh
    add("armor", limb(s([0.132, 0.88, 0.004]), s([0.138, 0.64, 0.012]), 0.08, 0.062)); // dark side panel
    ball("armor", s([0.11, 0.53, 0.005]), [0.07, 0.07, 0.07]); // knee joint
    ball("plate", s([0.11, 0.53, 0.05]), [0.058, 0.06, 0.04]); // kneecap
    add("plate", limb(s([0.11, 0.5, 0]), s([0.115, 0.21, -0.005]), 0.08, 0.062)); // shin
    add("armor", limb(s([0.14, 0.46, -0.002]), s([0.143, 0.26, -0.006]), 0.06, 0.05)); // dark side panel
    ball("joint", s([0.115, 0.2, -0.002]), [0.06, 0.06, 0.06]); // ankle
    add("armor", limb(s([0.115, 0.19, 0]), s([0.117, 0.05, 0.035]), 0.07, 0.062)); // boot
    add("nozzle", place(bell(0.05, 0.042, 0.05), { at: s([0.117, -0.04, 0.035]) }));
    ball("glowCyan", s([0.117, -0.022, 0.035]), [0.04, 0.006, 0.04]);
    thrusters.push([...s([0.117, -0.04, 0.035]), 0.045]);
  }

  // Centre the body on the hips, then tip it 90° forward so the head leads and the back faces up.
  const prone = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // quaternion: +90° about X
  return { parts, thrusters, root: { rotation: prone, center: [0, 1.0, 0] } };
}

// ---------- The recon quadcopter ----------
function buildDrone() {
  const parts = [];
  const add = (material, mesh) => parts.push({ material, mesh });

  // Body, canopy and the green status light on top
  add("shell", place(sphere(), { at: [0, 0, 0], scale: [0.13, 0.055, 0.2] }));
  add("carbon", place(sphere(), { at: [0, 0.03, -0.02], scale: [0.09, 0.04, 0.12] }));
  add("glowGreen", place(sphere(), { at: [0, 0.066, -0.02], scale: [0.01, 0.007, 0.06] }));

  // Camera gimbal under the nose
  add("carbon", limb([0, -0.03, 0.13], [0, -0.06, 0.13], 0.012, 0.012));
  add("carbon", place(sphere(), { at: [0, -0.078, 0.13], scale: [0.045, 0.045, 0.045] }));
  add("lens", place(sphere(), { at: [0, -0.078, 0.162], scale: [0.026, 0.026, 0.018] }));

  // Four arms in an X, each with a motor and a spinning rotor (drawn as its blur disc).
  const rotorBlur = (r) => {
    const t = r / 0.21; // 0 at the hub, 1 at the blade tips
    return [1, 1, 1, t > 0.97 ? 0.12 : 0.16 + 0.3 * t ** 3];
  };
  for (const [x, z] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const tip = [0.32 * x, 0.02, 0.32 * z];
    add("carbon", limb([0.07 * x, 0.01, 0.1 * z], tip, 0.02, 0.016));
    add("carbon", place(capsule(1, 1, 3), { at: [tip[0], 0.025, tip[2]], scale: [0.04, 0.01, 0.04] })); // motor
    add("plate", place(bell(0.041, 0.041, 0.012), { at: [tip[0], 0.045, tip[2]] })); // motor band
    add("plate", place(sphere(), { at: [tip[0], 0.082, tip[2]], scale: [0.013, 0.01, 0.013] })); // hub
    add("rotor", place(disc(0.21, rotorBlur), { at: [tip[0], 0.078, tip[2]] }));
    // Navigation lights: green at the front, red at the back.
    add(z > 0 ? "glowGreen" : "glowRed", place(sphere(), { at: [0.35 * x, 0.04, 0.35 * z], scale: [0.012, 0.012, 0.012] }));
  }

  // Landing skids
  for (const x of [1, -1]) {
    add("carbon", limb([0.06 * x, -0.04, 0.08], [0.12 * x, -0.17, 0.08], 0.009, 0.008));
    add("carbon", limb([0.06 * x, -0.04, -0.08], [0.12 * x, -0.17, -0.08], 0.009, 0.008));
    add("carbon", limb([0.12 * x, -0.17, -0.15], [0.12 * x, -0.17, 0.15], 0.011, 0.011));
  }

  return { parts, thrusters: [], root: { rotation: [0, 0, 0, 1], center: [0, 0, 0] } };
}

// ---------- Writing .glb ----------
function writeGlb(path, { parts, thrusters, root }) {
  const json = {
    asset: { version: "2.0", generator: "Mach 20 tools/build-models.mjs" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "body", rotation: root.rotation, children: [] }],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let byteLength = 0;

  function addBuffer(typedArray, target) {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes);
    byteLength += bytes.length;
    const padding = (4 - (bytes.length % 4)) % 4;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      byteLength += padding;
    }
    return json.bufferViews.length - 1;
  }

  function addAccessor(values, type, componentType, target, withBounds) {
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const array = componentType === 5126 ? new Float32Array(values) : new Uint16Array(values);
    const accessor = { bufferView: addBuffer(array, target), componentType, count: values.length / size, type };
    if (withBounds) {
      accessor.min = [0, 1, 2].map((k) => Math.min(...values.filter((_, i) => i % 3 === k)));
      accessor.max = [0, 1, 2].map((k) => Math.max(...values.filter((_, i) => i % 3 === k)));
    }
    json.accessors.push(accessor);
    return json.accessors.length - 1;
  }

  function addMaterial(name) {
    const m = MATERIALS[name];
    const material = {
      name,
      pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metallic ?? 0, roughnessFactor: m.roughness ?? 1 },
    };
    if (m.emissive) material.emissiveFactor = m.emissive;
    if (m.blend) material.alphaMode = "BLEND";
    if (m.doubleSided) material.doubleSided = true;
    if (m.unlit) material.extensions = { KHR_materials_unlit: {} };
    json.materials.push(material);
    return json.materials.length - 1;
  }

  // Merge every part that shares a material into one mesh, shifted so the model turns about `center`.
  function addMesh(name, meshes, center) {
    const merged = { positions: [], normals: [], colors: [], indices: [] };
    for (const mesh of meshes) {
      const offset = merged.positions.length / 3;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        merged.positions.push(mesh.positions[i] - center[0], mesh.positions[i + 1] - center[1], mesh.positions[i + 2] - center[2]);
      }
      merged.normals.push(...mesh.normals);
      if (mesh.colors) merged.colors.push(...mesh.colors);
      merged.indices.push(...mesh.indices.map((index) => index + offset));
    }
    const attributes = {
      POSITION: addAccessor(merged.positions, "VEC3", 5126, 34962, true),
      NORMAL: addAccessor(merged.normals, "VEC3", 5126, 34962),
    };
    if (merged.colors.length) attributes.COLOR_0 = addAccessor(merged.colors, "VEC4", 5126, 34962);
    if (merged.positions.length / 3 > 65535) throw new Error(`${name} has too many vertices for 16-bit indices`);
    const indices = addAccessor(merged.indices, "SCALAR", 5123, 34963);
    json.meshes.push({ name, primitives: [{ attributes, indices, material: addMaterial(name) }] });
    return json.meshes.length - 1;
  }

  const byMaterial = {};
  for (const part of parts) (byMaterial[part.material] ??= []).push(part.mesh);
  for (const [name, meshes] of Object.entries(byMaterial)) {
    json.nodes.push({ name, mesh: addMesh(name, meshes, root.center) });
    json.nodes[0].children.push(json.nodes.length - 1);
  }

  // Each thruster is a fixed node at the nozzle holding a "flame-N" node the game stretches every frame.
  if (thrusters.length) {
    const flameMesh = addMesh("flame", [flame()], [0, 0, 0]);
    thrusters.forEach(([x, y, z, radius], i) => {
      json.nodes.push({ name: `flame-${i + 1}`, mesh: flameMesh });
      const flameNode = json.nodes.length - 1;
      json.nodes.push({
        name: `thruster-${i + 1}`,
        translation: subtract([x, y, z], root.center),
        scale: [radius, 1, radius],
        children: [flameNode],
      });
      json.nodes[0].children.push(json.nodes.length - 1);
    });
  }

  const bin = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  json.buffers.push({ byteLength: bin.length });
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4) jsonText += " ";
  const jsonBytes = Buffer.from(jsonText);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunkHeader = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  writeFileSync(
    path,
    Buffer.concat([header, chunkHeader(jsonBytes.length, 0x4e4f534a), jsonBytes, chunkHeader(bin.length, 0x004e4942), bin]),
  );
  console.log(`${path}: ${Math.round((28 + jsonBytes.length + bin.length) / 1000)} KB`);
}

// ---------- Small vector helpers ----------
function sum(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function normalize(v) {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}
function multiply(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
// Rotation (row-major 3×3) that turns +Y to point along unit vector d.
function rotateYTo(d) {
  const c = d[1]; // cos of the angle between +Y and d
  if (c > 0.9999) return identity();
  if (c < -0.9999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const axis = normalize([d[2], 0, -d[0]]); // +Y × d
  const s = Math.sqrt(1 - c * c);
  const [x, y, z] = axis;
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

mkdirSync("models", { recursive: true });
writeGlb("models/hero.glb", buildHero());
writeGlb("models/drone.glb", buildDrone());
