import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import maplibregl from "maplibre-gl";
import { api, loadAuth, saveAuth, type Auth } from "./api";

type City = { id: string; name: string; group: string; center: { lat: number; lng: number } };

function useAuth() {
  const [auth, setAuth] = useState<Auth | null>(() => loadAuth());
  const login = (email: string, operator: boolean) => {
    const next = {
      email,
      operator,
      token: operator ? `operator:${email}` : `demo:${email}`,
    };
    saveAuth(next);
    setAuth(next);
  };
  const logout = () => {
    saveAuth(null);
    setAuth(null);
  };
  return { auth, login, logout };
}

function Shell({
  cities,
  cityId,
  setCityId,
  auth,
  login,
  logout,
  children,
}: {
  cities: City[];
  cityId: string;
  setCityId: (id: string) => void;
  auth: Auth | null;
  login: (email: string, operator: boolean) => void;
  logout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Zephyr</div>
        <div className="links">
          <Link to="/">Home</Link>
          <Link to="/map">Map</Link>
          <Link to="/report">Report</Link>
          <Link to="/diary">Diary</Link>
          <Link to="/operator">Operator</Link>
          <Link to="/pipeline">Pipeline</Link>
        </div>
        <div className="row">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {auth ? (
            <>
              <span className="muted">{auth.email}</span>
              <button onClick={logout}>Sign out</button>
            </>
          ) : (
            <>
              <button onClick={() => login("resident@zephyr.local", false)}>Resident</button>
              <button
                className="primary"
                onClick={() => {
                  const email = window.prompt(
                    "Operator email (must be in OPERATOR_EMAILS)",
                    "advay.bhagwat@gmail.com",
                  );
                  if (email) login(email.trim(), true);
                }}
              >
                Operator
              </button>
            </>
          )}
        </div>
      </nav>
      {children}
    </div>
  );
}

