import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { clamp, ease } from '../core/dom';

/** Where the exoskeleton goes, in stage (CSS) pixels. */
export interface ExoPlacement {
  /** Wrist on the forearm's axis. */
  x: number;
  y: number;
  /** Unit vector wrist to elbow. */
  ux: number;
  uy: number;
  length: number;
  /** Full width of the forearm at a fraction of its length from the wrist. */
  widthAt: (f: number) => number;
}

const CYAN = new THREE.Color('#3FE0FF');
const ICE = new THREE.Color('#C8F7FF');
const WHITE = new THREE.Color('#FFFFFF');

/** Stations along the forearm (fractions of its visible length): a ring at each, a plate between neighbours. */
const STATIONS = [0.04, 0.17, 0.3, 0.43, 0.56, 0.69, 0.82, 0.95];
/** The view is tilted this much about the arm's cross axis, so rings read as ellipses: depth without a 3D pose. */
const TILT = 0.34;
/** Assembly clock (seconds): when the scan ring starts its sweep and how long it takes. */
const SCAN_AT = 1.3;
const SCAN_FOR = 1.05;
/** The whole assembly is done (scan finished) at this clock value. */
const ASSEMBLED = SCAN_AT + SCAN_FOR;
/** Disassembly runs the assembly clock backwards this much faster. */
const OUT_SPEED = 2.4;

interface Tint {
  material: LineMaterial | THREE.MeshBasicMaterial;
  base: number;
}

interface Part {
  /** Positioned and scaled every frame. */
  holder: THREE.Object3D;
  /** Animated (offset, spin, scale) inside the holder. */
  body: THREE.Object3D;
  kind: 'ring' | 'plate' | 'strut' | 'joint';
  /** Station index (ring, joint) or the station it starts from (plate, strut). */
  at: number;
  start: number;
  duration: number;
  from: { x: number; y: number; z: number; spin: number; scale: number };
  tints: Tint[];
  /** Lines that trace themselves on (dashed, revealed by length). */
  traced: Array<{ material: LineMaterial; length: number }>;
}

/**
 * The holographic exoskeleton, drawn with three.js into its own canvas and composited over the picture as
 * light (CSS `mix-blend-mode: screen` on a black canvas, so bloom can spread freely without fighting alpha).
 *
 * Everything is built once in a forearm-local frame (x along the arm, a unit circle across it) and mapped onto
 * the tracked forearm every frame: rings at stations along the arm, segmented plates between them, side
 * trusses, a lattice on the plates, glowing joints at the wrist and the elbow, and a scan ring. An assembly
 * clock runs forward while the arm is there and backward (faster) when it leaves, and every part's flight is a
 * function of that clock, so parts arrive in a staggered snap and leave in reverse order, gracefully, and an
 * arm that comes back mid-exit simply reassembles from wherever it was.
 */
