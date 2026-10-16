import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import { api, type City, type MapIncident, type Station } from "./api";
import { t } from "./i18n";
import { useLang } from "./lang";
import { aqiTone, PageHead } from "./uiBits";
import "./map.css";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OFFLINE_ZOOM = 12;
const NEAR_PX = 40;

type Place = (el: HTMLElement, lng: number, lat: number, popup?: string, offset?: [number, number]) => void;

type LegendCounts = {
  live: number;
  offline: number;
  fire: number;
  incident: number;
  uncovered: number;
  offlineHidden: number;
};

const EMPTY_COUNTS: LegendCounts = { live: 0, offline: 0, fire: 0, incident: 0, uncovered: 0, offlineHidden: 0 };

type MapPayload = {
  stations: Station[];
  wards: Array<{
    covered: boolean;
    centroid?: { lat: number; lng: number } | null;
    h3?: string;
    incident?: MapIncident | null;
  }>;
  fires: Array<{ lat: number; lng: number; h3?: string }>;
  incidents: MapIncident[];
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[ch] ?? ch;
  });
}

function isOffline(station: Station): boolean {
  if (station.online === false) return true;
  return station.aqi == null || Number.isNaN(station.aqi);
}

function ringOffset(index: number, count: number): [number, number] {
  if (count < 2) return [0, 0];
  const radius = count > 4 ? 8 * count : 24;
  const theta = (2 * Math.PI * index) / count;
  return [radius * Math.sin(theta), -radius * Math.cos(theta)];
}

function liveOffsets(map: maplibregl.Map, stations: Station[]): Map<Station, [number, number]> {
  const live = stations.filter((station) => !isOffline(station));
  const points = live.map((station) => map.project([station.lng, station.lat]));
  const parent = live.map((_, index) => index);
  const find = (index: number) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.hypot(dx, dy) > NEAR_PX) continue;
      const left = find(i);
      const right = find(j);
      if (left !== right) parent[right] = left;
    }
  }
  const groups = new Map<number, number[]>();
  live.forEach((_, index) => {
    const root = find(index);
    const members = groups.get(root);
    if (members) members.push(index);
    else groups.set(root, [index]);
  });
  const offsets = new Map<Station, [number, number]>();
  for (const members of groups.values()) {
    members.forEach((stationIndex, ringIndex) => {
      offsets.set(live[stationIndex], ringOffset(ringIndex, members.length));
    });
  }
  return offsets;
}

function incidentPoint(station: Station): MapIncident | null {
  if (station.incident?.h3) return station.incident;
  if (station.h3 && (station.incidentId || station.incident)) {
    return { h3: station.h3, id: station.incidentId, status: station.incident?.status };
  }
  return null;
}

function placeIncident(
  place: Place,
  incident: MapIncident,
  lng: number,
  lat: number,
  lang: string,
  navigate: (path: string) => void,
  seen: Set<string>,
) {
  if (!incident.h3 || seen.has(incident.h3)) return;
  seen.add(incident.h3);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pin hex";
  el.textContent = incident.status ? incident.status : incident.h3.slice(0, 6);
  el.title = `${t(lang, "incident")} ${incident.h3}`;
  const h3 = incident.h3;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    navigate(`/zones/${h3}`);
  });
  place(
    el,
    lng,
    lat,
    `<strong>${esc(t(lang, "incident"))}</strong><br/>${esc(incident.status ?? "")} <a href="/zones/${esc(h3)}">${esc(h3.slice(0, 10))}</a>`,
  );
}