function Home({ cityId }: { cityId: string }) {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setError(null);
    api
      .summary(cityId)
      .then(setSummary)
      .catch((e) => setError(String(e.message)));
    api.health().then(setHealth).catch(() => null);
  }, [cityId]);

  if (error) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <p className="muted">Run the worker tick (demo mode) so city summaries exist.</p>
      </div>
    );
  }
  if (!summary) return <p className="muted">Loading…</p>;

  const share =
    typeof summary.shareInPoor === "number" ? `${Math.round(summary.shareInPoor * 100)}%` : "—";

  return (
    <div className="stack">
      <div className="row">
        <span className={`badge ${summary.dataMode === "demo" ? "demo" : "live"}`}>
          {String(summary.dataMode)}
        </span>
        <span className="muted">Last ingest: {String(summary.computedAt)}</span>
        {(health?.ingest as { lastError?: string } | undefined)?.lastError ? (
          <span className="badge bad">feed error</span>
        ) : null}
      </div>
      <div className="grid">
        <div className="card">
          <h2>City AQI</h2>
          <div className="big">{summary.cityAqi ?? "—"}</div>
          <p className="muted">
            Median of {String(summary.liveStationCount)} live stations (estimate from latest readings)
          </p>
        </div>
        <div className="card">
          <h2>People in Poor+ air</h2>
          <div className="big">{Number(summary.peopleInPoor).toLocaleString()}</div>
          <p className="muted">
            {share} of covered population · uncovered {Number(summary.uncoveredPopulation).toLocaleString()}
          </p>
        </div>
        <div className="card">
          <h2>Equity</h2>
          <p>
            p90/p10 AQI ratio:{" "}
            <strong>{(summary.equity as { ratio?: number } | undefined)?.ratio ?? "—"}</strong>
          </p>
          <p className="muted">Ranks monitored wards only.</p>
        </div>
        <div className="card">
          <h2>Open hotspots</h2>
          <div className="big">{String(summary.openIncidentCount)}</div>
        </div>
      </div>
      <div className="grid">
        <div className="card">
          <h3>Highest AQI wards</h3>
          <table>
            <tbody>
              {((summary.topWards as Array<{ name: string; aqi: number }>) ?? []).map((w) => (
                <tr key={w.name}>
                  <td>{w.name}</td>
                  <td>{w.aqi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Lowest AQI wards</h3>
          <table>
            <tbody>
              {((summary.bottomWards as Array<{ name: string; aqi: number }>) ?? []).map((w) => (
                <tr key={w.name}>
                  <td>{w.name}</td>
                  <td>{w.aqi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MapPage({ cityId, cities }: { cityId: string; cities: City[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const navigate = useNavigate();
  const city = cities.find((c) => c.id === cityId);

  useEffect(() => {
    if (!mapRef.current || !city) return;
    if (mapObj.current) {
      mapObj.current.setCenter([city.center.lng, city.center.lat]);
      return;
    }
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [city.center.lng, city.center.lat],
      zoom: 10,
    });
    mapObj.current = map;
    return () => {
      map.remove();
      mapObj.current = null;
    };
  }, [city]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    let cancelled = false;
    (async () => {
      const [{ stations }, { wards }] = await Promise.all([api.stations(cityId), api.wards(cityId)]);
      if (cancelled) return;
      document.querySelectorAll(".zephyr-marker").forEach((n) => n.remove());
      for (const s of stations) {
        const el = document.createElement("div");
        el.className = "zephyr-marker";
        el.style.cssText =
          "background:#5b8cff;color:white;border-radius:999px;padding:2px 6px;font-size:11px;border:1px solid #fff";
        el.textContent = String(s.aqi ?? "off");
        new maplibregl.Marker({ element: el })
          .setLngLat([Number(s.lng), Number(s.lat)])
          .setPopup(
            new maplibregl.Popup().setHTML(
              `<strong>${s.name}</strong><br/>AQI ${s.aqi ?? "offline"}<br/><a href="/zones/from-station">zone</a>`,
            ),
          )
          .addTo(map);
      }
      for (const w of wards) {
        if (!w.covered) {
          const el = document.createElement("div");
          el.className = "zephyr-marker";
          el.style.cssText =
            "background:#3a2a12;color:#ffd666;border-radius:6px;padding:2px 6px;font-size:10px";
          el.textContent = "uncovered";
          const c = w.centroid as { lat: number; lng: number };
          new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
        }
      }
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [cityId, navigate]);

  return (
    <div className="stack">
      <p className="muted">Station pins show AQI. Uncovered wards have no live station within 15 km.</p>
      <div id="map" ref={mapRef} />
    </div>
  );
}

function ReportPage({ cityId, auth }: { cityId: string; auth: Auth | null }) {
  const navigate = useNavigate();
  const [lat, setLat] = useState(28.6139);
  const [lng, setLng] = useState(77.209);
  const [hazardType, setHazardType] = useState("smoke");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cities().then((c) => {
      const city = c.cities.find((x) => x.id === cityId);
      if (city) {
        setLat(city.center.lat);
        setLng(city.center.lng);
      }
    });
  }, [cityId]);

  const submit = async () => {
    try {
      setError(null);
      if (!file) throw new Error("photo required");
      const created = await api.createReport({ cityId, lat, lng, hazardType, note }, auth);
      localStorage.setItem(`zephyr.closure.${created.reportId}`, created.closureToken);
      await api.uploadPhoto(created.reportId, file);
      await api.commitReport(created.reportId);
      navigate(`/track/${created.reportId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card form">
      <h2>Citizen report</h2>
      <label>
        Lat <input type="number" value={lat} onChange={(e) => setLat(Number(e.target.value))} />
      </label>
      <label>
        Lng <input type="number" value={lng} onChange={(e) => setLng(Number(e.target.value))} />
      </label>
      <label>
        Hazard
        <select value={hazardType} onChange={(e) => setHazardType(e.target.value)}>
          {["smoke", "dust", "haze", "fire", "trash_fire", "construction", "other"].map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
      <label>
        Note <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {error ? <p className="error">{error}</p> : null}
      <button className="primary" onClick={submit}>
        Submit
      </button>
    </div>
  );
}

function TrackPage() {
  const { id } = useParams();
  const [data, setData] = useState<{ report: Record<string, unknown>; incident: Record<string, unknown> | null } | null>(
    null,
  );

  useEffect(() => {
    if (!id) return;
    const load = () => api.getReport(id).then(setData).catch(console.error);
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [id]);

  if (!data) return <p className="muted">Loading…</p>;
  const token = id ? localStorage.getItem(`zephyr.closure.${id}`) : null;
  const closure = data.incident?.closure as { open?: boolean } | undefined;

  return (
    <div className="stack">
      <div className="card">
        <h2>Report {id}</h2>
        <p>
          Status: <strong>{String(data.report.status)}</strong>
        </p>
        <p className="muted">Hex {String(data.report.h3)}</p>
        {data.report.classification ? (
          <pre className="muted">{JSON.stringify(data.report.classification, null, 2)}</pre>
        ) : null}
        {data.incident ? (
          <p>
            Incident <Link to={`/zones/${String(data.incident.h3)}`}>{String(data.incident.id)}</Link> ·{" "}
            {String(data.incident.status)} · {String(data.incident.reason)}
          </p>
        ) : null}
      </div>
      {closure?.open && token && id ? (
        <div className="card row">
          <span>Is it fixed?</span>
          <button className="primary" onClick={() => api.closure(id, token, "FIXED").then(() => api.getReport(id).then(setData))}>
            FIXED
          </button>
          <button className="danger" onClick={() => api.closure(id, token, "STILL").then(() => api.getReport(id).then(setData))}>
            STILL THERE
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ZonePage({ cityId, auth }: { cityId: string; auth: Auth | null }) {
  const { h3 } = useParams();
  const [zone, setZone] = useState<Record<string, unknown> | null>(null);
  const [forecast, setForecast] = useState<Record<string, unknown> | null>(null);
  const [brief, setBrief] = useState<string>("");

  useEffect(() => {
    if (!h3) return;
    api.zone(h3).then(setZone);
    api.forecast(h3, cityId).then(setForecast);
    api.brief(h3).then((b) => setBrief(b.text));
  }, [h3, cityId]);

  if (!zone) return <p className="muted">Loading…</p>;
  const advisory = zone.advisory as { band?: string; groups?: Record<string, string>; attribution?: string } | null;

  return (
    <div className="stack">
      <div className="card">
        <h2>Zone {h3}</h2>
        <p className="muted">Nearest station distance: {String(zone.distanceKm ?? "—")} km</p>
        <p>{brief}</p>
        {auth ? (
          <button
            onClick={() =>
              api.subscribe(auth, { h3, cityId, channels: ["in_app", "email"] }).then(() => alert("Subscribed"))
            }
          >
            Subscribe to alerts
          </button>
        ) : (
          <p className="muted">Sign in to subscribe.</p>
        )}
      </div>
      {advisory ? (
        <div className="card">
          <h3>Group advisory · {advisory.band}</h3>
          <ul>
            {Object.entries(advisory.groups ?? {}).map(([k, v]) => (
              <li key={k}>
                <strong>{k}</strong>: {v}
              </li>
            ))}
          </ul>
          <p className="muted">{advisory.attribution}</p>
        </div>
      ) : null}
      <div className="card">
        <h3>24h forecast</h3>
        <pre className="muted">{JSON.stringify(forecast, null, 2)}</pre>
      </div>
    </div>
  );
}

function DiaryPage({ cityId, auth }: { cityId: string; auth: Auth | null }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    api.diary(auth).then(setData).catch(console.error);
  }, [auth]);

  if (!auth) return <p className="muted">Sign in as a resident to use the exposure diary.</p>;

  return (
    <div className="stack">
      <div className="card row">
        <button
          className="primary"
          onClick={() =>
            api
              .cities()
              .then((c) => c.cities.find((x) => x.id === cityId)!)
              .then((city) => api.setDiary(auth, { cityId, lat: city.center.lat, lng: city.center.lng }))
              .then(() => api.diary(auth).then(setData))
          }
        >
          Set home pin to city center
        </button>
        <button onClick={() => api.createApiKey(auth).then((k) => setApiKey(k.apiKey))}>Create API key</button>
      </div>
      {apiKey ? <div className="card">API key (shown once): <code>{apiKey}</code></div> : null}
      <div className="card">
        <h3>Hours in each band (7 days)</h3>
        <pre>{JSON.stringify(data?.hoursByBand ?? {}, null, 2)}</pre>
      </div>
    </div>
  );
}

function OperatorPage({ auth }: { auth: Auth | null }) {
  const [incidents, setIncidents] = useState<Array<Record<string, unknown>>>([]);
  const [answer, setAnswer] = useState("");
  if (!auth?.operator) return <p className="muted">Sign in as operator.</p>;

  const reload = () => api.incidents(auth).then((r) => setIncidents(r.incidents));
  useEffect(() => {
    reload().catch(console.error);
  }, [auth]);

  return (
    <div className="stack">
      <div className="card">
        <h2>Response queue</h2>
        <table>
          <thead>
            <tr>
              <th>Hex</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Flags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={String(i.id)}>
                <td>
                  <Link to={`/zones/${String(i.h3)}`}>{String(i.h3).slice(0, 10)}…</Link>
                </td>
                <td>{String(i.status)}</td>
                <td>{String(i.reason)}</td>
                <td>
                  {i.repeat ? <span className="badge warn">repeat</span> : null}
                  {i.overdue ? <span className="badge bad">overdue</span> : null}
                  {i.status === "disputed" ? <span className="badge bad">disputed</span> : null}
                </td>
                <td className="row">
                  <button onClick={() => api.incidentAction(auth, String(i.id), "dispatch").then(reload)}>
                    Dispatch
                  </button>
                  <button onClick={() => api.incidentAction(auth, String(i.id), "resolve").then(reload)}>
                    Resolve
                  </button>
                  <button onClick={() => api.incidentAction(auth, String(i.id), "false-positive").then(reload)}>
                    False +
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card form">
        <h3>Copilot</h3>
        <textarea onBlur={(e) => (e.target.dataset.q = e.target.value)} placeholder="Ask about incidents, wind, fires…" />
        <button
          className="primary"
          onClick={async (e) => {
            const ta = (e.currentTarget.previousSibling as HTMLTextAreaElement).value;
            const r = await api.copilot(auth, ta);
            setAnswer(`${r.answer}\n\nTools: ${r.toolsUsed.join(", ")}`);
          }}
        >
          Ask
        </button>
        {answer ? <pre className="muted">{answer}</pre> : null}
      </div>
    </div>
  );
}

function PipelinePage({ auth }: { auth: Auth | null }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  if (!auth?.operator) return <p className="muted">Sign in as operator.</p>;

  const reload = async () => {
    setItems((await api.dlq(auth)).items);
    setHealth(await api.health());
  };
  useEffect(() => {
    reload().catch(console.error);
  }, [auth]);

  return (
    <div className="stack">
      <div className="card row">
        <span className={`badge ${(health as { dataMode?: string } | null)?.dataMode === "demo" ? "demo" : "live"}`}>
          {(health as { dataMode?: string } | null)?.dataMode}
        </span>
        <button onClick={() => api.setMode(auth, "demo").then(reload)}>Demo mode</button>
        <button onClick={() => api.setMode(auth, "live").then(reload)}>Live mode</button>
        <button className="primary" onClick={() => api.tick(auth).then(reload)}>
          Run tick
        </button>
      </div>
      <div className="card">
        <h2>Dead-letter queue</h2>
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Error</th>
              <th>Failed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={String(i.messageId)}>
                <td>{String(i.messageId).slice(0, 8)}</td>
                <td>{String(i.error)}</td>
                <td>{String(i.failedAt)}</td>
                <td>
                  <button onClick={() => api.replay(auth, String(i.messageId)).then(reload)}>Replay</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function App() {
  const { auth, login, logout } = useAuth();
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState("delhi");

  useEffect(() => {
    api.cities().then((r) => setCities(r.cities)).catch(console.error);
  }, []);

  const cityList = useMemo(() => cities, [cities]);

  return (
    <Shell cities={cityList} cityId={cityId} setCityId={setCityId} auth={auth} login={login} logout={logout}>
      <Routes>
        <Route path="/" element={<Home cityId={cityId} />} />
        <Route path="/map" element={<MapPage cityId={cityId} cities={cityList} />} />
        <Route path="/report" element={<ReportPage cityId={cityId} auth={auth} />} />
        <Route path="/track/:id" element={<TrackPage />} />
        <Route path="/zones/:h3" element={<ZonePage cityId={cityId} auth={auth} />} />
        <Route path="/diary" element={<DiaryPage cityId={cityId} auth={auth} />} />
        <Route path="/operator" element={<OperatorPage auth={auth} />} />
        <Route path="/pipeline" element={<PipelinePage auth={auth} />} />
      </Routes>
    </Shell>
  );
}
