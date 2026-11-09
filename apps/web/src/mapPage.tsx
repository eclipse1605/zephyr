import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cellToLatLng, latLngToCell } from "h3-js";
import type * as MapLibre from "maplibre-gl";
import { api, type City, type MapIncident, type Station } from "./api";
import { t } from "./i18n";
import { useLang } from "./lang";
import { MAP_DARK, retryLabel } from "./mapStyle";
import { enumText, sourceLabel } from "./flows";
import { aqiTone, PageHead } from "./uiBits";
import { attachWind } from "./windField";
import "./map.css";
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
    name?: string;
    covered: boolean;
    centroid?: { lat: number; lng: number } | null;
    h3?: string;
    incident?: MapIncident | null;
  }>;
  fires: Array<{ lat: number; lng: number; h3?: string }>;
  incidents: MapIncident[];
  surfaces: Array<{ h3: string; publishedAqi: number | null }>;
};

const LAYER_NAME: Record<"stations" | "wards" | "fires", Record<string, string>> = {
  stations: { en: "Stations", hi: "स्टेशन", mr: "स्टेशन", bn: "স্টেশন", ta: "நிலையங்கள்", kn: "ಕೇಂದ್ರಗಳು", te: "స్టేషన్లు", zh: "站点", ru: "Станции", ar: "محطات", id: "Stasiun", pt: "Estações" },
  wards: { en: "Wards", hi: "वार्ड", mr: "प्रभाग", bn: "ওয়ার্ড", ta: "வார்டு", kn: "ವಾರ್ಡ್", te: "వార్డులు", zh: "街区", ru: "Районы", ar: "أحياء", id: "Wilayah", pt: "Bairros" },
  fires: { en: "Fires", hi: "आग", mr: "आग", bn: "আগুন", ta: "தீ", kn: "ಬೆಂಕಿ", te: "మంటలు", zh: "火点", ru: "Пожары", ar: "حرائق", id: "Kebakaran", pt: "Incêndios" },
};

const PARTIAL_NOTE: Record<string, string> = {
  en: "Some layers didn’t load",
  hi: "कुछ परतें लोड नहीं हुईं",
  mr: "काही स्तर लोड झाले नाहीत",
  bn: "কিছু স্তর লোড হয়নি",
  ta: "சில அடுக்குகள் ஏறவில்லை",
  kn: "ಕೆಲವು ಪದರಗಳು ಲೋಡ್ ಆಗಲಿಲ್ಲ",
  te: "కొన్ని పొరలు లోడ్ కాలేదు",
  zh: "部分图层未能加载",
  ru: "Часть слоёв не загрузилась",
  ar: "بعض الطبقات لم تُحمَّل",
  id: "Sebagian lapisan gagal dimuat",
  pt: "Algumas camadas não carregaram",
};

const SOURCE_LINE = "The color field is an Open-Meteo / CAMS model, not the city number. Stations: OpenAQ and CPCB are stored. WAQI is shown live and is not stored.";

function layerName(lang: string, id: "stations" | "wards" | "fires"): string {
  return LAYER_NAME[id][lang] ?? LAYER_NAME[id].en;
}

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

const STALE_LIVE: Record<string, string> = {
  en: "Station AQI, not confirmed current",
  hi: "स्टेशन AQI, ताज़ा पुष्टि नहीं",
  mr: "स्टेशन AQI, ताजेपणा निश्चित नाही",
  bn: "স্টেশন AQI, সাম্প্রতিক নয়",
  ta: "நிலைய AQI, தற்போதையது உறுதி இல்லை",
  kn: "ಕೇಂದ್ರ AQI, ಪ್ರಸ್ತುತ ಎಂದು ದೃಢವಿಲ್ಲ",
  te: "స్టేషన్ AQI, ప్రస్తుతం అని నిర్ధారణ లేదు",
  zh: "站点 AQI，未确认为实时",
  ru: "AQI станций, актуальность не подтверждена",
  ar: "مؤشر المحطات، الحداثة غير مؤكدة",
  id: "AQI stasiun, belum dipastikan terkini",
  pt: "AQI das estações, atualidade não confirmada",
};

function staleLive(lang: string): string {
  return STALE_LIVE[lang] ?? STALE_LIVE.en;
}

function readingIsOld(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  return Date.now() - at > 3 * 60 * 60 * 1000;
}

function ringOffset(index: number, count: number): [number, number] {
  if (count < 2) return [0, 0];
  const radius = count > 4 ? 8 * count : 24;
  const theta = (2 * Math.PI * index) / count;
  return [radius * Math.sin(theta), -radius * Math.cos(theta)];
}

