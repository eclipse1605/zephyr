import { useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, loadAuth, saveAuth, type Auth, type City } from "./api";
import { DiaryPage, OperatorPage, PipelinePage, ReportPage, TrackPage, ZonePage } from "./flows";
import { Home } from "./home";
import { LANGUAGES } from "./i18n";
import { LangContext } from "./lang";
import { MapPage } from "./mapPage";
import { Shell } from "./shell";

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

export function App() {
  const { auth, login, logout } = useAuth();
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState("delhi");
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem("zephyr.lang");
    return saved && LANGUAGES.some((language) => language.id === saved) ? saved : "en";
  });
  const setLang = (next: string) => {
    localStorage.setItem("zephyr.lang", next);
    setLangState(next);
  };

  useEffect(() => {
    api.cities().then((r) => setCities(r.cities)).catch(console.error);
  }, []);

  const cityList = useMemo(() => cities, [cities]);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <Shell cities={cityList} cityId={cityId} setCityId={setCityId} auth={auth} login={login} logout={logout}>
        <Routes>
          <Route path="/" element={<Home cityId={cityId} cityName={cityList.find((city) => city.id === cityId)?.name ?? ""} />} />
          <Route path="/map" element={<MapPage cityId={cityId} cities={cityList} />} />
          <Route path="/report" element={<ReportPage cityId={cityId} cities={cityList} auth={auth} />} />
          <Route path="/track/:id" element={<TrackPage cityId={cityId} />} />
          <Route path="/zones/:h3" element={<ZonePage cityId={cityId} auth={auth} />} />
          <Route path="/diary" element={<DiaryPage cityId={cityId} cities={cityList} auth={auth} login={login} />} />
          <Route path="/operator" element={<OperatorPage auth={auth} cityId={cityId} />} />
          <Route path="/pipeline" element={<PipelinePage auth={auth} cityId={cityId} />} />
        </Routes>
      </Shell>
    </LangContext.Provider>
  );
}
