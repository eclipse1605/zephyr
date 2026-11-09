import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ApiError, api, emulatorPassword, loadAuth, saveAuth, type Auth, type City } from "./api";
import { DiaryPage, OperatorPage, PipelinePage, ReportPage, TrackPage, ZonePage } from "./flows";
import { Home } from "./home";
import { LANGUAGES, langForCity } from "./i18n";
import { LangContext } from "./lang";
import { DisclaimerPage, PrivacyPage, TermsPage } from "./legal";
import { MapPage } from "./mapPage";
import { Shell } from "./shell";

const FALLBACK_CITIES: City[] = [
  { id: "delhi", name: "New Delhi", group: "india", center: { lat: 28.6139, lng: 77.209 } },
  { id: "mumbai", name: "Mumbai", group: "india", center: { lat: 19.076, lng: 72.8777 } },
  { id: "kolkata", name: "Kolkata", group: "india", center: { lat: 22.5726, lng: 88.3639 } },
  { id: "chennai", name: "Chennai", group: "india", center: { lat: 13.0827, lng: 80.2707 } },
  { id: "bengaluru", name: "Bengaluru", group: "india", center: { lat: 12.9716, lng: 77.5946 } },
  { id: "hyderabad", name: "Hyderabad", group: "india", center: { lat: 17.385, lng: 78.4867 } },
  { id: "beijing", name: "Beijing", group: "brics", center: { lat: 39.9042, lng: 116.4074 } },
  { id: "moscow", name: "Moscow", group: "brics", center: { lat: 55.7558, lng: 37.6173 } },
  { id: "pretoria", name: "Pretoria", group: "brics", center: { lat: -25.7479, lng: 28.2293 } },
  { id: "abu-dhabi", name: "Abu Dhabi", group: "brics", center: { lat: 24.4539, lng: 54.3773 } },
  { id: "jakarta", name: "Jakarta", group: "brics", center: { lat: -6.2088, lng: 106.8456 } },
  { id: "brasilia", name: "Brasília", group: "brics", center: { lat: -15.7975, lng: -47.8919 } },
];

async function syncAuthOperator(session: Auth): Promise<Auth> {
  try {
    const me = await api.whoami(session);
    const next = { ...session, operator: me.operator };
    saveAuth(next);
    return next;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      const next = { ...session, operator: false };
      saveAuth(next);
      return next;
    }
    return session;
  }
}

function useAuth() {
  const [auth, setAuth] = useState<Auth | null>(() => loadAuth());
  const login = (email: string, asOperator: boolean) => {
    const session: Auth = {
      email,
      operator: false,
      token: asOperator ? `operator:${email}` : `demo:${email}`,
    };
    saveAuth(session);
    setAuth(session);
    void syncAuthOperator(session).then(setAuth);
  };
  const loginToken = (email: string, token: string) => {
    const session: Auth = { email, operator: false, token };
    saveAuth(session);
    setAuth(session);
    void syncAuthOperator(session).then(setAuth);
  };
  const logout = () => {
    saveAuth(null);
    setAuth(null);
  };
  useEffect(() => {
    const session = loadAuth();
    if (!session) return;
    void syncAuthOperator(session).then((next) => {
      setAuth((current) => (current?.token === next.token ? next : current));
    });
  }, []);
  return { auth, login, loginToken, logout };
}

export function App() {
  const { auth, login, loginToken, logout } = useAuth();
  const location = useLocation();
  const [cities, setCities] = useState<City[]>([]);
  const [devAuth, setDevAuth] = useState(false);
  const [authEmulator, setAuthEmulator] = useState<string | null>(null);
  const [cityId, setCityId] = useState("delhi");
  const savedLang = () => {
    const saved = localStorage.getItem("zephyr.lang");
    return saved && LANGUAGES.some((language) => language.id === saved) ? saved : null;
  };
  const [lang, setLangState] = useState(() => savedLang() ?? langForCity("delhi"));
  const setLang = (next: string) => {
    localStorage.setItem("zephyr.lang", next);
    setLangState(next);
  };

  useEffect(() => {
    api.cities().then((r) => setCities(r.cities)).catch(() => setCities([]));
    api.health().then((health) => {
      setDevAuth(health.devAuth === true);
      setAuthEmulator(health.authEmulator ?? null);
    }).catch(() => {
      setDevAuth(false);
      setAuthEmulator(null);
    });
  }, []);

  const cityList = useMemo(
    () => (cities.length > 0 ? cities : FALLBACK_CITIES),
    [cities],
  );

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <Shell
        cities={cityList}
        cityId={cityId}
        setCityId={setCityId}
        auth={auth}
        login={login}
        loginToken={loginToken}
        logout={logout}
        devAuth={devAuth}
        authEmulator={authEmulator}
        emulatorSignIn={(email, password) => emulatorPassword(authEmulator ?? "", email, password)}
      >
        <Routes>
          <Route path="/" element={<Home cityId={cityId} cityName={cityList.find((city) => city.id === cityId)?.name ?? ""} />} />
          <Route path="/map" element={<MapPage cityId={cityId} cities={cityList} />} />
          <Route path="/report" element={<ReportPage key={`${location.key}-${cityId}`} cityId={cityId} cities={cityList} auth={auth} />} />
          <Route path="/track/:id" element={<TrackPage cityId={cityId} />} />
          <Route path="/zones/:h3" element={<ZonePage cityId={cityId} auth={auth} login={login} />} />
          <Route path="/diary" element={<DiaryPage cityId={cityId} cities={cityList} auth={auth} login={login} />} />
          <Route path="/operator" element={<OperatorPage auth={auth} cityId={cityId} cities={cityList} login={login} />} />
          <Route path="/pipeline" element={<PipelinePage auth={auth} cityId={cityId} cities={cityList} login={login} />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/disclaimer" element={<DisclaimerPage />} />
        </Routes>
      </Shell>
    </LangContext.Provider>
  );
}