function liveOffsets(map: MapLibre.Map, stations: Station[]): Map<Station, [number, number]> {
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
  const status = incident.status ? enumText(lang, incident.status) : t(lang, "incident");
  el.textContent = status;
  el.title = status;
  el.setAttribute("aria-label", `${t(lang, "incident")}: ${status}`);
  const h3 = incident.h3;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    navigate(`/zones/${h3}`);
  });
  place(
    el,
    lng,
    lat,
    `<strong>${esc(t(lang, "incident"))}</strong><br/>${esc(incident.status ? enumText(lang, incident.status) : "")} <a href="/zones/${esc(h3)}">${esc(t(lang, "zoneLink"))}</a>`,
  );
}

export function MapPage({ cityId, cities }: { cityId: string; cities: City[] }) {
  const lang = useLang();
  const mapRef = useRef<HTMLDivElement>(null);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const mapObj = useRef<MapLibre.Map | null>(null);
  const markers = useRef<MapLibre.Marker[]>([]);
  const navigate = useNavigate();
  const [pitched, setPitched] = useState(false);
  const [windOn, setWindOn] = useState(true);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [counts, setCounts] = useState<LegendCounts>(EMPTY_COUNTS);
  const [mapNote, setMapNote] = useState<"loading" | "error" | null>("loading");
  const [mapMissing, setMapMissing] = useState<Array<"stations" | "wards" | "fires">>([]);
  const [readingsStale, setReadingsStale] = useState(false);
  const [raster, setRaster] = useState<"aqi" | "pm25">("aqi");
  const rasterRef = useRef(raster);
  rasterRef.current = raster;
  const city = cities.find((c) => c.id === cityId);

  useEffect(() => {
    let stop = false;
    Promise.all([api.health(), api.summary(cityId)]).then(([health, summary]) => {
      if (stop) return;
      setReadingsStale(Boolean(health.ingest?.lastError) || readingIsOld(summary.computedAt));
    }).catch(() => {
      if (!stop) setReadingsStale(true);
    });
    return () => {
      stop = true;
    };
  }, [cityId]);

  useEffect(() => {
    if (!mapRef.current || !city) return;
    const container = mapRef.current;
    const start = city.center;
    let alive = true;
    let map: MapLibre.Map | null = null;
    let bootTimer = 0;
    void import("maplibre-gl").then((maplibregl) => {
      if (!alive) return;
      ml.current = maplibregl;
      map = new maplibregl.Map({
        container,
        style: MAP_DARK,
        center: [start.lng, start.lat],
        zoom: 1.5,
      });
      mapObj.current = map;
      const modelMap = map;
      // Epoch opens wind/pins as soon as the map exists; raster waits for style.
      setMapEpoch((n) => Math.max(1, n + 1));
      map.on("click", (event) => {
        const target = event.originalEvent.target;
        if (target instanceof Element && target.closest(".maplibregl-marker")) return;
        void fetch(`/api/v1/model/point?lat=${event.lngLat.lat}&lng=${event.lngLat.lng}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((point: { aqi?: number | null; pm25?: number | null; pm10?: number | null; no2?: number | null; ozone?: number | null; so2?: number | null; co?: number | null; attribution?: string; note?: string } | null) => {
            if (!point || !alive) return;
            const line = (label: string, value: number | null | undefined, unit = "µg/m³") =>
              value == null ? "" : `<br/>${label} ${Math.round(value)} ${unit}`;
            new maplibregl.Popup({ offset: 12 })
              .setLngLat(event.lngLat)
              .setHTML(`<strong>Model</strong><br/>US AQI ${point.aqi ?? "—"}${line("PM2.5", point.pm25)}${line("PM10", point.pm10)}${line("NO2", point.no2)}${line("Ozone", point.ozone)}${line("SO2", point.so2)}${line("CO", point.co)}<br/>${point.attribution ?? "Open-Meteo / CAMS"}<br/>${point.note ?? ""}`)
              .addTo(modelMap);
          })
          .catch(() => undefined);
      });
      const addRaster = () => {
        if (!alive) return;
        try {
          const layer = rasterRef.current;
          if (!modelMap.getSource("model-raster")) {
            modelMap.addSource("model-raster", {
              type: "raster",
              tiles: [`/api/v1/model/tiles/${layer}/{z}/{x}/{y}`],
              tileSize: 256,
              maxzoom: 8,
              attribution: "Open-Meteo / CAMS",
            });
            modelMap.addLayer({ id: "model-raster", type: "raster", source: "model-raster", paint: { "raster-opacity": 0.72 } });
          }
        } catch {
          return;
        }
      };
      map.on("style.load", () => {
        try {
          (modelMap as MapLibre.Map & { setProjection?: (projection: { type: "globe" }) => void }).setProjection?.({ type: "globe" });
        } catch {
          // flat map is fine if globe projection is unavailable
        }
        // Projection can rebuild the style; add the raster on the next task.
        window.setTimeout(addRaster, 0);
      });
      map.on("load", addRaster);
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      bootTimer = window.setTimeout(addRaster, 1200);
    });
    return () => {
      alive = false;
      window.clearTimeout(bootTimer);
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map?.remove();
      mapObj.current = null;
      setMapEpoch(0);
    };
    // Keep one MapLibre instance; city changes fly the camera instead of remounting.
  }, [city ? "ready" : "wait"]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !city || mapEpoch === 0) return;
    map.easeTo({ center: [city.center.lng, city.center.lat], zoom: 9.5, duration: 900, essential: true });
  }, [cityId, city?.center.lat, city?.center.lng, mapEpoch]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !windOn || mapEpoch === 0) return;
    let cancel = () => {};
    let stopped = false;
    const start = (grid: { cells?: Array<{ lat: number; lng: number; u: number; v: number }> } | null) => {
      if (stopped || !grid?.cells?.length) return;
      cancel();
      cancel = attachWind(map, { cells: grid.cells });
    };
    void fetch("/api/v1/model/wind")
      .then((res) => (res.ok ? res.json() : null))
      .then(start)
      .catch(() => undefined);
    return () => {
      stopped = true;
      cancel();
    };
  }, [windOn, mapEpoch, cityId]);

  useEffect(() => {
    const map = mapObj.current;
    const source = map?.getSource("model-raster") as { setTiles?: (tiles: string[]) => void } | undefined;
    source?.setTiles?.([`/api/v1/model/tiles/${raster}/{z}/{x}/{y}`]);
  }, [raster, mapEpoch]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    map.easeTo({ pitch: pitched ? 60 : 0, zoom: pitched ? 15 : map.getZoom(), duration: 700 });
  }, [pitched]);

  useEffect(() => {
    const map = mapObj.current;
    const maplibregl = ml.current;
    if (!map || !maplibregl || mapEpoch === 0) return;
    let cancelled = false;
    let payload: MapPayload | null = null;
    setMapNote("loading");

    const place: Place = (el, lng, lat, popup, offset) => {
      const marker = new maplibregl.Marker({ element: el, offset: offset ?? [0, 0] }).setLngLat([lng, lat]);
      if (popup) {
        const popupObj = new maplibregl.Popup({ offset: 12 }).setHTML(popup);
        popupObj.on("open", () => {
          popupObj.getElement()?.querySelectorAll<HTMLAnchorElement>("a[href^='/zones/']").forEach((link) => {
            link.addEventListener("click", (event) => {
              event.preventDefault();
              const href = link.getAttribute("href");
              if (href) navigate(href);
            });
          });
        });
        marker.setPopup(popupObj);
      }
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
            el.setAttribute("aria-label", readingsStale ? `${s.name} ${label}. ${staleLive(lang)}` : `${s.name} ${label}`);
          } else {
            const rounded = Math.round(s.aqi ?? 0);
            el.className = readingsStale ? "pin station is-stale" : `pin station tone-${aqiTone(rounded)}`;
            el.textContent = String(rounded);
            el.setAttribute("aria-label", readingsStale ? `${s.name} ${rounded}. ${staleLive(lang)}` : `${s.name} ${rounded}`);
          }
          const cell = s.h3 || latLngToCell(s.lat, s.lng, 8);
          const zone = `<br/><a href="/zones/${esc(cell)}">${esc(t(lang, "zoneLink"))}</a>`;
          const aqiText = offline ? esc(t(lang, "offline")) : String(Math.round(s.aqi ?? 0));
          const staleLine = readingsStale ? `<br/>${esc(staleLive(lang))}` : "";
          const sourceLine = s.sourceFeed ? `<br/>${esc(sourceLabel(lang, s.sourceFeed))}` : "";
          const popup = `<strong>${esc(s.name)}</strong><br/>${esc(t(lang, "aqi"))} ${aqiText}${sourceLine}${staleLine}${zone}`;
          place(el, s.lng, s.lat, popup, offline ? undefined : offsets.get(s));
        }
        const incident = incidentPoint(s);
        if (incident) placeIncident(place, incident, s.lng, s.lat, lang, navigate, seen);
      }

      for (const cell of data.surfaces) {
        if (cell.publishedAqi == null) continue;
        let center: [number, number];
        try {
          center = cellToLatLng(cell.h3);
        } catch {
          continue;
        }
        const el = document.createElement("button");
        el.type = "button";
        el.className = `pin hex tone-${aqiTone(cell.publishedAqi)}`;
        el.textContent = String(Math.round(cell.publishedAqi));
        place(el, center[1], center[0], `<a href="/zones/${esc(cell.h3)}">${esc(t(lang, "zoneLink"))}</a>`);
      }

      for (const f of data.fires) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pin fire";
        el.setAttribute("aria-label", t(lang, "fire"));
        const cell = f.h3 || latLngToCell(f.lat, f.lng, 8);
        const zone = `<a href="/zones/${esc(cell)}">${esc(t(lang, "zoneLink"))}</a>`;
        place(el, f.lng, f.lat, zone);
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

    const refreshStations = () => {
      if (cancelled || !payload) return;
      const next = map.getBounds();
      const sw = next.getSouthWest();
      const ne = next.getNorthEast();
      void api.stationsInBounds({ west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat }).then((value) => {
        if (cancelled || !payload) return;
        payload.stations = value.stations;
        payload.surfaces = value.surfaces ?? [];
        draw(payload);
      }).catch(() => undefined);
    };

    const onZoomEnd = () => {
      if (cancelled || !payload) return;
      refreshStations();
    };

    map.on("zoomend", onZoomEnd);
    map.on("moveend", refreshStations);

    payload = { stations: [], wards: [], fires: [], surfaces: [], incidents: [] };
    const missing: Array<"stations" | "wards" | "fires"> = [];
    let pending = 3;
    const finishOne = () => {
      pending -= 1;
      if (cancelled || !payload) return;
      draw(payload);
      if (pending > 0) {
        setMapNote("loading");
        return;
      }
      setMapMissing(missing);
      setMapNote(missing.length > 0 ? "error" : null);
    };

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    void api.stationsInBounds({ west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat }).then((value) => {
      if (cancelled || !payload) return;
      payload.stations = value.stations;
      payload.surfaces = value.surfaces ?? [];
      finishOne();
    }).catch(() => {
      missing.push("stations");
      finishOne();
    });
    void api.wards(cityId).then((value) => {
      if (cancelled || !payload) return;
      payload.wards = value.wards;
      finishOne();
    }).catch(() => {
      missing.push("wards");
      finishOne();
    });
    void api.fires(cityId).then((value) => {
      if (cancelled || !payload) return;
      payload.fires = value.fires;
      payload.incidents = [...payload.incidents, ...(value.incidents ?? [])];
      finishOne();
    }).catch(() => {
      missing.push("fires");
      finishOne();
    });

    return () => {
      cancelled = true;
      map.off("zoomend", onZoomEnd);
      map.off("moveend", refreshStations);
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      setCounts(EMPTY_COUNTS);
    };
  }, [cityId, mapEpoch, lang, navigate, readingsStale]);

  return (
    <div className="stack map-page">
      <PageHead kicker={city?.name ?? ""} title={t(lang, "map")}>
        <button type="button" onClick={() => setRaster((layer) => (layer === "aqi" ? "pm25" : "aqi"))}>
          {raster === "aqi" ? "US AQI" : "PM2.5"}
        </button>
        <button type="button" aria-pressed={windOn} onClick={() => setWindOn((on) => !on)}>
          {windOn ? "Wind on" : "Wind off"}
        </button>
        <button type="button" onClick={() => setPitched((v) => !v)}>
          {pitched ? t(lang, "flat") : t(lang, "buildings")}
        </button>
      </PageHead>
      <p className="muted map-sources">{SOURCE_LINE}</p>
      <div className="map-frame">
        <div id="map" ref={mapRef} />
        {mapNote ? (
          <div className="map-note" role="status">
            {mapNote === "loading" ? t(lang, "loading") : (
              <>
                {PARTIAL_NOTE[lang] ?? PARTIAL_NOTE.en}: {mapMissing.map((id) => layerName(lang, id)).join(", ")}
                {" "}
                <button type="button" onClick={() => setMapEpoch((n) => n + 1)}>{retryLabel(lang)}</button>
              </>
            )}
          </div>
        ) : null}
        {readingsStale || counts.live + counts.offline + counts.fire + counts.incident + counts.uncovered + counts.offlineHidden > 0 ? (
        <ul className="map-legend" aria-label={t(lang, "legendTitle")}>
          {readingsStale ? <li className="legend-note">{staleLive(lang)}</li> : null}
          {counts.live > 0 ? (
            <li>
              <span className="swatch swatch-live" aria-hidden="true" />
              {readingsStale ? staleLive(lang) : t(lang, "legendLive")}
            </li>
          ) : null}
          {counts.offline > 0 ? (
            <li>
              <span className="swatch swatch-offline" aria-hidden="true" />
              {readingsStale ? `${t(lang, "legendOffline")}. ${staleLive(lang)}` : t(lang, "legendOffline")}
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
          {counts.offlineHidden > 0 ? (
            <li className="legend-note">{t(lang, "offlineHidden", { n: counts.offlineHidden })}</li>
          ) : null}
        </ul>
        ) : null}
      </div>
    </div>
  );
}
