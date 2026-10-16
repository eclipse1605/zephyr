const API = "/api/v1";

export type Auth = { token: string; email: string; operator: boolean };

export type City = {
  id: string;
  name: string;
  group: string;
  center: { lat: number; lng: number };
};

export type Health = {
  ok: boolean;
  dataMode: string;
  ingest: {
    lastError?: string | null;
    lastSuccessAt?: string | null;
    satelliteStatus?: string | null;
  } | null;
  integrations: Record<string, boolean>;
};

export type CitySummary = {
  cityId: string;
  computedAt: string;
  dataMode: string;
  cityAqi: number | null;
  liveStationCount: number;
  offlineStationCount: number;
  peopleInPoor: number;
  coveredPopulation: number;
  uncoveredPopulation: number;
  shareInPoor: number | null;
  openIncidentCount: number;
  equity: { p90: number | null; p10: number | null; ratio: number | null };
  topWards: Array<{ id: string; name: string; aqi: number }>;
  bottomWards: Array<{ id: string; name: string; aqi: number }>;
};

export type MapIncident = {
  id?: string;
  h3?: string;
  status?: string;
  lat?: number;
  lng?: number;
};

export type Station = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  aqi: number | null;
  online?: boolean;
  h3?: string;
  incidentId?: string;
  incident?: MapIncident | null;
};

export type Ward = {
  id: string;
  name: string;
  covered: boolean;
  centroid: { lat: number; lng: number };
  aqi?: number | null;
  h3?: string;
  incident?: MapIncident | null;
};

export type Fire = { id?: string; lat: number; lng: number; h3?: string; at?: string };

export type UpwindSource = {
  id?: string;
  name?: string;
  kind?: string;
  distanceKm?: number;
  alignment?: number;
};

export type ZoneView = {
  h3: string;
  cityId?: string;
  nearestStation?: { id?: string; name?: string; aqi?: number | null } | null;
  distanceKm?: number | null;
  advisory?: {
    band?: string;
    attribution?: string;
    groups?: Record<string, string>;
  } | null;
  incidents?: Array<{ id?: string; h3?: string; status?: string; upwind?: UpwindSource[] }>;
  satelliteMissing?: boolean;
  satelliteAvailable?: boolean;
  satelliteStatus?: string | null;
  satellite?: unknown;
};

export type ForecastBlock = {
  method?: string;
  stationId?: string;
  hours?: Array<{ at: string; pm25: number }>;
  error?: string;
};

export type ForecastView = {
  persistence?: ForecastBlock | null;
  modelled?: ForecastBlock | null;
  arima?: ForecastBlock | null;
};

export type Classification = {
  hazardType?: string;
  severity?: string;
  confidence?: number;
  source?: string;
  authenticityFlags?: string[];
};

export type ReportView = {
  report: {
    id?: string;
    status: string;
    h3: string;
    classification: Classification | null;
  };
  incident: {
    id: string;
    h3: string;
    status: string;
    reason: string;
    closure?: { open?: boolean; answer?: string | null } | null;
  } | null;
};

export type DiaryView = {
  hoursByBand?: Record<string, number>;
  gaps?: Array<{ after: string; before: string }>;
};

export type OperatorIncident = {
  id: string;
  h3: string;
  status: string;
  reason: string;
  repeat?: boolean;
  overdue?: boolean;
  workOrder?: { summaryEn?: string } | null;
};

export function loadAuth(): Auth | null {
  const raw = localStorage.getItem("zephyr.auth");
  return raw ? (JSON.parse(raw) as Auth) : null;
}

export function saveAuth(auth: Auth | null) {
  if (!auth) localStorage.removeItem("zephyr.auth");
  else localStorage.setItem("zephyr.auth", JSON.stringify(auth));
}

async function req<T>(path: string, init: RequestInit = {}, auth?: Auth | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function upload(path: string, field: string, file: File) {
  const fd = new FormData();
  fd.append(field, file);
  const res = await fetch(`${API}${path}`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? "upload failed");
  }
  return res.json();
}

