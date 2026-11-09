import type { Map as MapLibreMap } from "maplibre-gl";

export type WindCell = { lat: number; lng: number; u: number; v: number };
export type WindGrid = { cells: WindCell[] };

function nearest(grid: WindGrid, lat: number, lng: number): WindCell | undefined {
  let best: WindCell | undefined;
  let bestD = Infinity;
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
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
  return best;
}

export function attachWind(map: MapLibreMap, grid: WindGrid): () => void {
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
  const ctx = canvas.getContext("2d");
  const count = 280;
  const parts = Array.from({ length: count }, () => ({
    lat: Math.random() * 140 - 70,
    lng: Math.random() * 360 - 180,
  }));
  let moving = false;
  let frame = 0;
  const hide = () => {
    moving = true;
    canvas.style.visibility = "hidden";
  };
  const show = () => {
    moving = false;
    canvas.style.visibility = "visible";
  };
  map.on("movestart", hide);
  map.on("moveend", show);
  const resize = () => {
    const mapCanvas = map.getCanvas();
    const width = mapCanvas.clientWidth || Math.floor(mapCanvas.width / (window.devicePixelRatio || 1));
    const height = mapCanvas.clientHeight || Math.floor(mapCanvas.height / (window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(map.getContainer());
  map.on("resize", resize);
  const step = () => {
    frame = requestAnimationFrame(step);
    if (!ctx || moving) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(236, 244, 255, 0.75)";
    ctx.lineWidth = 1.2;
    for (const part of parts) {
      const wind = nearest(grid, part.lat, part.lng);
      const from = map.project([part.lng, part.lat]);
      const mLat = 111_320;
      const mLng = Math.max(1_000, mLat * Math.cos((part.lat * Math.PI) / 180));
      part.lat += ((wind?.v ?? 0) / mLat) * 800;
      part.lng += ((wind?.u ?? 0) / mLng) * 800;
      if (part.lat > 80 || part.lat < -80) part.lat = Math.random() * 140 - 70;
      if (part.lng > 180) part.lng -= 360;
      if (part.lng < -180) part.lng += 360;
      const to = map.project([part.lng, part.lat]);
      if (from.x < -20 || from.y < -20 || from.x > canvas.width + 20 || from.y > canvas.height + 20) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    map.off("movestart", hide);
    map.off("moveend", show);
    map.off("resize", resize);
    observer.disconnect();
    canvas.remove();
  };
}
