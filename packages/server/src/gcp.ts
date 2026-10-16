import { createHash, createSign } from "node:crypto";
import { googleAccessToken } from "./live.js";
import type { FileStore } from "./store.js";

export function resolveProjectId(): string {
  return (
    process.env.ZEPHYR_PROJECT_ID?.trim() ||
    process.env.BIGQUERY_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    ""
  );
}

export async function publishReport(reportId: string): Promise<boolean> {
  const project = resolveProjectId();
  const topic = process.env.ZEPHYR_REPORT_TOPIC?.trim();
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !topic || !key) return false;
  const token = await googleAccessToken(key);
  const data = Buffer.from(JSON.stringify({ reportId })).toString("base64");
  const res = await fetch(`https://pubsub.googleapis.com/v1/projects/${project}/topics/${topic}:publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ data }] }),
  });
  return res.ok;
}

export async function insertHourly(
  rows: Array<{ stationId: string; cityId: string; observedAt: string; pm25: number | null; aqi: number | null; source: string }>,
): Promise<boolean> {
  const project = resolveProjectId();
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !key || rows.length === 0) return false;
  const token = await googleAccessToken(key);
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/air/tables/station_readings/insertAll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: rows.slice(-50).map((row) => ({
        insertId: `${row.stationId}:${row.observedAt}`,
        json: {
          station_id: row.stationId,
          city_id: row.cityId,
          observed_at: row.observedAt,
          pm25: row.pm25,
          aqi: row.aqi,
          source: row.source,
        },
      })),
    }),
  });
  return res.ok;
}

export async function syncState(store: FileStore): Promise<void> {
  if (process.env.ZEPHYR_STORE !== "gcp") return;
  const db = await store.read();
  await insertHourly(db.hourly);
}

export async function deliverPendingTasks(store: FileStore): Promise<number> {
  const db = await store.read();
  const tasks = [...(db.pendingTasks ?? [])];
  db.pendingTasks = [];
  await store.write(db);
  for (const task of tasks) {
    console.log(JSON.stringify({ event: "notify", kind: task.kind, payload: task.payload }));
  }
  return tasks.length;
}

function serviceAccount(): { client_email: string; private_key: string } | null {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!key) return null;
  try {
    const sa = JSON.parse(key) as { client_email?: string; private_key?: string };
    if (!sa.client_email || !sa.private_key) return null;
    return { client_email: sa.client_email, private_key: sa.private_key };
  } catch {
    return null;
  }
}

function signObjectUrl(method: "GET" | "PUT", objectName: string, ttlSeconds: number): string | null {
  const bucket = process.env.ZEPHYR_BUCKET?.trim();
  const sa = serviceAccount();
  if (!bucket || !sa) return null;
  const datestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = datestamp.slice(0, 8);
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const credential = `${sa.client_email}/${credentialScope}`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeURIComponent(bucket)}/${objectName.split("/").map(encodeURIComponent).join("/")}`;
  const query: Record<string, string> = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": datestamp,
    "X-Goog-Expires": String(ttlSeconds),
    "X-Goog-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? "")}`)
    .join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hashed = createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = ["GOOG4-RSA-SHA256", datestamp, credentialScope, hashed].join("\n");
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(stringToSign);
    const signature = signer.sign(sa.private_key).toString("hex");
    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
  } catch {
    return null;
  }
}

export async function signedPutUrl(objectName: string): Promise<string | null> {
  return signObjectUrl("PUT", objectName, 600);
}

export async function signedGetUrl(objectName: string, ttlSeconds = 600): Promise<string | null> {
  return signObjectUrl("GET", objectName, ttlSeconds);
}
