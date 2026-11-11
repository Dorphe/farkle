/**
 * Imperative 3D dice table (three.js + cannon-es).
 *
 * Framework-agnostic: owns the canvas, scene, physics, resize and disposal.
 * Implements the DiceTable contract from Architecture §6. Local play uses
 * true physics; `show` places dice statically for resume and selection.
 */
import * as THREE from "three";
import * as CANNON from "cannon-es";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const FACE_VALUES = [1, 6, 2, 5, 3, 4]; // +x, -x, +y, -y, +z, -z
const AXES = ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const).map(
  ([x, y, z]) => new THREE.Vector3(x, y, z),
);
const UP = new THREE.Vector3(0, 1, 0);
const ARENA_X = 2.3;
const ARENA_Z = 1.5;
const WALL_H = 4;
const SETTLE_MS = 2200;

export interface DicePalette {
  face: string;
  pip: string;
  selectedFace: string;
  selectedPip: string;
  edge: string;
  shadow: string;
}

export const SOFT_CLAY_PALETTE: DicePalette = {
  face: "#FFFFFF",
  pip: "#2B2220",
  selectedFace: "#D4715B",
  selectedPip: "#FFF8F5",
  edge: "#E4D7CE",
  shadow: "#2B2220",
};

export interface DiceTableOptions {
  palette?: Partial<DicePalette>;
  onSelect?: (index: number) => void;
}

export interface DiceTable {
  /** Physics roll; resolves with the face showing up on each die. */
  roll(n: number): Promise<number[]>;
  /**
   * Cosmetic physics throw with no result. Use when another authority (the
   * room server) owns the values: toss for the motion, then `show` the
   * authoritative faces — the dice ease from wherever they are into place.
   */
  toss(n: number): void;
  /** Place dice at rest on the table (resume, selection changes). */
  show(values: number[], selected?: boolean[]): void;
  setSelection(selected: boolean[]): void;
  setInteractive(on: boolean): void;
  clear(): void;
  dispose(): void;
  readonly active: boolean;
}

interface Ease {
  from: THREE.Vector3;
  fromQ: THREE.Quaternion;
  to: THREE.Vector3;
  toQ: THREE.Quaternion;
  t: number;
  dur: number;
  arc: number;
}

interface Die {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  lift: number;
  liftTarget: number;
  selected: boolean;
  index: number;
  ease: Ease | null;
}

const EASE_DURATION = 0.3;

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

