export type SessionUser = { uid: string; email: string; operator: boolean };

export type EmulatorAccount = {
  localId: string;
  email?: string;
  customAttributes?: string;
};

export function devSession(token: string, enabled: boolean, operators: Set<string>): SessionUser | null {
  if (!enabled) return null;
  const prefix = token.startsWith("demo:") ? "demo:" : token.startsWith("operator:") ? "operator:" : null;
  if (!prefix) return null;
  const email = token.slice(prefix.length).trim().toLowerCase();
  if (!email) return null;
  return { uid: email, email, operator: operators.has(email) };
}

export function sessionFromAccount(
  account: EmulatorAccount,
  storedRole: "resident" | "operator" | undefined,
): SessionUser | null {
  const email = account.email?.trim().toLowerCase();
  if (!account.localId || !email) return null;
  let claimOperator = false;
  if (account.customAttributes) {
    try {
      const parsed = JSON.parse(account.customAttributes) as { operator?: boolean };
      claimOperator = parsed.operator === true;
    } catch {
      claimOperator = false;
    }
  }
  const operator = storedRole === "operator" || claimOperator;
  return { uid: account.localId, email, operator };
}

export async function lookupEmulatorAccount(host: string, idToken: string, apiKey: string): Promise<EmulatorAccount | null> {
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { users?: EmulatorAccount[] };
  return body.users?.[0] ?? null;
}
