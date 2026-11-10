import type { Map as MapLibreMap } from "maplibre-gl";

export type WindCell = { lat: number; lng: number; u: number; v: number };
export type WindGrid = { cells: WindCell[] };

export type WindHandle = {
  setEnabled: (on: boolean) => void;
  destroy: () => void;
};

type Field = {
  lats: number[];
  lngs: number[];
  u: Float64Array;
  v: Float64Array;
};

type Particle = {
  lng: number;
  lat: number;
  age: number;
  life: number;
  trailX: Float64Array;
  trailY: Float64Array;
  trailLen: number;
  trailAt: number;
};

const MAX_SPEED_MS = 22;
const STEP_SCALE = 95;
const TRAIL = 6;
const COUNT = 96;
/** Draw at half CSS resolution — particles read fine and cost much less. */
const PIXEL_SCALE = 0.5;

function wrapLng(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

function buildField(grid: WindGrid): Field | null {
  if (!grid.cells.length) return null;
  const lats = [...new Set(grid.cells.map((cell) => cell.lat))].sort((a, b) => a - b);
  const lngs = [...new Set(grid.cells.map((cell) => cell.lng))].sort((a, b) => a - b);
  if (lats.length < 2 || lngs.length < 2) return null;
  const u = new Float64Array(lats.length * lngs.length);
  const v = new Float64Array(lats.length * lngs.length);
  const index = new Map(grid.cells.map((cell) => [`${cell.lat},${cell.lng}`, cell]));
  for (let row = 0; row < lats.length; row++) {
    for (let col = 0; col < lngs.length; col++) {
      const cell = index.get(`${lats[row]},${lngs[col]}`);
      const i = row * lngs.length + col;
      u[i] = cell?.u ?? 0;
      v[i] = cell?.v ?? 0;
    }
  }
  return { lats, lngs, u, v };
}

function bracket(values: number[], value: number): [number, number, number] {
  if (value <= values[0]) return [0, 0, 0];
  if (value >= values[values.length - 1]) return [values.length - 1, values.length - 1, 0];
  let hi = 1;
  while (hi < values.length && values[hi] < value) hi += 1;
  const lo = hi - 1;
  const span = values[hi] - values[lo] || 1;
  return [lo, hi, (value - values[lo]) / span];
}

function sampleField(field: Field, lat: number, lng: number): { u: number; v: number } {
  const wrapped = wrapLng(lng);
  const [lat0, lat1, ty] = bracket(field.lats, lat);
  const [lng0, lng1, tx] = bracket(field.lngs, wrapped);
  const cols = field.lngs.length;
  const i00 = lat0 * cols + lng0;
  const i01 = lat0 * cols + lng1;
  const i10 = lat1 * cols + lng0;
  const i11 = lat1 * cols + lng1;
  const u0 = field.u[i00] * (1 - tx) + field.u[i01] * tx;
  const u1 = field.u[i10] * (1 - tx) + field.u[i11] * tx;
  const v0 = field.v[i00] * (1 - tx) + field.v[i01] * tx;
  const v1 = field.v[i10] * (1 - tx) + field.v[i11] * tx;
  return { u: u0 * (1 - ty) + u1 * ty, v: v0 * (1 - ty) + v1 * ty };
}

function nearestCell(grid: WindGrid, lat: number, lng: number): { u: number; v: number } {
  const wrapped = wrapLng(lng);
  let best = grid.cells[0];
  let bestD = Infinity;
  for (const cell of grid.cells) {
    const dLat = cell.lat - lat;
    let dLng = cell.lng - wrapped;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      best = cell;
      bestD = d;
    }
  }
  return { u: best?.u ?? 0, v: best?.v ?? 0 };
}

function sampleWind(field: Field | null, grid: WindGrid, lat: number, lng: number): { u: number; v: number } {
  return field ? sampleField(field, lat, lng) : nearestCell(grid, lat, lng);
}

function clampWind(u: number, v: number): { u: number; v: number; speed: number } {
  const speed = Math.hypot(u, v);
  if (speed <= MAX_SPEED_MS || speed === 0) return { u, v, speed };
  const scale = MAX_SPEED_MS / speed;
  return { u: u * scale, v: v * scale, speed: MAX_SPEED_MS };
}

function spawnInView(map: MapLibreMap): { lng: number; lat: number } {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const lat = south + Math.random() * Math.max(0.01, north - south);
  let lng: number;
  if (east >= west) {
    lng = west + Math.random() * Math.max(0.01, east - west);
  } else {
    const span = 360 - west + east;
    lng = wrapLng(west + Math.random() * span);
  }
  return { lng, lat: Math.max(-75, Math.min(75, lat)) };
}