export const api = {
  health: () => req<Health>("/health"),
  cities: () => req<{ cities: City[] }>("/cities"),
  summary: (cityId: string) => req<CitySummary>(`/cities/${cityId}/summary`),
  stations: (cityId: string) => req<{ stations: Station[]; incidents?: MapIncident[] }>(`/cities/${cityId}/stations`),
  wards: (cityId: string) => req<{ wards: Ward[] }>(`/cities/${cityId}/wards`),
  fires: (cityId: string) => req<{ fires: Fire[]; incidents?: MapIncident[] }>(`/cities/${cityId}/fires`),
  zone: (h3: string) => req<ZoneView>(`/zones/${encodeURIComponent(h3)}`),
  forecast: (h3: string, cityId: string) =>
    req<ForecastView>(`/zones/${encodeURIComponent(h3)}/forecast?cityId=${encodeURIComponent(cityId)}`),
  brief: (h3: string, lang: string) =>
    req<{ text: string }>(`/zones/${encodeURIComponent(h3)}/brief?lang=${encodeURIComponent(lang)}`),
  zoneHealth: (h3: string, lang: string) =>
    req<Record<string, unknown>>(`/zones/${encodeURIComponent(h3)}/health?lang=${encodeURIComponent(lang)}`),
  createReport: (
    body: { cityId: string; lat: number; lng: number; hazardType: string; note: string },
    auth: Auth | null,
  ) =>
    req<{ reportId: string; uploadUrl: string; closureToken: string; h3: string }>(
      "/reports",
      { method: "POST", body: JSON.stringify(body) },
      auth,
    ),
  uploadPhoto: (reportId: string, file: File) => upload(`/reports/${reportId}/photo`, "photo", file),
  uploadVoice: (reportId: string, file: File) => upload(`/reports/${reportId}/voice`, "voice", file),
  commitReport: (reportId: string) => req<{ ok: boolean }>(`/reports/${reportId}/commit`, { method: "POST", body: "{}" }),
  getReport: (id: string) => req<ReportView>(`/reports/${encodeURIComponent(id)}`),
  closure: (id: string, token: string, answer: "FIXED" | "STILL") =>
    req(`/reports/${encodeURIComponent(id)}/closure`, { method: "POST", body: JSON.stringify({ token, answer }) }),
  diary: (auth: Auth) => req<DiaryView>("/me/diary", {}, auth),
  setDiary: (auth: Auth, body: { cityId: string; lat: number; lng: number }) =>
    req("/me/diary", { method: "PUT", body: JSON.stringify(body) }, auth),
  subscriptions: (auth: Auth) => req<{ subscriptions: unknown[]; notifications: unknown[] }>("/me/subscriptions", {}, auth),
  subscribe: (auth: Auth, body: { h3: string; cityId: string; channels: string[] }) =>
    req("/me/subscriptions", { method: "POST", body: JSON.stringify(body) }, auth),
  createApiKey: (auth: Auth) => req<{ apiKey: string }>("/api-keys", { method: "POST", body: "{}" }, auth),
  incidents: (auth: Auth) => req<{ incidents: OperatorIncident[] }>("/operator/incidents", {}, auth),
  incidentAction: (auth: Auth, id: string, action: string) =>
    req(`/operator/incidents/${id}/${action}`, { method: "POST", body: "{}" }, auth),
  dlq: (auth: Auth) => req<{ items: Array<Record<string, unknown>> }>("/operator/dlq", {}, auth),
  replay: (auth: Auth, id: string) => req(`/operator/dlq/${id}/replay`, { method: "POST", body: "{}" }, auth),
  setMode: (auth: Auth, dataMode: "live" | "demo") =>
    req("/system/data-mode", { method: "POST", body: JSON.stringify({ dataMode }) }, auth),
  tick: (auth: Auth) => req("/system/tick", { method: "POST", body: "{}" }, auth),
  copilot: (auth: Auth, question: string) =>
    req<{ answer: string; toolsUsed: string[] }>("/operator/copilot", {
      method: "POST",
      body: JSON.stringify({ question }),
    }, auth),
};
