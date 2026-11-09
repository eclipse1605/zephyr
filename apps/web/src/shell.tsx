import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { rememberTrack, savedTracks, trackHeading } from "./advice";
import { LANGUAGES, t } from "./i18n";
import { LangContext } from "./lang";
import { LegalFooter } from "./legal";
import { Logo } from "./logo";
import { formatWhen } from "./uiBits";
import type { Auth, City } from "./api";
import "./shell.css";

const NAV_OPEN: Record<string, string> = {
  en: "Open menu", hi: "मेनू खोलें", mr: "मेनू उघडा", bn: "মেনু খুলুন", ta: "மெனுவைத் திற", kn: "ಮೆನು ತೆರೆಯಿರಿ", te: "మెనూ తెరవండి", zh: "打开菜单", ru: "Открыть меню", ar: "افتح القائمة", id: "Buka menu", pt: "Abrir menu",
};

const NAV_CLOSE: Record<string, string> = {
  en: "Close menu", hi: "मेनू बंद करें", mr: "मेनू बंद करा", bn: "মেনু বন্ধ করুন", ta: "மெனுவை மூடு", kn: "ಮೆನು ಮುಚ್ಚಿ", te: "మెనూ మూసివేయండి", zh: "关闭菜单", ru: "Закрыть меню", ar: "أغلق القائمة", id: "Tutup menu", pt: "Fechar menu",
};

const OP_SIGN: Record<string, string> = {
  en: "Sign in",
  hi: "साइन इन",
  mr: "साइन इन",
  bn: "সাইন ইন",
  ta: "உள்நுழை",
  kn: "ಸೈನ್ ಇನ್",
  te: "సైన్ ఇన్",
  zh: "登录",
  ru: "Войти",
  ar: "دخول",
  id: "Masuk",
  pt: "Entrar",
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

function LangMenu({ lang, setLang }: { lang: string; setLang: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((language) => language.id === lang);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={root}>
      <button
        type="button"
        className="lang-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t(lang, "language")}
        title={current?.label}
        onClick={() => {
          const button = root.current?.querySelector("button")?.getBoundingClientRect();
          const foot = root.current?.closest(".sidebar-foot")?.getBoundingClientRect();
          if (button && foot) {
            const below = window.innerHeight - button.bottom;
            const up = below < 240 && button.top > below;
            setPlace(up
              ? { bottom: window.innerHeight - button.top + 6, left: foot.left, width: foot.width }
              : { top: button.bottom + 6, left: foot.left, width: foot.width });
          }
          setOpen((value) => !value);
        }}
      >
        {current?.short ?? lang.toUpperCase()}
      </button>
      {open ? (
        <ul className="lang-list" role="listbox" aria-label={t(lang, "language")} style={place ?? undefined}>
          {LANGUAGES.map((language) => (
            <li key={language.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={language.id === lang}
                className={language.id === lang ? "is-current" : undefined}
                onClick={() => {
                  setLang(language.id);
                  setOpen(false);
                }}
              >
                <span className="lang-short">{language.short}</span>
                <span>{language.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
  emulatorSignIn,
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
  emulatorSignIn: (email: string, password: string) => Promise<{ idToken: string; email: string }>;
  children: ReactNode;
}) {
  const { lang, setLang } = useContext(LangContext);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

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
    <div className={navOpen ? "shell is-nav-open" : "shell"} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <button
        type="button"
        className="nav-scrim"
        aria-label={navToggleLabel(lang, true)}
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar" id="app-sidebar">
        <Link className="brand" to="/">
          <Logo />
          <span className="brand-name">Zephyr</span>
        </Link>
        <nav className="links" aria-label={t(lang, "navPrimary")}>
          <NavLink to="/" end>
            <span className="nav-item"><NavIcon name="home" />{t(lang, "home")}</span>
          </NavLink>
          <NavLink to="/map">
            <span className="nav-item"><NavIcon name="map" />{t(lang, "map")}</span>
          </NavLink>
          <NavLink to="/report">
            <span className="nav-item"><NavIcon name="report" />{t(lang, "report")}</span>
          </NavLink>
          {tracks.map((item, index) => (
            <NavLink className="nav-track" key={item.id} to={`/track/${item.id}`}>
              {trackHeading(lang, index + 1)}
              <small>{[cities.find((city) => city.id === item.city)?.name ?? item.city, item.hazard ? t(lang, item.hazard) : "", item.at ? formatWhen(item.at, lang) : "", item.id.slice(0, 8)].filter(Boolean).join(" · ")}</small>
            </NavLink>
          ))}
          <NavLink to="/diary">
            <span className="nav-item"><NavIcon name="diary" />{t(lang, "diary")}</span>
          </NavLink>
          {auth?.operator ? (
            <>
              <NavLink to="/operator">
                <span className="nav-item"><NavIcon name="operator" />{t(lang, "operator")}</span>
              </NavLink>
              <NavLink to="/pipeline">
                <span className="nav-item"><NavIcon name="pipeline" />{t(lang, "pipeline")}</span>
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          <label className="inline city-field">
            <span>{t(lang, "city")}</span>
            <select aria-label={t(lang, "city")} value={cityId} onChange={(e) => setCityId(e.target.value)}>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sidebar-tools">
            <LangMenu lang={lang} setLang={setLang} />
            <ThemeToggle lang={lang} />
          </div>
          {auth ? (
            <div className="account">
              <span className="muted" title={auth.email}>{auth.email}</span>
              <button type="button" className="quiet" onClick={logout}>
                {t(lang, "signOut")}
              </button>
            </div>
          ) : devAuth ? (
            <div className="account">
              <button type="button" className="primary" onClick={() => login("resident@zephyr.local", false)}>
                {t(lang, "resident")}
              </button>
              <button type="button" className="quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                {OP_OPEN[lang] ?? OP_OPEN.en}
              </button>
            </div>
          ) : null}
          {authEmulator && !auth ? (
            <form
              className="operator-login"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const email = String(data.get("email") ?? "").trim();
                const password = String(data.get("password") ?? "");
                setSignError(null);
                void emulatorSignIn(email, password).then((session) => {
                  loginToken(session.email, session.idToken);
                }).catch(() => setSignError(OP_SIGN[lang] ?? OP_SIGN.en));
              }}
            >
              <label>
                {t(lang, "operatorEmail")}
                <input type="email" name="email" required autoComplete="username" />
              </label>
              <label>
                {OP_SIGN[lang] ?? OP_SIGN.en}
                <input type="password" name="password" required minLength={6} autoComplete="current-password" />
              </label>
              {signError ? <p className="error">{signError}</p> : null}
              <button type="submit" className="primary">{OP_SIGN[lang] ?? OP_SIGN.en}</button>
            </form>
          ) : null}
          {devAuth && open && !auth ? (
            <form
              className="operator-login"
              onSubmit={(event) => {
                event.preventDefault();
                const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
                if (!email) return;
                login(email, true);
                setOpen(false);
              }}
            >
              <label>
                {t(lang, "operatorEmail")}
                <input type="email" name="email" required autoComplete="email" aria-describedby="operator-email-hint" />
              </label>
              <p className="muted" id="operator-email-hint">
                {t(lang, "operatorEmailHint")}
              </p>
              <button type="submit" className="primary">
                {OP_SIGN[lang] ?? OP_SIGN.en}
              </button>
            </form>
          ) : null}
        </div>
      </aside>
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
