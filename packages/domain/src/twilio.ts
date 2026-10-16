import { createHmac, timingSafeEqual } from "node:crypto";

/** Twilio signs the full URL plus the POST params sorted by key. */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(sorted).digest("base64");
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  signature: string | undefined,
): boolean {
  if (!authToken) return false;
  if (!signature) return false;
  const expected = twilioSignature(url, params, authToken);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