export class ExoLayer {
  readonly canvas: HTMLCanvasElement;
  /** Seconds on the assembly clock (0 = nothing, ASSEMBLED = fully built). */
  clock = 0;
  /** False if WebGL could not start: Arm mode then runs without the exoskeleton. */
  ok = true;
  /** Frames actually rendered in the last second (debug). */
  rendered = 0;

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 6000);
  private arm = new THREE.Group();
  private tilt = new THREE.Group();
  private parts: Part[] = [];
  private lineMaterials: LineMaterial[] = [];
  private scan: { holder: THREE.Object3D; tints: Tint[] } | null = null;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private cleared = true;
  private forward = true;
  private scanShown = false;
  private renderCount = 0;
  /** Overall brightness (dimmed while the arm is out of sight but not yet given up on). */
  private strength = 1;
  private renderCountAt = 0;

  constructor(parent: HTMLElement, before: Element | null) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'arm-gl';
    parent.insertBefore(this.canvas, before);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setClearColor(0x000000, 1);
      const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.72, 0.42, 0.08);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch (err) {
      this.ok = false;
      this.canvas.style.display = 'none';
      console.warn('[arm] WebGL is unavailable; the exoskeleton is off:', err);
      return;
    }
    this.camera.position.z = 3000;
    this.scene.add(this.arm);
    this.arm.add(this.tilt);
    this.tilt.rotation.y = TILT;
    this.tilt.scale.x = 1 / Math.cos(TILT);
    this.build();
  }

  /** Nothing on screen and no animation running. */
  get idle(): boolean {
    return this.clock <= 0;
  }

  get assembled(): boolean {
    return this.clock >= ASSEMBLED;
  }

  /** Back to nothing at once (reset). */
  snapOff(): void {
    this.clock = 0;
    this.scanShown = false;
  }

  resize(cssWidth: number, cssHeight: number): void {
    if (!this.renderer || !this.composer) return;
    // Capped at 1.5: thin lines stay crisp, and bloom on a 5K Retina canvas does not cost the frame rate.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cssWidth === this.width && cssHeight === this.height && ratio === this.ratio) return;
    this.width = cssWidth;
    this.height = cssHeight;
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(cssWidth, cssHeight);
    this.bloom?.resolution.set(cssWidth, cssHeight);
    // Orthographic camera in stage pixels, y up (stage y is negated when placing).
    this.camera.left = 0;
    this.camera.right = cssWidth;
    this.camera.top = 0;
    this.camera.bottom = -cssHeight;
    this.camera.updateProjectionMatrix();
    for (const material of this.lineMaterials) material.resolution.set(cssWidth, cssHeight);
  }

  /**
   * Advance and draw. `present`: the arm is there (assemble) or not (disassemble). `place`: where the
   * forearm is on the stage right now (the last known place while leaving). `visible`: false hides everything
   * at once (H, reset blackout, idle screen).
   */
  update(t: number, dt: number, present: boolean, place: ExoPlacement | null, visible: boolean, strength = 1): void {
    if (!this.renderer || !this.composer) return;
    this.strength = strength;
    const before = this.clock;
    // Stops just past fully built (the breathing ramps in over that last 0.6 s), so leaving starts at once.
    if (present && place) this.clock = Math.min(ASSEMBLED + 0.6, this.clock + dt);
    else this.clock = Math.max(0, this.clock - dt * OUT_SPEED);
    if (this.clock > before) this.forward = true;
    else if (this.clock < before) this.forward = false;
    if (this.clock <= 0) this.scanShown = false;

    if (!visible || !place || this.clock <= 0) {
      if (!this.cleared) {
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        this.cleared = true;
      }
      return;
    }
    this.cleared = false;
    this.place(place);
    this.animate(t, place);
    this.composer.render(dt);
    this.renderCount++;
    if (t - this.renderCountAt >= 1) {
      this.rendered = this.renderCount;
      this.renderCount = 0;
      this.renderCountAt = t;
    }
  }

  // ----- Building -----

  private lineMaterial(color: THREE.Color, width: number, base: number, dashed = false): LineMaterial {
    const material = new LineMaterial({
      color: color.getHex(),
      linewidth: width,
      transparent: true,
      opacity: base,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      dashed,
      dashScale: 1,
      dashSize: 1,
      gapSize: 1e4,
    });
    material.resolution.set(Math.max(1, this.width), Math.max(1, this.height));
    this.lineMaterials.push(material);
    return material;
  }

  private polyline(points: number[], material: LineMaterial): Line2 {
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    return line;
  }

  private segments(points: number[], material: LineMaterial): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(points);
    const line = new LineSegments2(geometry, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    return line;
  }

  /** Points on the unit cylinder around x: angle 0 is across the arm, pi/2 faces the viewer. */
  private surface(x: number, angle: number, radius = 1): [number, number, number] {
    return [x, Math.cos(angle) * radius, Math.sin(angle) * radius];
  }

  private arc(x: number, a0: number, a1: number, steps: number, radius = 1): number[] {
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) out.push(...this.surface(x, a0 + ((a1 - a0) * i) / steps, radius));
    return out;
  }

  /** Length of a polyline given as flat xyz. */
  private length(points: number[]): number {
    let total = 0;
    for (let i = 3; i < points.length; i += 3) {
      total += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
    }
    return total;
  }

  private addPart(kind: Part['kind'], at: number, start: number, duration: number, from: Part['from'], parent: THREE.Object3D): Part {
    const holder = new THREE.Group();
    const body = new THREE.Group();
    holder.add(body);
    parent.add(holder);
    const part: Part = { holder, body, kind, at, start, duration, from, tints: [], traced: [] };
    this.parts.push(part);
    return part;
  }

  private build(): void {
    const s = STATIONS.length;
    // Rings: contract onto the arm one after another, wrist first.
    STATIONS.forEach((_, i) => {
      const part = this.addPart('ring', i, 0.05 + i * 0.075, 0.55, { x: 0, y: 0, z: 0, spin: 0.9, scale: 2.3 }, this.tilt);
      const major = i === 0 || i === s - 1;
      const front = this.lineMaterial(major ? ICE : CYAN, major ? 2.4 : 1.7, major ? 0.9 : 0.62);
      const back = this.lineMaterial(CYAN, 1.1, 0.2);
      part.body.add(this.polyline(this.arc(0, -0.02, Math.PI + 0.02, 40), front));
      part.body.add(this.polyline(this.arc(0, Math.PI, Math.PI * 2, 40), back));
      part.tints.push({ material: front, base: front.opacity }, { material: back, base: back.opacity });
      if (major) {
        // A double cuff at the wrist and the far end.
        const second = this.lineMaterial(CYAN, 1.3, 0.55);
        const offset = i === 0 ? 0.018 : -0.018;
        part.body.add(this.polyline(this.arc(offset, 0, Math.PI, 40, 1.04), second));
        part.tints.push({ material: second, base: second.opacity });
      }
    });

    // Plates: segmented armour over the top of the forearm, flying in from above with a twist.
    const a0 = 0.62, a1 = Math.PI - 0.62; // about 36 to 144 degrees: the face of the arm toward the viewer
    for (let i = 0; i < s - 1; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const part = this.addPart('plate', i, 0.28 + i * 0.085, 0.5, { x: 0, y: 0.5 * side, z: 2.2, spin: -0.7 * side, scale: 1.25 }, this.tilt);
      const g = 0.06; // gap at each end of the plate (fraction of the plate's length)
      const c = 0.12; // chamfer along the arm
      const ca = 0.16; // chamfer around the arm (radians)
      const r = 1.03;
      const outline = [
        ...this.surface(g + c, a0, r),
        ...this.arc(g, a0 + ca, a1 - ca, 14, r),
        ...this.surface(g + c, a1, r),
        ...this.surface(1 - g - c, a1, r),
        ...this.arc(1 - g, a1 - ca, a0 + ca, 14, r),
        ...this.surface(1 - g - c, a0, r),
        ...this.surface(g + c, a0, r),
      ];
      const edge = this.lineMaterial(CYAN, 1.8, 0.85);
      part.body.add(this.polyline(outline, edge));
      // A spine down the middle of each plate.
      const spine = this.lineMaterial(ICE, 1.1, 0.45);
      part.body.add(this.polyline([...this.surface(g + c, Math.PI / 2, r), ...this.surface(1 - g - c, Math.PI / 2, r)], spine));
      // Lattice: a diamond net on the plate, faint, traced on after the plate locks.
      const lattice: number[] = [];
      const cells = 3;
      for (let k = 0; k < cells; k++) {
        const xa = g + c + ((1 - 2 * (g + c)) * k) / cells;
        const xb = g + c + ((1 - 2 * (g + c)) * (k + 1)) / cells;
        for (const [p, q] of [[a0 + 0.1, a1 - 0.1], [a1 - 0.1, a0 + 0.1]] as const) {
          for (let j = 0; j < 6; j++) {
            const u0 = j / 6, u1 = (j + 1) / 6;
            lattice.push(...this.surface(xa + (xb - xa) * u0, p + (q - p) * u0, r), ...this.surface(xa + (xb - xa) * u1, p + (q - p) * u1, r));
          }
        }
      }
      const net = this.lineMaterial(CYAN, 1.0, 0.32, true);
      part.body.add(this.segments(lattice, net));
      part.traced.push({ material: net, length: this.length(lattice) });
      // A faint glassy fill, brighter toward its edges.
      const fill = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      part.body.add(this.platePatch(g, 1 - g, a0, a1, r, fill));
      part.tints.push({ material: edge, base: edge.opacity }, { material: spine, base: spine.opacity }, { material: net, base: net.opacity }, { material: fill, base: fill.opacity });
    }

    // Side trusses: thin struts along both edges of the arm, traced on.
    for (let i = 0; i < s - 1; i++) {
      const part = this.addPart('strut', i, 0.62 + i * 0.06, 0.45, { x: 0, y: 0, z: 0, spin: 0, scale: 1 }, this.tilt);
      for (const [rail, peak] of [[0.1, 0.44], [Math.PI - 0.1, Math.PI - 0.44]]) {
        const points = [
          ...this.surface(0, rail, 1.07), ...this.surface(0.5, peak, 1.05), ...this.surface(1, rail, 1.07),
        ];
        const strut = this.lineMaterial(CYAN, 1.3, 0.6, true);
        part.body.add(this.polyline(points, strut));
        const railLine = [...this.surface(0, rail, 1.07), ...this.surface(1, rail, 1.07)];
        const railMaterial = this.lineMaterial(CYAN, 1.0, 0.4, true);
        part.body.add(this.polyline(railLine, railMaterial));
        part.tints.push({ material: strut, base: strut.opacity }, { material: railMaterial, base: railMaterial.opacity });
        part.traced.push({ material: strut, length: this.length(points) }, { material: railMaterial, length: 1 });
      }
    }

    // Joints: glowing hubs at the wrist and the far end, facing the viewer (not tilted).
    for (const [index, start] of [[0, 0], [s - 1, 0.95]] as const) {
      const part = this.addPart('joint', index, start, 0.6, { x: 0, y: 0, z: 0, spin: 1.6, scale: 0.05 }, this.arm);
      const core = new THREE.MeshBasicMaterial({
        map: glowTexture(), color: ICE, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      });
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), core);
      part.body.add(disc);
      const inner = this.lineMaterial(WHITE, 2.0, 0.9);
      part.body.add(this.polyline(circle(0.32, 48), inner));
      const outer = this.lineMaterial(CYAN, 1.5, 0.75);
      // An outer ring broken into four arcs, which turns slowly.
      const arcs: number[] = [];
      for (let q = 0; q < 4; q++) {
        const from = (q * Math.PI) / 2 + 0.18, to = ((q + 1) * Math.PI) / 2 - 0.18;
        for (let k = 0; k < 10; k++) {
          const u0 = from + ((to - from) * k) / 10, u1 = from + ((to - from) * (k + 1)) / 10;
          arcs.push(Math.cos(u0) * 0.5, Math.sin(u0) * 0.5, 0, Math.cos(u1) * 0.5, Math.sin(u1) * 0.5, 0);
        }
      }
      const spinner = this.segments(arcs, outer);
      spinner.name = 'spinner';
      part.body.add(spinner);
      part.tints.push({ material: core, base: core.opacity }, { material: inner, base: inner.opacity }, { material: outer, base: outer.opacity });
    }

    // The scan ring: one sweep from wrist to elbow once everything has locked.
    const holder = new THREE.Group();
    this.tilt.add(holder);
    const ringMaterial = this.lineMaterial(WHITE, 3.0, 1);
    const ringBack = this.lineMaterial(ICE, 1.6, 0.45);
    holder.add(this.polyline(this.arc(0, -0.05, Math.PI + 0.05, 48), ringMaterial));
    holder.add(this.polyline(this.arc(0, Math.PI, Math.PI * 2, 48), ringBack));
    const slice = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), slice);
    disc.rotation.y = Math.PI / 2; // lies across the arm
    holder.add(disc);
    holder.visible = false;
    this.scan = { holder, tints: [{ material: ringMaterial, base: 1 }, { material: ringBack, base: 0.45 }, { material: slice, base: 0.16 }] };
  }

  /** A curved patch of the cylinder, vertex-coloured brighter toward its rim. */
  private platePatch(x0: number, x1: number, a0: number, a1: number, r: number, material: THREE.MeshBasicMaterial): THREE.Mesh {
    const nx = 6, na = 12;
    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= na; j++) {
        const u = i / nx, v = j / na;
        positions.push(...this.surface(x0 + (x1 - x0) * u, a0 + (a1 - a0) * v, r));
        const rim = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2; // 0 centre, 1 edge
        const k = 0.25 + 0.75 * rim ** 3;
        colors.push(CYAN.r * k, CYAN.g * k, CYAN.b * k);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < na; j++) {
        const p = i * (na + 1) + j;
        index.push(p, p + na + 1, p + 1, p + 1, p + na + 1, p + na + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  // ----- Every frame -----

  private place(p: ExoPlacement): void {
    this.arm.position.set(p.x, -p.y, 0);
    this.arm.rotation.z = -Math.atan2(p.uy, p.ux);
    // The tilt pushes what faces the viewer toward the elbow; pull it back so the wrist cuff sits on the wrist.
    const wristR = p.widthAt(0) / 2;
    this.tilt.position.x = -wristR * Math.sin(TILT) * 0.5;
    const L = p.length;
    for (const part of this.parts) {
      const f = part.kind === 'ring' || part.kind === 'joint' ? (part.kind === 'joint' ? (part.at === 0 ? 0 : 1) : STATIONS[part.at]) : STATIONS[part.at];
      if (part.kind === 'ring') {
        const r = (p.widthAt(f) / 2) * 1.1;
        part.holder.position.set(f * L, 0, 0);
        part.holder.scale.set(1, r, r);
      } else if (part.kind === 'plate' || part.kind === 'strut') {
        const f1 = STATIONS[part.at + 1];
        const r = ((p.widthAt(f) + p.widthAt(f1)) / 4) * (part.kind === 'plate' ? 1.0 : 1.0);
        part.holder.position.set(f * L, 0, 0);
        part.holder.scale.set((f1 - f) * L, r, r);
      } else {
        const w = p.widthAt(f === 0 ? 0 : 0.96);
        const size = w * (f === 0 ? 0.62 : 0.56);
        part.holder.position.set(f === 0 ? 0 : 0.96 * L, 0, 0);
        part.holder.scale.set(size, size, size);
      }
    }
  }

  private animate(t: number, p: ExoPlacement): void {
    const clock = this.clock;
    // Settled: a slow breath on everything.
    const settled = clamp((clock - ASSEMBLED) / 0.6, 0, 1);
    const breath = 1 - settled * 0.16 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.4));

    for (const part of this.parts) {
      const raw = clamp((clock - part.start) / part.duration, 0, 1);
      // Arrive with a snap (slight overshoot); leave the same way in reverse, which reads as a lift-off.
      const travel = 1 - ease.outBack(raw);
      const shown = ease.outCubic(clamp(raw * 1.6, 0, 1));
      // The instant a part locks it flares, then settles.
      const flare = raw > 0.75 && raw < 1 ? Math.sin(((raw - 0.75) / 0.25) * Math.PI) * 0.9 : 0;
      const body = part.body;
      const f = part.from;
      body.position.set(f.x * travel, f.y * travel, f.z * travel);
      body.rotation.x = f.spin * travel;
      const s = 1 + (f.scale - 1) * travel;
      if (part.kind === 'ring') body.scale.set(1, s, s);
      else if (part.kind === 'joint') {
        body.scale.setScalar(Math.max(0.001, 1 + (f.scale - 1) * (1 - ease.outBack(raw))));
        body.rotation.x = 0;
        body.rotation.z = f.spin * travel;
        const spinner = body.getObjectByName('spinner');
        if (spinner) spinner.rotation.z = t * 0.6 * (part.at === 0 ? 1 : -1);
      } else body.scale.setScalar(s);
      for (const tint of part.tints) tint.material.opacity = tint.base * shown * breath * (1 + flare) * this.strength;
      for (const line of part.traced) {
        const trace = ease.inOutCubic(clamp((clock - part.start - part.duration * 0.6) / 0.5, 0, 1));
        line.material.dashSize = Math.max(1e-4, trace * line.length * 1.02);
        line.material.gapSize = trace >= 1 ? 0 : line.length * 4;
      }
      // Joints pulse gently once settled.
      if (part.kind === 'joint') {
        const pulse = 1 + settled * 0.12 * Math.sin(t * 2.4 + part.at);
        body.scale.multiplyScalar(pulse);
      }
    }

    // The scan ring: one sweep along the arm, only on the way in.
    if (this.scan) {
      const sp = (clock - SCAN_AT) / SCAN_FOR;
      const sweeping = this.forward && sp > 0 && sp < 1;
      if (sweeping) this.scanShown = true;
      const holder = this.scan.holder;
      holder.visible = sweeping;
      if (sweeping) {
        const f = ease.inOutCubic(sp);
        const r = (p.widthAt(f) / 2) * 1.22;
        holder.position.set(f * p.length, 0, 0);
        holder.scale.set(1, r, r);
        const fade = Math.sin(sp * Math.PI);
        for (const tint of this.scan.tints) tint.material.opacity = tint.base * (0.35 + 0.65 * fade);
      }
    }
  }
}

function circle(radius: number, steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  }
  return out;
}

let glow: THREE.Texture | null = null;

/** A soft radial glow, made once. */
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(220,250,255,0.85)');
  g.addColorStop(0.42, 'rgba(63,224,255,0.25)');
  g.addColorStop(1, 'rgba(63,224,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}
