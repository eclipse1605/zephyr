import type { Map as MapLibreMap } from "maplibre-gl";

export type WindCell = { lat: number; lng: number; u: number; v: number };
export type WindGrid = { cells: WindCell[] };

export type WindHandle = {
  setEnabled: (on: boolean) => void;
  destroy: () => void;
};

/** Geographic wind field, bilinear with wrap-around in longitude. */
type Field = {
  lats: number[];
  lngs: number[];
  u: Float32Array;
  v: Float32Array;
};

/**
 * Screen-space flow grid. Rebuilt after each pan/zoom settles, so the per-frame loop
 * never touches map.project/unproject: particles only read vx/vy from this grid.
 * vx/vy = unit screen direction * wind speed (m/s). ok = node is on the globe/map.
 */
type Flow = {
  cell: number;
  cols: number;
  rows: number;
  vx: Float32Array;
  vy: Float32Array;
  ok: Uint8Array;
};

type Particle = { x: number; y: number; px: number; py: number; age: number; life: number };

const MAX_SPEED_MS = 28;
const MIN_SPEED_MS = 3.4;
const FLOW_CELL = 14;
const OPACITY = 0.95;

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function buildField(grid: WindGrid): Field | null {
  if (!grid.cells.length) return null;
  const lats = [...new Set(grid.cells.map((cell) => cell.lat))].sort((a, b) => a - b);
  const baseLngs = [...new Set(grid.cells.map((cell) => wrapLng(cell.lng)))].sort((a, b) => a - b);
  if (lats.length < 2 || baseLngs.length < 2) return null;
  // Extra wrap column so interpolation across the antimeridian is seamless.
  const lngs = [...baseLngs, baseLngs[0] + 360];
  const u = new Float32Array(lats.length * lngs.length);
  const v = new Float32Array(lats.length * lngs.length);
  const index = new Map(grid.cells.map((cell) => [`${cell.lat},${wrapLng(cell.lng)}`, cell]));
  for (let row = 0; row < lats.length; row++) {
    for (let col = 0; col < lngs.length; col++) {
      const cell = index.get(`${lats[row]},${wrapLng(lngs[col])}`);
      const i = row * lngs.length + col;
      u[i] = cell?.u ?? 0;
      v[i] = cell?.v ?? 0;
    }
  }
  return { lats, lngs, u, v };
}

function bracket(values: number[], value: number): [number, number, number] {
  const last = values.length - 1;
  if (value <= values[0]) return [0, 0, 0];
  if (value >= values[last]) return [last, last, 0];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= value) lo = mid;
    else hi = mid;
  }
  return [lo, hi, (value - values[lo]) / (values[hi] - values[lo] || 1)];
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function sampleField(field: Field, lat: number, lng: number, out: { u: number; v: number }) {
  let x = wrapLng(lng);
  if (x < field.lngs[0]) x += 360;
  const [r0, r1, ty0] = bracket(field.lats, lat);
  const [c0, c1, tx0] = bracket(field.lngs, x);
  const tx = smooth(tx0);
  const ty = smooth(ty0);
  const cols = field.lngs.length;
  const a = r0 * cols + c0;
  const b = r0 * cols + c1;
  const c = r1 * cols + c0;
  const d = r1 * cols + c1;
  const u0 = field.u[a] * (1 - tx) + field.u[b] * tx;
  const u1 = field.u[c] * (1 - tx) + field.u[d] * tx;
  const v0 = field.v[a] * (1 - tx) + field.v[b] * tx;
  const v1 = field.v[c] * (1 - tx) + field.v[d] * tx;
  out.u = u0 * (1 - ty) + u1 * ty;
  out.v = v0 * (1 - ty) + v1 * ty;
}

/**
 * Pixels advanced per frame (at 60fps) per m/s of wind. Grows gently with zoom so streaks
 * stay readable and calm on the globe without crawling when zoomed in on a city.
 */
function pixelsPerMs(zoom: number): number {
  return Math.min(0.12, 0.09 * Math.pow(2, 0.28 * (zoom - 2)));
}

/** Frames a streak stays visible. Longer streaks on the globe, snappier up close. */
function fadePerFrame(zoom: number): number {
  return Math.max(0.03, Math.min(0.045, 0.032 + 0.003 * (zoom - 2)));
}

