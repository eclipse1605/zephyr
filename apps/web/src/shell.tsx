import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LANGUAGES, t } from "./i18n";
import { LangContext } from "./lang";
import { Logo } from "./logo";
import type { Auth, City } from "./api";
import "./shell.css";

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
        onClick={() => setOpen((value) => !value)}
      >
        {current?.short ?? lang.toUpperCase()}
      </button>
      {open ? (
        <ul className="lang-list" role="listbox" aria-label={t(lang, "language")}>
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
  const { lang, setLang } = useContext(LangContext);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const page = t(lang, pageKey(pathname));
    document.title = `${page} \u2014 Zephyr`;
  }, [lang, pathname]);

  return (
    <div className="shell" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <nav className="nav" aria-label={t(lang, "navPrimary")}>
        <Link className="brand" to="/">
          <Logo />
          <span className="brand-name">Zephyr</span>
        </Link>
        <div className="links">
          <NavLink to="/" end>
            {t(lang, "home")}
          </NavLink>
          <NavLink to="/map">{t(lang, "map")}</NavLink>
          <NavLink to="/report">{t(lang, "report")}</NavLink>
          <NavLink to="/diary">{t(lang, "diary")}</NavLink>
          {auth?.operator ? (
            <>
              <NavLink to="/operator">{t(lang, "operator")}</NavLink>
              <NavLink to="/pipeline">{t(lang, "pipeline")}</NavLink>
            </>
          ) : null}
        </div>
        <div className="nav-tools">
          <label className="inline">
            <span className="sr">{t(lang, "city")}</span>
            <select aria-label={t(lang, "city")} value={cityId} onChange={(e) => setCityId(e.target.value)}>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <LangMenu lang={lang} setLang={setLang} />
          <ThemeToggle lang={lang} />
          {auth ? (
            <>
              <span className="muted">{auth.email}</span>
              <button type="button" onClick={logout}>
                {t(lang, "signOut")}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => login("resident@zephyr.local", false)}>
                {t(lang, "resident")}
              </button>
              <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                {t(lang, "operatorLogin")}
              </button>
            </>
          )}
        </div>
      </nav>
      {open && !auth ? (
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
            {t(lang, "operatorLogin")}
          </button>
        </form>
      ) : null}
      <main>{children}</main>
    </div>
  );
}
