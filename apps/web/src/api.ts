const API = "/api/v1";

export type Auth = { token: string; email: string; operator: boolean };

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
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; dataMode: string; ingest: unknown; integrations: Record<string, boolean> }>("/health"),
  cities: () => req<{ cities: Array<{ id: string; name: string; group: string; center: { lat: number; lng: number } }> }>("/cities"),
  summary: (cityId: string) => req<Record<string, unknown>>(`/cities/${cityId}/summary`),
  stations: (cityId: string) => req<{ stations: Array<Record<string, unknown>> }>(`/cities/${cityId}/stations`),
  wards: (cityId: string) => req<{ wards: Array<Record<string, unknown>> }>(`/cities/${cityId}/wards`),
  zone: (h3: string) => req<Record<string, unknown>>(`/zones/${h3}`),
  forecast: (h3: string, cityId: string) => req<Record<string, unknown>>(`/zones/${h3}/forecast?cityId=${cityId}`),
  brief: (h3: string) => req<{ text: string }>(`/zones/${h3}/brief?lang=en`),
  createReport: (body: unknown, auth: Auth | null) =>
    req<{ reportId: string; uploadUrl: string; closureToken: string; h3: string }>("/reports", { method: "POST", body: JSON.stringify(body) }, auth),
  uploadPhoto: async (reportId: string, file: File) => {
    const fd = new FormData();
    fd.append("photo", file);
    const res = await fetch(`${API}/reports/${reportId}/photo`, { method: "POST", body: fd });
    if (!res.ok) throw new Error("upload failed");
    return res.json();
  },
  commitReport: (reportId: string) =>
    req<{ ok: boolean }>(`/reports/${reportId}/commit`, { method: "POST", body: "{}" }),
  getReport: (id: string) => req<{ report: Record<string, unknown>; incident: Record<string, unknown> | null }>(`/reports/${id}`),
  closure: (id: string, token: string, answer: "FIXED" | "STILL") =>
    req(`/reports/${id}/closure`, { method: "POST", body: JSON.stringify({ token, answer }) }),
  diary: (auth: Auth) => req<Record<string, unknown>>("/me/diary", {}, auth),
  setDiary: (auth: Auth, body: unknown) =>
    req("/me/diary", { method: "PUT", body: JSON.stringify(body) }, auth),
  subscriptions: (auth: Auth) => req<{ subscriptions: unknown[]; notifications: unknown[] }>("/me/subscriptions", {}, auth),
  subscribe: (auth: Auth, body: unknown) =>
    req("/me/subscriptions", { method: "POST", body: JSON.stringify(body) }, auth),
  createApiKey: (auth: Auth) => req<{ apiKey: string }>("/api-keys", { method: "POST", body: "{}" }, auth),
  incidents: (auth: Auth) => req<{ incidents: Array<Record<string, unknown>> }>("/operator/incidents", {}, auth),
  incidentAction: (auth: Auth, id: string, action: string) =>
    req(`/operator/incidents/${id}/${action}`, { method: "POST", body: "{}" }, auth),
  dlq: (auth: Auth) => req<{ items: Array<Record<string, unknown>> }>("/operator/dlq", {}, auth),
  replay: (auth: Auth, id: string) => req(`/operator/dlq/${id}/replay`, { method: "POST", body: "{}" }, auth),
  setMode: (auth: Auth, dataMode: "live" | "demo") =>
    req("/system/data-mode", { method: "POST", body: JSON.stringify({ dataMode }) }, auth),
  tick: (auth: Auth) => req("/system/tick", { method: "POST", body: "{}" }, auth),
  copilot: (auth: Auth, question: string) =>
    req<{ answer: string; toolsUsed: string[] }>("/operator/copilot", { method: "POST", body: JSON.stringify({ question }) }, auth),
};