export function MapPage({ cityId, cities }: { cityId: string; cities: City[] }) {
  const lang = useLang();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const navigate = useNavigate();
  const [pitched, setPitched] = useState(false);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [counts, setCounts] = useState<LegendCounts>(EMPTY_COUNTS);
  const city = cities.find((c) => c.id === cityId);

  useEffect(() => {
    if (!mapRef.current || !city) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: MAP_STYLE,
      center: [city.center.lng, city.center.lat],
      zoom: 10,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapObj.current = map;
    let alive = true;
    map.on("load", () => {
      if (alive) setMapEpoch((n) => n + 1);
    });
    return () => {
      alive = false;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.remove();
      mapObj.current = null;
    };
  }, [city]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || mapEpoch === 0) return;
    map.easeTo({ pitch: pitched ? 60 : 0, zoom: pitched ? 15 : 10, duration: 700 });
  }, [pitched, mapEpoch]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || mapEpoch === 0) return;
    let cancelled = false;
    let payload: MapPayload | null = null;

    const place: Place = (el, lng, lat, popup, offset) => {
      const marker = new maplibregl.Marker({ element: el, offset: offset ?? [0, 0] }).setLngLat([lng, lat]);
      if (popup) marker.setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popup));
      marker.addTo(map);
      markers.current.push(marker);
    };

    const draw = (data: MapPayload) => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      const hideOffline = map.getZoom() < OFFLINE_ZOOM;
      const seen = new Set<string>();
      const offsets = liveOffsets(map, data.stations);
      let liveCount = 0;
      let offlineCount = 0;
      let uncoveredCount = 0;

      for (const s of data.stations) {
        if (cancelled) return;
        const offline = isOffline(s);
        if (offline) offlineCount += 1;
        else liveCount += 1;
        if (!(offline && hideOffline)) {
          const el = document.createElement("button");
          el.type = "button";
          if (offline) {
            const label = t(lang, "offline");
            el.className = "pin station is-offline";
            el.textContent = label;
            el.setAttribute("aria-label", `${s.name} ${label}`);
          } else {
            const rounded = Math.round(s.aqi ?? 0);
            el.className = `pin station tone-${aqiTone(rounded)}`;
            el.textContent = String(rounded);
            el.setAttribute("aria-label", `${s.name} ${rounded}`);
          }
          const zone = s.h3
            ? `<br/><a href="/zones/${esc(s.h3)}">${esc(t(lang, "zoneLink"))} ${esc(s.h3.slice(0, 8))}</a>`
            : "";
          const aqiText = offline ? esc(t(lang, "offline")) : String(Math.round(s.aqi ?? 0));
          const popup = `<strong>${esc(s.name)}</strong><br/>AQI ${aqiText}${zone}`;
          place(el, s.lng, s.lat, popup, offline ? undefined : offsets.get(s));
        }
        const incident = incidentPoint(s);
        if (incident) placeIncident(place, incident, s.lng, s.lat, lang, navigate, seen);
      }

      for (const f of data.fires) {
        const el = document.createElement("div");
        el.className = "pin fire";
        el.title = t(lang, "fire");
        const zone = f.h3 ? `<a href="/zones/${esc(f.h3)}">${esc(t(lang, "hex"))}</a>` : esc(t(lang, "fire"));
        place(el, f.lng, f.lat, zone);
      }

      for (const w of data.wards) {
        if (!w.covered && w.centroid) {
          uncoveredCount += 1;
          const el = document.createElement("div");
          el.className = "pin uncovered";
          el.textContent = t(lang, "uncoveredWard");
          place(el, w.centroid.lng, w.centroid.lat);
        }
      }

      for (const incident of data.incidents) {
        if (incident.lat == null || incident.lng == null || !incident.h3) continue;
        placeIncident(place, incident, incident.lng, incident.lat, lang, navigate, seen);
      }

      for (const w of data.wards) {
        if (!w.incident?.h3 || !w.centroid) continue;
        placeIncident(
          place,
          { h3: w.incident.h3, status: w.incident.status, id: w.incident.id },
          w.centroid.lng,
          w.centroid.lat,
          lang,
          navigate,
          seen,
        );
      }

      setCounts({
        live: liveCount,
        offline: offlineCount,
        fire: data.fires.length,
        incident: seen.size,
        uncovered: uncoveredCount,
        offlineHidden: hideOffline ? offlineCount : 0,
      });
    };

    const onZoomEnd = () => {
      if (cancelled || !payload) return;
      draw(payload);
    };

    map.on("zoomend", onZoomEnd);

    (async () => {
      const [stationRes, wardRes, fireRes] = await Promise.all([
        api.stations(cityId),
        api.wards(cityId),
        api.fires(cityId),
      ]);
      if (cancelled) return;
      payload = {
        stations: stationRes.stations,
        wards: wardRes.wards,
        fires: fireRes.fires,
        incidents: [...(stationRes.incidents ?? []), ...(fireRes.incidents ?? [])],
      };
      draw(payload);
    })().catch(console.error);

    return () => {
      cancelled = true;
      map.off("zoomend", onZoomEnd);
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      setCounts(EMPTY_COUNTS);
    };
  }, [cityId, mapEpoch, lang, navigate]);

  return (
    <div className="stack">
      <PageHead kicker={city?.name ?? ""} title={t(lang, "map")}>
        <button type="button" onClick={() => setPitched((v) => !v)}>
          {pitched ? t(lang, "flat") : t(lang, "buildings")}
        </button>
      </PageHead>
      <div className="map-frame">
        <div id="map" ref={mapRef} />
      </div>
      {counts.live + counts.offline + counts.fire + counts.incident + counts.uncovered + counts.offlineHidden > 0 ? (
        <ul className="map-legend" aria-label={t(lang, "legendTitle")}>
          {counts.live > 0 ? (
            <li>
              <span className="swatch swatch-live" aria-hidden="true" />
              {t(lang, "legendLive")}
            </li>
          ) : null}
          {counts.offline > 0 ? (
            <li>
              <span className="swatch swatch-offline" aria-hidden="true" />
              {t(lang, "legendOffline")}
            </li>
          ) : null}
          {counts.fire > 0 ? (
            <li>
              <span className="swatch swatch-fire" aria-hidden="true" />
              {t(lang, "legendFire")}
            </li>
          ) : null}
          {counts.incident > 0 ? (
            <li>
              <span className="swatch swatch-incident" aria-hidden="true" />
              {t(lang, "legendIncident")}
            </li>
          ) : null}
          {counts.uncovered > 0 ? (
            <li>
              <span className="swatch swatch-uncovered" aria-hidden="true" />
              {t(lang, "legendUncovered")}
            </li>
          ) : null}
          {counts.offlineHidden > 0 ? (
            <li className="legend-note">{t(lang, "offlineHidden", { n: counts.offlineHidden })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