export function attachWind(map: MapLibreMap, grid: WindGrid): WindHandle {
  const canvas = document.createElement("canvas");
  canvas.className = "wind-field";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "1";
  canvas.style.opacity = "0";
  map.getCanvasContainer().appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  const field = buildField(grid);

  let flow: Flow | null = null;
  let parts: Particle[] = [];
  let enabled = true;
  let moving = false;
  let frame = 0;
  let last = 0;
  let cssW = 1;
  let cssH = 1;
  const tmp = { u: 0, v: 0 };

  const targetCount = () => {
    const density = map.getZoom() > 7 ? 0.6 : 1;
    return Math.max(450, Math.min(4200, Math.round(((cssW * cssH) / 380) * density)));
  };

  function buildFlow() {
    if (!field) {
      flow = null;
      return;
    }
    const cell = FLOW_CELL;
    const cols = Math.ceil(cssW / cell) + 2;
    const rows = Math.ceil(cssH / cell) + 2;
    const next: Flow = {
      cell,
      cols,
      rows,
      vx: new Float32Array(cols * rows),
      vy: new Float32Array(cols * rows),
      ok: new Uint8Array(cols * rows),
    };
    const PROBE_M = 20_000;
    const swirl = Math.max(0, Math.min(1, (map.getZoom() - 4) / 4)) * 0.5;
    const center = map.getCenter();
    const phase1 = center.lng * 0.9;
    const phase2 = center.lat * 1.3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const i = r * cols + c;
        let geo;
        try {
          geo = map.unproject([x, y]);
        } catch {
          continue;
        }
        if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || Math.abs(geo.lat) > 84) continue;
        const back = map.project(geo);
        // Off-globe pixels unproject to the horizon; the round-trip gives them away.
        if (Math.abs(back.x - x) > 1.5 || Math.abs(back.y - y) > 1.5) continue;
        sampleField(field, geo.lat, geo.lng, tmp);
        let speed = Math.hypot(tmp.u, tmp.v);
        if (speed > MAX_SPEED_MS) {
          tmp.u *= MAX_SPEED_MS / speed;
          tmp.v *= MAX_SPEED_MS / speed;
          speed = MAX_SPEED_MS;
        }
        const mLat = 111_320;
        const mLng = Math.max(2_000, mLat * Math.cos((geo.lat * Math.PI) / 180));
        const dir = speed > 1e-6 ? 1 / speed : 0;
        const probe = map.project([
          wrapLng(geo.lng + (tmp.u * dir * PROBE_M) / mLng),
          Math.max(-85, Math.min(85, geo.lat + (tmp.v * dir * PROBE_M) / mLat)),
        ]);
        let dx = probe.x - x;
        let dy = probe.y - y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          // Probe collapsed (e.g. exactly at a pole): no direction, stay calm.
          continue;
        }
        dx /= len;
        dy /= len;
        if (swirl > 0) {
          // Zoomed in, the 10° source grid is locally uniform. A slow, coherent swirl keeps the
          // streamlines organic (as in IQAir Earth) without changing the overall direction.
          const n =
            Math.sin(x * 0.011 + Math.sin(y * 0.007) * 2 + phase1) *
            Math.cos(y * 0.013 + Math.sin(x * 0.009) * 2 + phase2);
          const a = n * swirl;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rx = dx * ca - dy * sa;
          dy = dx * sa + dy * ca;
          dx = rx;
        }
        const shown = Math.max(speed, MIN_SPEED_MS);
        next.vx[i] = dx * shown;
        next.vy[i] = dy * shown;
        next.ok[i] = 1;
      }
    }
    flow = next;
  }

  /** Bilinear sample of the flow grid. Returns false if the point is off the map. */
  function sampleFlow(x: number, y: number, out: { u: number; v: number }): boolean {
    const f = flow;
    if (!f) return false;
    const fx = x / f.cell;
    const fy = y / f.cell;
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    if (c < 0 || r < 0 || c >= f.cols - 1 || r >= f.rows - 1) return false;
    const tx = fx - c;
    const ty = fy - r;
    const i00 = r * f.cols + c;
    const i10 = i00 + 1;
    const i01 = i00 + f.cols;
    const i11 = i01 + 1;
    if (!f.ok[i00] || !f.ok[i10] || !f.ok[i01] || !f.ok[i11]) return false;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    out.u = f.vx[i00] * w00 + f.vx[i10] * w10 + f.vx[i01] * w01 + f.vx[i11] * w11;
    out.v = f.vy[i00] * w00 + f.vy[i10] * w10 + f.vy[i01] * w01 + f.vy[i11] * w11;
    return true;
  }

  function place(part: Particle, spread: boolean) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = Math.random() * cssW;
      const y = Math.random() * cssH;
      if (sampleFlow(x, y, tmp)) {
        part.x = part.px = x;
        part.y = part.py = y;
        part.life = 55 + Math.random() * 90;
        part.age = spread ? Math.random() * part.life : 0;
        return;
      }
    }
    // No valid spot found (e.g. mostly off-globe); park it until the next respawn.
    part.x = part.px = -100;
    part.y = part.py = -100;
    part.age = 0;
    part.life = 4;
  }

  function reseed() {
    const want = targetCount();
    while (parts.length < want) parts.push({ x: 0, y: 0, px: 0, py: 0, age: 0, life: 1 });
    parts.length = want;
    for (const part of parts) place(part, true);
  }

  function clearCanvas() {
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  const hideForMove = () => {
    moving = true;
    clearCanvas();
    canvas.style.opacity = "0";
  };

  const showAfterMove = () => {
    buildFlow();
    reseed();
    clearCanvas();
    moving = false;
    if (enabled) canvas.style.opacity = String(OPACITY);
  };

  const resize = () => {
    const mapCanvas = map.getCanvas();
    cssW = mapCanvas.clientWidth || Math.floor(mapCanvas.width / (window.devicePixelRatio || 1));
    cssH = mapCanvas.clientHeight || Math.floor(mapCanvas.height / (window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(cssW));
    canvas.height = Math.max(1, Math.floor(cssH));
    if (!moving) showAfterMove();
  };

  map.on("movestart", hideForMove);
  map.on("zoomstart", hideForMove);
  map.on("moveend", showAfterMove);
  map.on("zoomend", showAfterMove);
  map.on("resize", resize);
  const observer = new ResizeObserver(resize);
  observer.observe(map.getContainer());
  resize();

  const step = (now: number) => {
    frame = requestAnimationFrame(step);
    if (!ctx || !enabled || moving || !flow) {
      last = now;
      return;
    }
    const dt = Math.min(2.5, Math.max(0.4, (now - (last || now)) / 16.667));
    last = now;
    const zoom = map.getZoom();
    const scale = pixelsPerMs(zoom) * dt;

    // Fade what is already on the canvas: this is what makes the trails.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.3, fadePerFrame(zoom) * dt)})`;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineWidth = zoom < 5 ? 1 : 1.25;

    // Bucket by speed so each bucket is one stroke.
    const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const dim = zoom > 8 ? 0.65 : 1;
    const alphas = [0.42, 0.56, 0.72, 0.9].map((a) => a * dim);
    for (const part of parts) {
      part.px = part.x;
      part.py = part.y;
      if (!sampleFlow(part.x, part.y, tmp)) {
        place(part, false);
        continue;
      }
      const speed = Math.hypot(tmp.u, tmp.v);
      part.x += tmp.u * scale;
      part.y += tmp.v * scale;
      part.age += dt;
      if (part.age > part.life) {
        place(part, false);
        continue;
      }
      const bucket = speed < 4 ? 0 : speed < 8 ? 1 : speed < 14 ? 2 : 3;
      buckets[bucket].moveTo(part.px, part.py);
      buckets[bucket].lineTo(part.x, part.y);
    }
    for (let b = 0; b < buckets.length; b++) {
      ctx.strokeStyle = `rgba(236, 244, 255, ${alphas[b]})`;
      ctx.stroke(buckets[b]);
    }
  };

  frame = requestAnimationFrame(step);

  return {
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) {
        canvas.style.opacity = "0";
        clearCanvas();
      } else if (!moving) {
        clearCanvas();
        canvas.style.opacity = String(OPACITY);
      }
    },
    destroy() {
      cancelAnimationFrame(frame);
      map.off("movestart", hideForMove);
      map.off("zoomstart", hideForMove);
      map.off("moveend", showAfterMove);
      map.off("zoomend", showAfterMove);
      map.off("resize", resize);
      observer.disconnect();
      canvas.remove();
    },
  };
}