function makeParticle(map: MapLibreMap): Particle {
  const at = spawnInView(map);
  return {
    ...at,
    age: Math.random() * 40,
    life: 50 + Math.random() * 40,
    trailX: new Float64Array(TRAIL),
    trailY: new Float64Array(TRAIL),
    trailLen: 0,
    trailAt: 0,
  };
}

function clearTrail(part: Particle) {
  part.trailLen = 0;
  part.trailAt = 0;
}

function pushTrail(part: Particle, x: number, y: number) {
  part.trailX[part.trailAt] = x;
  part.trailY[part.trailAt] = y;
  part.trailAt = (part.trailAt + 1) % TRAIL;
  if (part.trailLen < TRAIL) part.trailLen += 1;
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
  const parent = map.getCanvasContainer();
  parent.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  const field = buildField(grid);

  const parts: Particle[] = Array.from({ length: COUNT }, () => makeParticle(map));

  let enabled = true;
  let moving = false;
  let frame = 0;
  let cssW = 1;
  let cssH = 1;

  const hideForMove = () => {
    moving = true;
    canvas.style.opacity = "0";
  };
  const showAfterMove = () => {
    moving = false;
    if (!enabled) return;
    for (const part of parts) {
      const point = map.project([part.lng, part.lat]);
      if (point.x < -40 || point.y < -40 || point.x > cssW + 40 || point.y > cssH + 40) {
        respawn(part);
      } else {
        clearTrail(part);
      }
    }
    canvas.style.opacity = "0.9";
  };

  const resize = () => {
    const mapCanvas = map.getCanvas();
    cssW = mapCanvas.clientWidth || Math.floor(mapCanvas.width / (window.devicePixelRatio || 1));
    cssH = mapCanvas.clientHeight || Math.floor(mapCanvas.height / (window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(cssW * PIXEL_SCALE));
    canvas.height = Math.max(1, Math.floor(cssH * PIXEL_SCALE));
    if (ctx) {
      ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
    }
  };

  const respawn = (part: Particle) => {
    const at = spawnInView(map);
    part.lng = at.lng;
    part.lat = at.lat;
    part.age = 0;
    part.life = 50 + Math.random() * 45;
    clearTrail(part);
  };

  map.on("movestart", hideForMove);
  map.on("zoomstart", hideForMove);
  map.on("moveend", showAfterMove);
  map.on("zoomend", showAfterMove);
  resize();
  canvas.style.opacity = "0.9";
  const observer = new ResizeObserver(resize);
  observer.observe(map.getContainer());
  map.on("resize", resize);

  const step = () => {
    frame = requestAnimationFrame(step);
    if (!ctx || !enabled || moving) return;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const raw = sampleWind(field, grid, part.lat, part.lng);
      const wind = clampWind(raw.u, raw.v);
      const mLat = 111_320;
      const mLng = Math.max(1_000, mLat * Math.cos((part.lat * Math.PI) / 180));
      part.lat += (wind.v / mLat) * STEP_SCALE;
      part.lng = wrapLng(part.lng + (wind.u / mLng) * STEP_SCALE);
      part.age += 1;

      const point = map.project([part.lng, part.lat]);
      if (
        part.age > part.life ||
        part.lat > 78 ||
        part.lat < -78 ||
        point.x < -60 ||
        point.y < -60 ||
        point.x > cssW + 60 ||
        point.y > cssH + 60
      ) {
        respawn(part);
        continue;
      }

      pushTrail(part, point.x, point.y);
      if (part.trailLen < 2) continue;

      const fade = 1 - part.age / part.life;
      const alpha = Math.max(0.14, Math.min(0.55, 0.16 + wind.speed / 32)) * fade;
      ctx.strokeStyle = `rgba(210, 230, 255, ${alpha})`;
      ctx.lineWidth = 1.1 + Math.min(1.1, wind.speed / 24);
      ctx.beginPath();
      const start = (part.trailAt - part.trailLen + TRAIL) % TRAIL;
      ctx.moveTo(part.trailX[start], part.trailY[start]);
      for (let t = 1; t < part.trailLen; t++) {
        const idx = (start + t) % TRAIL;
        ctx.lineTo(part.trailX[idx], part.trailY[idx]);
      }
      ctx.stroke();
    }
  };

  frame = requestAnimationFrame(step);

  return {
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) {
        canvas.style.opacity = "0";
        if (ctx) ctx.clearRect(0, 0, cssW, cssH);
      } else if (!moving) {
        canvas.style.opacity = "0.9";
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
