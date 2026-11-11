import { useState } from "react";
import { toast } from "sonner";
import { t } from "./i18n";

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

const GOOGLE: Record<string, string> = {
  en: "Continue with Google",
  hi: "Google से जारी रखें",
  mr: "Google सह सुरू ठेवा",
  bn: "Google দিয়ে চালিয়ে যান",
  ta: "Google மூலம் தொடரவும்",
  kn: "Google ನೊಂದಿಗೆ ಮುಂದುವರಿಸಿ",
  te: "Google తో కొనసాగించండి",
  zh: "使用 Google 继续",
  ru: "Войти через Google",
  ar: "المتابعة مع Google",
  id: "Lanjutkan dengan Google",
  pt: "Continuar com o Google",
};

const PASSWORD: Record<string, string> = {
  en: "Password",
  hi: "पासवर्ड",
  mr: "पासवर्ड",
  bn: "পাসওয়ার্ড",
  ta: "கடவுச்சொல்",
  kn: "ಪಾಸ್‌ವರ್ಡ್",
  te: "పాస్‌వర్డ్",
  zh: "密码",
  ru: "Пароль",
  ar: "كلمة المرور",
  id: "Kata sandi",
  pt: "Senha",
};

const EMAIL: Record<string, string> = {
  en: "Email",
  hi: "ईमेल",
  mr: "ईमेल",
  bn: "ইমেল",
  ta: "மின்னஞ்சல்",
  kn: "ಇಮೇಲ್",
  te: "ఇమెయిల్",
  zh: "邮箱",
  ru: "Эл. почта",
  ar: "البريد",
  id: "Email",
  pt: "E-mail",
};

export function AuthPanel({
  lang,
  className,
  firebaseEnabled,
  googleSignIn = true,
  devAuth,
  showDevOperator,
  onDevLogin,
  onFirebaseEmail,
  onFirebaseGoogle,
}: {
  lang: string;
  className?: string;
  firebaseEnabled: boolean;
  googleSignIn?: boolean;
  devAuth: boolean;
  showDevOperator?: boolean;
  onDevLogin: (email: string, asOperator: boolean) => void;
  onFirebaseEmail: (email: string, password: string) => Promise<void>;
  onFirebaseGoogle: () => Promise<void>;
}) {
  const [signError, setSignError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = OP_SIGN[lang] ?? OP_SIGN.en;

  const run = async (task: () => Promise<void>) => {
    setSignError(null);
    setBusy(true);
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : label;
      setSignError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className ?? "auth-panel"}>
      {firebaseEnabled ? (
        <>
          <form
            className="operator-login"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const email = String(data.get("email") ?? "").trim();
              const password = String(data.get("password") ?? "");
              if (!email || password.length < 6) return;
              void run(() => onFirebaseEmail(email, password));
            }}
          >
            <label>
              {EMAIL[lang] ?? EMAIL.en}
              <input type="email" name="email" required autoComplete="username" disabled={busy} />
            </label>
            <label>
              {PASSWORD[lang] ?? PASSWORD.en}
              <input type="password" name="password" required minLength={6} autoComplete="current-password" disabled={busy} />
            </label>
            {signError ? <p className="error">{signError}</p> : null}
            <button type="submit" className="primary" disabled={busy}>{label}</button>
          </form>
          <button
            type="button"
            className="quiet"
            disabled={busy || !googleSignIn}
            title={
              googleSignIn
                ? undefined
                : "Enable Google under Firebase Authentication → Sign-in method"
            }
            onClick={() => void run(() => onFirebaseGoogle())}
          >
            {GOOGLE[lang] ?? GOOGLE.en}
          </button>
          {!googleSignIn ? (
            <p className="error">
              Google sign-in is off for this Firebase project. Enable Google under Authentication → Sign-in method.
            </p>
          ) : null}
        </>
      ) : null}

      {devAuth && !firebaseEnabled ? (
        <div className="account">
          <button type="button" className="primary" disabled={busy} onClick={() => onDevLogin("resident@zephyr.local", false)}>
            {t(lang, "signInAction")}
          </button>
        </div>
      ) : null}

      {devAuth && showDevOperator && !firebaseEnabled ? (
        <form
          className="operator-login"
          onSubmit={(event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
            if (!email) return;
            onDevLogin(email, true);
          }}
        >
          <label>
            {t(lang, "operatorEmail")}
            <input type="email" name="email" required autoComplete="email" aria-describedby="operator-email-hint" />
          </label>
          <p className="muted" id="operator-email-hint">
            {t(lang, "operatorEmailHint")}
          </p>
          <button type="submit" className="primary">{label}</button>
        </form>
      ) : null}

      {!firebaseEnabled && !devAuth ? (
        <p className="muted">{t(lang, "signInOperator")}</p>
      ) : null}
    </div>
  );
}
