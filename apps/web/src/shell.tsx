import { useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { rememberTrack, savedTracks, trackHeading } from "./advice";
import { LANGUAGES, t } from "./i18n";
import { LangContext } from "./lang";
import { LegalFooter } from "./legal";
import { Logo } from "./logo";
import { formatWhen } from "./uiBits";
import type { Auth, City } from "./api";
import { AuthPanel } from "./authPanel";
import { Menu } from "./menu";
import "./shell.css";

const NAV_OPEN: Record<string, string> = {
  en: "Open menu", hi: "मेनू खोलें", mr: "मेनू उघडा", bn: "মেনু খুলুন", ta: "மெனுவைத் திற", kn: "ಮೆನು ತೆರೆಯಿರಿ", te: "మెనూ తెరవండి", zh: "打开菜单", ru: "Открыть меню", ar: "افتح القائمة", id: "Buka menu", pt: "Abrir menu",
};

const NAV_CLOSE: Record<string, string> = {
  en: "Close menu", hi: "मेनू बंद करें", mr: "मेनू बंद करा", bn: "মেনু বন্ধ করুন", ta: "மெனுவை மூடு", kn: "ಮೆನು ಮುಚ್ಚಿ", te: "మెనూ మూసివేయండి", zh: "关闭菜单", ru: "Закрыть меню", ar: "أغلق القائمة", id: "Tutup menu", pt: "Fechar menu",
};

const OP_OPEN: Record<string, string> = {
  en: "Open operator sign-in",
  hi: "ऑपरेटर साइन-इन खोलें",
  mr: "ऑपरेटर साइन-इन उघडा",
  bn: "অপারেটর সাইন-ইন খুলুন",
  ta: "இயக்குநர் உள்நுழைவைத் திற",
  kn: "ಆಪರೇಟರ್ ಸೈನ್-ಇನ್ ತೆರೆಯಿರಿ",
  te: "ఆపరేటర్ సైన్-ఇన్ తెరవండి",
  zh: "打开操作员登录",
  ru: "Открыть вход оператора",
  ar: "افتح دخول المشغّل",
  id: "Buka masuk operator",
  pt: "Abrir entrada do operador",
};

const SIGN_IN: Record<string, string> = {
  en: "Sign in", hi: "साइन इन", mr: "साइन इन", bn: "সাইন ইন", ta: "உள்நுழை", kn: "ಸೈನ್ ಇನ್", te: "సైన్ ఇన్", zh: "登录", ru: "Войти", ar: "دخول", id: "Masuk", pt: "Entrar",
};

const SIGNED_IN: Record<string, string> = {
  en: "Signed in", hi: "साइन इन हो गया", mr: "साइन इन झाले", bn: "সাইন ইন হয়েছে", ta: "உள்நுழைந்தது", kn: "ಸೈನ್ ಇನ್ ಆಯಿತು", te: "సైన్ ఇన్ అయింది", zh: "已登录", ru: "Вход выполнен", ar: "تم الدخول", id: "Berhasil masuk", pt: "Sessão iniciada",
};

const SIGNED_OUT: Record<string, string> = {
  en: "Signed out", hi: "साइन आउट हो गया", mr: "साइन आउट झाले", bn: "সাইন আউট হয়েছে", ta: "வெளியேறியது", kn: "ಸೈನ್ ಔಟ್ ಆಯಿತು", te: "సైన్ అవుట్ అయింది", zh: "已退出", ru: "Выход выполнен", ar: "تم الخروج", id: "Berhasil keluar", pt: "Sessão terminada",
};

const COLLAPSE: Record<string, string> = {
  en: "Collapse sidebar", hi: "साइडबार समेटें", mr: "साइडबार बंद करा", bn: "সাইডবার গুটিয়ে নিন", ta: "பக்கப்பட்டியைச் சுருக்கு", kn: "ಪಟ್ಟಿ ಮುಚ್ಚಿ", te: "సైడ్‌బార్ మూసివేయండి", zh: "收起侧栏", ru: "Свернуть панель", ar: "اطوِ الشريط", id: "Ciutkan bilah", pt: "Recolher barra",
};

const EXPAND: Record<string, string> = {
  en: "Expand sidebar", hi: "साइडबार खोलें", mr: "साइडबार उघडा", bn: "সাইডবার খুলুন", ta: "பக்கப்பட்டியை விரி", kn: "ಪಟ್ಟಿ ತೆರೆಯಿರಿ", te: "సైడ్‌బార్ తెరవండి", zh: "展开侧栏", ru: "Развернуть панель", ar: "وسّع الشريط", id: "Lebarkan bilah", pt: "Expandir barra",
};

function navToggleLabel(lang: string, open: boolean): string {
  const table = open ? NAV_CLOSE : NAV_OPEN;
  return table[lang] ?? table.en;
}

function NavIcon({ name }: { name: "home" | "map" | "report" | "diary" | "operator" | "pipeline" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "home") {
    return <svg {...common}><path d="M3 8.2 9 3.2l6 5V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.2Z" /><path d="M7 16v-4.5h4V16" /></svg>;
  }
  if (name === "map") {
    return <svg {...common}><path d="M6.2 3.5 2.8 4.8v9.7l3.4-1.3 4.6 1.6 4.4-1.6V3.2L10.8 4.8 6.2 3.5Z" /><path d="M6.2 3.5v9.7M10.8 4.8v9.7" /></svg>;
  }
  if (name === "report") {
    return <svg {...common}><path d="M5 3.2h5.2L14 7v7.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1Z" /><path d="M10 3.4V7h3.4M6.2 10h5.6M6.2 12.6h4" /></svg>;
  }
  if (name === "diary") {
    return <svg {...common}><rect x="3.2" y="3.4" width="11.6" height="11.2" rx="1.4" /><path d="M6 2.8v2M12 2.8v2M3.2 7.2h11.6" /></svg>;
  }
  if (name === "operator") {
    return <svg {...common}><circle cx="9" cy="6.2" r="2.2" /><path d="M4.2 14.6c.6-2.3 2.4-3.4 4.8-3.4s4.2 1.1 4.8 3.4" /></svg>;
  }
  return <svg {...common}><path d="M3 12.5h3.2l1.4-6.2 2.6 8.4 1.6-4.2H15" /></svg>;
}

function pageKey(pathname: string): "home" | "map" | "report" | "diary" | "operator" | "pipeline" {
  if (pathname.startsWith("/track")) return "report";
  if (pathname.startsWith("/zones")) return "map";
  if (pathname.startsWith("/map")) return "map";
  if (pathname.startsWith("/report")) return "report";
  if (pathname.startsWith("/diary")) return "diary";
  if (pathname.startsWith("/operator")) return "operator";
  if (pathname.startsWith("/pipeline")) return "pipeline";
  return "home";
}

function ThemeIcon({ theme }: { theme: "light" | "dark" }) {
  if (theme === "dark") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 2.2v1.6M9 14.2v1.6M2.2 9h1.6M14.2 9h1.6M4.2 4.2l1.1 1.1M12.7 12.7l1.1 1.1M13.8 4.2l-1.1 1.1M5.3 12.7l-1.1 1.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M10.2 2.2a6.4 6.4 0 1 0 5.6 9.4A5.4 5.4 0 0 1 10.2 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeToggle({ lang }: { lang: string }) {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("zephyr.theme", next);
    setTheme(next);
  };
  return (
    <button type="button" className="theme-toggle" aria-label={t(lang, theme === "dark" ? "themeLight" : "themeDark")} onClick={toggle}>
      <ThemeIcon theme={theme} />
    </button>
  );
}

export function Shell({
  cities,
  cityId,
  setCityId,
  auth,
  login,
  loginToken,
  logout,
  devAuth,
  authEmulator,
  firebaseEnabled,
  googleSignIn = true,
  confirmedOperator,
  signInEmail,
  signInGoogle,
  children,
}: {
  cities: City[];
  cityId: string;
  setCityId: (id: string) => void;
  auth: Auth | null;
  login: (email: string, operator: boolean) => void;
  loginToken: (email: string, token: string) => void;
  logout: () => void;
  devAuth: boolean;
  authEmulator: string | null;
  firebaseEnabled: boolean;
  googleSignIn?: boolean;
  confirmedOperator: boolean;
  signInEmail: (email: string, password: string) => Promise<{ idToken: string; email: string }>;
  signInGoogle: () => Promise<{ idToken: string; email: string }>;
  children: ReactNode;
}) {
  const { lang, setLang } = useContext(LangContext);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("zephyr.nav") === "collapsed");
  const [authOpen, setAuthOpen] = useState(false);
  void authEmulator;

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    const ask = () => setAuthOpen(true);
    window.addEventListener("zephyr-signin", ask);
    return () => window.removeEventListener("zephyr-signin", ask);
  }, []);

  useEffect(() => {
    if (auth) setAuthOpen(false);
  }, [auth]);

  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuthOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const field = document.querySelector<HTMLInputElement>(".auth-card input");
    field?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [authOpen]);

  const trackPath = pathname.startsWith("/track/") ? decodeURIComponent(pathname.slice("/track/".length)) : "";
  const [tracks, setTracks] = useState(() => savedTracks());

  useEffect(() => {
    const sync = () => setTracks(savedTracks());
    window.addEventListener("zephyr-tracks", sync);
    return () => window.removeEventListener("zephyr-tracks", sync);
  }, []);

  useEffect(() => {
    if (!trackPath) return;
    rememberTrack(trackPath);
    setTracks(savedTracks());
  }, [trackPath]);

  useEffect(() => {
    const page = trackPath ? t(lang, "trackTitle", { id: trackPath.slice(0, 8) }) : pathname.startsWith("/zones/") ? t(lang, "thisArea") : t(lang, pageKey(pathname));
    document.title = `${page} \u2014 Zephyr`;
  }, [lang, pathname, trackPath]);

  return (
    <div className={["shell", navOpen ? "is-nav-open" : "", collapsed ? "is-collapsed" : ""].filter(Boolean).join(" ")} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <button
        type="button"
        className="nav-scrim"
        aria-label={navToggleLabel(lang, true)}
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-head">
          <Link className="brand" to="/">
            <Logo />
            <span className="brand-name">Zephyr</span>
          </Link>
          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={!collapsed}
            aria-label={(collapsed ? EXPAND : COLLAPSE)[lang] ?? (collapsed ? EXPAND.en : COLLAPSE.en)}
            onClick={() => {
              setCollapsed((value) => {
                const next = !value;
                localStorage.setItem("zephyr.nav", next ? "collapsed" : "open");
                return next;
              });
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d={collapsed ? "M6 3.5 10.5 8 6 12.5" : "M10 3.5 5.5 8 10 12.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <nav className="links" aria-label={t(lang, "navPrimary")}>
          <NavLink to="/" end title={t(lang, "home")}>
            <span className="nav-item"><NavIcon name="home" /><span className="nav-label">{t(lang, "home")}</span></span>
          </NavLink>
          <NavLink to="/map" title={t(lang, "map")}>
            <span className="nav-item"><NavIcon name="map" /><span className="nav-label">{t(lang, "map")}</span></span>
          </NavLink>
          <NavLink to="/report" title={t(lang, "report")}>
            <span className="nav-item"><NavIcon name="report" /><span className="nav-label">{t(lang, "report")}</span></span>
          </NavLink>
          {tracks.map((item, index) => (
            <NavLink className="nav-track" key={item.id} to={`/track/${item.id}`}>
              {trackHeading(lang, index + 1)}
              <small>{[cities.find((city) => city.id === item.city)?.name ?? item.city, item.hazard ? t(lang, item.hazard) : "", item.at ? formatWhen(item.at, lang) : "", item.id.slice(0, 8)].filter(Boolean).join(" · ")}</small>
            </NavLink>
          ))}
          <NavLink to="/diary" title={t(lang, "diary")}>
            <span className="nav-item"><NavIcon name="diary" /><span className="nav-label">{t(lang, "diary")}</span></span>
          </NavLink>
          {confirmedOperator ? (
            <>
              <NavLink to="/operator" title={t(lang, "operator")}>
                <span className="nav-item"><NavIcon name="operator" /><span className="nav-label">{t(lang, "operator")}</span></span>
              </NavLink>
              <NavLink to="/pipeline" title={t(lang, "pipeline")}>
                <span className="nav-item"><NavIcon name="pipeline" /><span className="nav-label">{t(lang, "pipeline")}</span></span>
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          <div className="city-field">
            <Menu
              label={t(lang, "city")}
              value={cityId}
              options={cities.map((city) => ({
                id: city.id,
                label: city.name,
                short: city.name.split(/\s+/).map((word) => word[0] ?? "").join("").slice(0, 2).toUpperCase(),
              }))}
              onChange={setCityId}
            />
          </div>
          <div className="sidebar-tools">
            <Menu
              label={t(lang, "language")}
              value={lang}
              options={LANGUAGES.map((language) => ({ id: language.id, label: language.label, short: language.short }))}
              onChange={setLang}
            />
            <ThemeToggle lang={lang} />
          </div>
          {auth ? (
            <div className="account">
              <span className="muted" title={auth.email}>{auth.email}</span>
              <button type="button" className="quiet" onClick={() => { logout(); toast(SIGNED_OUT[lang] ?? SIGNED_OUT.en); }} title={t(lang, "signOut")}>
                <span className="nav-mark" aria-hidden="true">{auth.email.slice(0, 1).toUpperCase()}</span>
                <span className="nav-label">{t(lang, "signOut")}</span>
              </button>
            </div>
          ) : (
            <button type="button" className="primary sign-in-open" onClick={() => setAuthOpen(true)}>
              <NavIcon name="operator" />
              <span className="nav-label">{SIGN_IN[lang] ?? SIGN_IN.en}</span>
            </button>
          )}
        </div>
      </aside>
      {authOpen ? (
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button type="button" className="auth-scrim" aria-label={NAV_CLOSE[lang] ?? NAV_CLOSE.en} onClick={() => setAuthOpen(false)} />
          <div className="auth-card">
            <div className="auth-card-head">
              <h2 id="auth-title">{SIGN_IN[lang] ?? SIGN_IN.en}</h2>
              <button type="button" className="quiet" aria-label={NAV_CLOSE[lang] ?? NAV_CLOSE.en} onClick={() => setAuthOpen(false)}>
                ×
              </button>
            </div>
            {devAuth && !firebaseEnabled ? (
              <button type="button" className="quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                {OP_OPEN[lang] ?? OP_OPEN.en}
              </button>
            ) : null}
            <AuthPanel
              lang={lang}
              firebaseEnabled={firebaseEnabled}
              googleSignIn={googleSignIn}
              devAuth={devAuth}
              showDevOperator={open}
              onDevLogin={(email, asOperator) => {
                login(email, asOperator);
                setOpen(false);
                toast.success(SIGNED_IN[lang] ?? SIGNED_IN.en);
              }}
              onFirebaseEmail={async (email, password) => {
                const session = await signInEmail(email, password);
                loginToken(session.email, session.idToken);
                toast.success(SIGNED_IN[lang] ?? SIGNED_IN.en);
              }}
              onFirebaseGoogle={async () => {
                const session = await signInGoogle();
                loginToken(session.email, session.idToken);
                toast.success(SIGNED_IN[lang] ?? SIGNED_IN.en);
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="shell-main">
        <header className="mobile-bar">
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            aria-label={navToggleLabel(lang, navOpen)}
            onClick={() => setNavOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
          <Link className="brand" to="/">
            <Logo />
            <span className="brand-name">Zephyr</span>
          </Link>
        </header>
        <main>{children}</main>
        <LegalFooter lang={lang} />
      </div>
    </div>
  );
}