export function createDiceTable(container: HTMLElement, options: DiceTableOptions = {}): DiceTable | null {
  const palette: DicePalette = { ...SOFT_CLAY_PALETTE, ...(options.palette ?? {}) };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // The loop parks once the table is still; without this the browser is
      // free to drop the finished frame and the dice vanish on the next paint.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const canvas = renderer.domElement;
  canvas.className = "dice-canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.16;
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const wall = (x: number, z: number, w: number, d: number) => {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, WALL_H / 2, d / 2)),
    });
    body.position.set(x, WALL_H / 2, z);
    world.addBody(body);
  };
  wall(ARENA_X + 0.25, 0, 0.5, (ARENA_Z + 0.5) * 2);
  wall(-ARENA_X - 0.25, 0, 0.5, (ARENA_Z + 0.5) * 2);
  wall(0, ARENA_Z + 0.25, (ARENA_X + 0.5) * 2, 0.5);
  wall(0, -ARENA_Z - 0.25, (ARENA_X + 0.5) * 2, 0.5);

  scene.add(new THREE.AmbientLight(0xffffff, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.05);
  key.position.set(2.4, 7.6, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 22;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 2;
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ color: new THREE.Color(palette.shadow), opacity: 0.13 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  scene.add(floor);

  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(palette.edge),
    transparent: true,
    opacity: 0.9,
  });

  const matCache = new Map<string, THREE.MeshLambertMaterial>();
  function faceTexture(value: number, selected: boolean): THREE.CanvasTexture {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d");
    if (!g) throw new Error("Canvas 2D unavailable");
    g.fillStyle = selected ? palette.selectedFace : palette.face;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = selected ? "rgba(255,248,245,.30)" : "rgba(43,34,32,.10)";
    g.lineWidth = 9;
    g.strokeRect(4.5, 4.5, S - 9, S - 9);
    g.fillStyle = selected ? palette.selectedPip : palette.pip;
    const on = new Set(PIPS[value] ?? []);
    for (let i = 0; i < 9; i++) {
      if (!on.has(i)) continue;
      const cx = 44 + (i % 3) * 84;
      const cy = 44 + Math.floor(i / 3) * 84;
      g.beginPath();
      g.arc(cx, cy, 21, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function faceMaterials(selected: boolean): THREE.MeshLambertMaterial[] {
    return FACE_VALUES.map((value) => {
      const cacheKey = `${value}${selected ? "s" : "n"}`;
      let material = matCache.get(cacheKey);
      if (!material) {
        material = new THREE.MeshLambertMaterial({ map: faceTexture(value, selected) });
        matCache.set(cacheKey, material);
      }
      return material;
    });
  }

  const dice: Die[] = [];
  let rafId = 0;
  let lastT = 0;
  let idleFrames = 0;
  let rolling = false;
  let settleResolve: ((values: number[]) => void) | null = null;
  let rollStart = 0;
  let stillFrames = 0;
  let currentFaces: number[] = [];
  let interactive = true;
  let disposed = false;

  function makeDie(index: number): Die {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geo, faceMaterials(false));
    mesh.userData.index = index;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.scale.setScalar(1.004);
    mesh.add(edges);
    scene.add(mesh);

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      linearDamping: 0.08,
      angularDamping: 0.32,
      sleepSpeedLimit: 0.16,
      sleepTimeLimit: 0.4,
    });
    world.addBody(body);
    body.sleep();
    return { mesh, body, lift: 0, liftTarget: 0, selected: false, index, ease: null };
  }

  function ensureDice(n: number): void {
    while (dice.length > n) {
      const die = dice.pop();
      if (!die) break;
      scene.remove(die.mesh);
      die.mesh.geometry.dispose();
      for (const child of die.mesh.children) {
        if (child instanceof THREE.LineSegments) child.geometry.dispose();
      }
      world.removeBody(die.body);
    }
    while (dice.length < n) dice.push(makeDie(dice.length));
    dice.forEach((die, index) => {
      die.mesh.userData.index = index;
      die.index = index;
    });
  }

  function quatForValue(value: number, yaw = 0): THREE.Quaternion {
    const axis = AXES[FACE_VALUES.indexOf(value)] ?? UP;
    const q = new THREE.Quaternion().setFromUnitVectors(axis, UP);
    if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    return q;
  }

  function layoutFor(faces: number[]): Array<{ pos: THREE.Vector3; quat: THREE.Quaternion }> {
    const n = faces.length;
    const cols = Math.min(3, n);
    const rows = Math.ceil(n / cols);
    const targets: Array<{ pos: THREE.Vector3; quat: THREE.Quaternion }> = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const x = (c - (inRow - 1) / 2) * 1.32;
      const z = (r - (rows - 1) / 2) * 1.32;
      targets.push({
        pos: new THREE.Vector3(x, 0.5, z),
        quat: quatForValue(faces[i] ?? 1, (Math.random() - 0.5) * 0.5),
      });
    }
    return targets;
  }

  function restAt(die: Die, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    die.ease = null;
    die.body.position.set(pos.x, pos.y, pos.z);
    die.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    die.body.velocity.setZero();
    die.body.angularVelocity.setZero();
    die.body.sleep();
    die.lift = 0;
    die.liftTarget = 0;
    die.mesh.position.copy(pos);
    die.mesh.quaternion.copy(quat);
  }

  function placeStatic(faces: number[]): void {
    const targets = layoutFor(faces);
    for (let i = 0; i < targets.length; i++) {
      const die = dice[i];
      const target = targets[i];
      if (!die || !target) continue;
      restAt(die, target.pos, target.quat);
    }
  }

  /** Glide dice from wherever they are to the authoritative faces. */
  function placeEased(faces: number[]): void {
    const targets = layoutFor(faces);
    for (let i = 0; i < targets.length; i++) {
      const die = dice[i];
      const target = targets[i];
      if (!die || !target) continue;
      const still =
        die.mesh.position.distanceToSquared(target.pos) < 1e-4 &&
        Math.abs(die.mesh.quaternion.dot(target.quat)) > 0.9999;
      if (still) continue;
      die.ease = {
        from: die.mesh.position.clone(),
        fromQ: die.mesh.quaternion.clone(),
        to: target.pos,
        toQ: target.quat,
        t: 0,
        dur: EASE_DURATION,
        arc: 0.08,
      };
      die.lift = 0;
      die.liftTarget = 0;
      die.body.velocity.setZero();
      die.body.angularVelocity.setZero();
      die.body.sleep();
    }
  }

  function snapDie(die: Die): number {
    const q = new THREE.Quaternion(
      die.body.quaternion.x,
      die.body.quaternion.y,
      die.body.quaternion.z,
      die.body.quaternion.w,
    );
    let best = 0;
    let bestY = -2;
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const axis = AXES[i];
      if (!axis) continue;
      v.copy(axis).applyQuaternion(q);
      if (v.y > bestY) {
        bestY = v.y;
        best = i;
      }
    }
    const bestAxis = AXES[best] ?? UP;
    v.copy(bestAxis).applyQuaternion(q);
    const delta = new THREE.Quaternion().setFromUnitVectors(v.normalize(), UP);
    const finalQ = delta.multiply(q).normalize();

    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(finalQ);
    const ang = Math.atan2(fwd.z, fwd.x);
    const quarter = Math.PI / 2;
    const fix = new THREE.Quaternion().setFromAxisAngle(UP, Math.round(ang / quarter) * quarter - ang);
    finalQ.premultiply(fix).normalize();

    const x = Math.max(-(ARENA_X - 0.5), Math.min(ARENA_X - 0.5, die.body.position.x));
    const z = Math.max(-(ARENA_Z - 0.5), Math.min(ARENA_Z - 0.5, die.body.position.z));
    const y = Math.max(0.5, die.body.position.y);

    die.body.position.set(x, y, z);
    die.body.quaternion.set(finalQ.x, finalQ.y, finalQ.z, finalQ.w);
    die.body.velocity.setZero();
    die.body.angularVelocity.setZero();
    die.body.sleep();
    die.mesh.position.set(x, y, z);
    die.mesh.quaternion.copy(finalQ);
    return FACE_VALUES[best] ?? 1;
  }

  function separateDice(): void {
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < dice.length; i++) {
        for (let j = i + 1; j < dice.length; j++) {
          const a = dice[i]?.body.position;
          const b = dice[j]?.body.position;
          if (!a || !b) continue;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let dist = Math.hypot(dx, dz);
          const min = 1.12;
          if (dist > min) continue;
          if (dist < 0.001) {
            dx = Math.random() - 0.5;
            dz = Math.random() - 0.5;
            dist = Math.hypot(dx, dz) || 0.001;
          }
          const push = (min - dist) / 2 + 0.005;
          const ux = (dx / dist) * push;
          const uz = (dz / dist) * push;
          a.x -= ux;
          a.z -= uz;
          b.x += ux;
          b.z += uz;
        }
      }
      for (const die of dice) {
        die.body.position.x = Math.max(-(ARENA_X - 0.5), Math.min(ARENA_X - 0.5, die.body.position.x));
        die.body.position.z = Math.max(-(ARENA_Z - 0.5), Math.min(ARENA_Z - 0.5, die.body.position.z));
      }
    }
    for (const die of dice) {
      die.body.position.y = 0.5;
      die.mesh.position.set(die.body.position.x, 0.5, die.body.position.z);
    }
  }

  /** Throw every die from above with random spin. Result is resolved by settle or `show`. */
  function launch(n: number): void {
    ensureDice(n);
    rolling = true;
    rollStart = performance.now();
    stillFrames = 0;
    currentFaces = [];
    const total = dice.length;
    dice.forEach((die, i) => {
      die.body.wakeUp();
      die.ease = null;
      die.lift = 0;
      die.liftTarget = 0;
      die.selected = false;
      die.mesh.material = faceMaterials(false);
      const cols = Math.min(3, total);
      const row = Math.floor(i / cols);
      const col = i % cols;
      const rows = Math.ceil(total / cols);
      const px = (col - (cols - 1) / 2) * 1.35 + (Math.random() - 0.5) * 0.5;
      const pz = (row - (rows - 1) / 2) * 1.15 + (Math.random() - 0.5) * 0.4;
      die.body.position.set(px, 2.4 + (i % cols) * 0.16 + Math.random() * 0.5, pz);
      die.body.quaternion.setFromEuler(
        Math.random() * 6.283,
        Math.random() * 6.283,
        Math.random() * 6.283,
      );
      die.body.velocity.set(
        (Math.random() - 0.5) * 2.2,
        -3 - Math.random() * 2,
        (Math.random() - 0.5) * 1.6,
      );
      die.body.angularVelocity.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
      );
    });
    idleFrames = 0;
    startLoop();
  }

  function cancelRoll(): void {
    rolling = false;
    settleResolve = null;
  }

  function finishRoll(): void {
    rolling = false;
    const values = dice.map(snapDie);
    separateDice();
    currentFaces = values.slice();
    idleFrames = 0;
    startLoop();
    const resolve = settleResolve;
    settleResolve = null;
    resolve?.(values);
  }

  function checkSettle(now: number): void {
    let still = true;
    for (const die of dice) {
      if (die.body.velocity.lengthSquared() > 0.02 || die.body.angularVelocity.lengthSquared() > 0.3) {
        still = false;
        break;
      }
    }
    stillFrames = still ? stillFrames + 1 : 0;
    if (stillFrames > 5 || now - rollStart > SETTLE_MS) finishRoll();
  }

  function tick(now: number): void {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    world.step(1 / 60, dt, 6);

    for (const die of dice) {
      const ease = die.ease;
      if (ease) {
        ease.t = Math.min(1, ease.t + dt / ease.dur);
        const k = ease.t * ease.t * (3 - 2 * ease.t);
        die.mesh.position.lerpVectors(ease.from, ease.to, k);
        die.mesh.position.y += Math.sin(k * Math.PI) * ease.arc;
        die.mesh.quaternion.slerpQuaternions(ease.fromQ, ease.toQ, k);
        die.body.position.set(die.mesh.position.x, die.mesh.position.y, die.mesh.position.z);
        die.body.quaternion.set(
          die.mesh.quaternion.x,
          die.mesh.quaternion.y,
          die.mesh.quaternion.z,
          die.mesh.quaternion.w,
        );
        if (ease.t >= 1) restAt(die, ease.to, ease.toQ);
        continue;
      }
      die.mesh.position.set(die.body.position.x, die.body.position.y + die.lift, die.body.position.z);
      const q = die.body.quaternion;
      die.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (Math.abs(die.lift - die.liftTarget) > 0.001) {
        die.lift += (die.liftTarget - die.lift) * Math.min(1, dt * 12);
      }
    }

    if (rolling) checkSettle(now);
    renderer.render(scene, camera);

    idleFrames++;
    if (!rolling && !dice.some((die) => die.ease) && idleFrames > 45) stopLoop();
  }

  function startLoop(): void {
    if (rafId) return;
    idleFrames = 0;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function applySelection(selected: boolean[]): void {
    for (let i = 0; i < dice.length; i++) {
      const on = !!selected[i];
      const die = dice[i];
      if (!die || die.selected === on) continue;
      die.selected = on;
      die.mesh.material = faceMaterials(on);
      die.liftTarget = on ? 0.28 : 0;
    }
  }

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const needW = 6.5;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const distW = needW / 2 / Math.tan(hfov / 2);
    const distH = 1.7 / Math.tan(vfov / 2);
    const dist = Math.max(distW, 4.4, distH);
    const tilt = 0.96;
    camera.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist);
    camera.lookAt(0, 0.15, 0);
    camera.updateProjectionMatrix();
    if (!rafId) renderer.render(scene, camera);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(event: MouseEvent): void {
    if (!dice.length || rolling || !interactive) return;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(dice.map((die) => die.mesh), false);
    const hit = hits[0];
    if (!hit) return;
    const index = hit.object.userData.index;
    if (typeof index === "number") options.onSelect?.(index);
  }

  canvas.addEventListener("click", pick);
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(container);
  const onWindowResize = () => resize();
  window.addEventListener("resize", onWindowResize);
  const onOrientation = () => window.setTimeout(resize, 250);
  window.addEventListener("orientationchange", onOrientation);

  resize();

  return {
    get active() {
      return !disposed;
    },
    roll(n: number): Promise<number[]> {
      if (disposed) return Promise.reject(new Error("Dice table disposed"));
      launch(n);
      return new Promise<number[]>((resolve) => {
        settleResolve = resolve;
      });
    },
    toss(n: number): void {
      if (disposed) return;
      launch(n);
    },
    show(values: number[], selected: boolean[] = []): void {
      if (disposed) return;
      const same =
        values.length === currentFaces.length &&
        values.every((value, i) => value === currentFaces[i]) &&
        dice.length === values.length;
      cancelRoll();
      if (!same) {
        const countChanged = dice.length !== values.length;
        ensureDice(values.length);
        if (countChanged) placeStatic(values);
        else placeEased(values);
        currentFaces = values.slice();
        resize();
      }
      applySelection(selected);
      startLoop();
      idleFrames = 0;
    },
    setSelection(selected: boolean[]): void {
      applySelection(selected);
      startLoop();
    },
    setInteractive(on: boolean): void {
      interactive = on;
    },
    clear(): void {
      if (disposed) return;
      if (!rolling && !dice.length && !currentFaces.length) return;
      cancelRoll();
      ensureDice(0);
      currentFaces = [];
      stopLoop();
      renderer.clear();
    },
    dispose(): void {
      disposed = true;
      rolling = false;
      settleResolve = null;
      stopLoop();
      canvas.removeEventListener("click", pick);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("orientationchange", onOrientation);
      resizeObserver?.disconnect();
      ensureDice(0);
      for (const material of matCache.values()) {
        material.map?.dispose();
        material.dispose();
      }
      edgeMat.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
