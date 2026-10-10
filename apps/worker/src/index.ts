import { config as loadEnv } from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore, newId, processReportMessage, runTick } from "@zephyr/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ZEPHYR_ROOT ?? path.resolve(__dirname, "../../..");
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });
const DATA = process.env.ZEPHYR_DATA_DIR ?? path.join(ROOT, ".data");
const FIXTURES = process.env.ZEPHYR_FIXTURES ?? path.join(ROOT, "fixtures");
const PORT = Number(process.env.PORT ?? 8081);

const store = new FileStore(DATA);
const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "worker" });
});

app.post("/internal/tick", async (_req, res) => {
  const result = await runTick({ store, fixturesRoot: FIXTURES });
  // Drain locally queued report messages
  const db = await store.read();
  const pending = [...db.pendingMessages];
  db.pendingMessages = [];
  await store.write(db);
  for (const msg of pending) {
    if (msg.type === "report.submitted") {
      const body = msg.body as { reportId: string };
      try {
        await processReportMessage(store, body.reportId);
      } catch (err) {
        await store.update((d) => {
          d.dlqItems[msg.id] = {
            messageId: msg.id,
            body: msg.body,
            error: err instanceof Error ? err.message : String(err),
            failedAt: new Date().toISOString(),
            replayedAt: null,
          };
        });
      }
    }
  }
  res.status(result.ok ? 200 : 500).json(result);
});

app.post("/internal/pubsub/reports", async (req, res) => {
  try {
    let reportId: string | undefined;
    const envelope = req.body?.message;
    if (envelope?.data) {
      const decoded = JSON.parse(Buffer.from(envelope.data, "base64").toString("utf8")) as {
        reportId?: string;
      };
      reportId = decoded.reportId;
    } else if (req.body?.reportId) {
      reportId = req.body.reportId;
    }
    if (!reportId) {
      // Force DLQ path for unknown payloads when asked
      throw new Error("unknown report id");
    }
    await processReportMessage(store, reportId);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Returning 500 triggers Pub/Sub retry → DLQ after 5 attempts
    res.status(500).json({ error: message });
  }
});

app.post("/internal/pubsub/dlq", async (req, res) => {
  const messageId = req.body?.message?.messageId ?? newId();
  let body: unknown = req.body;
  if (req.body?.message?.data) {
    try {
      body = JSON.parse(Buffer.from(req.body.message.data, "base64").toString("utf8"));
    } catch {
      body = req.body.message.data;
    }
  }
  await store.update((db) => {
    db.dlqItems[messageId] = {
      messageId,
      body,
      error: "dead_lettered",
      failedAt: new Date().toISOString(),
      replayedAt: null,
    };
  });
  res.status(204).end();
});

app.post("/internal/tasks/notify", async (req, res) => {
  // Cloud Tasks delivery target — log + mark notification
  console.log(JSON.stringify({ level: "info", event: "notify", body: req.body }));
  res.status(204).end();
});

console.log(JSON.stringify({ event: "worker_boot", data: DATA, fixtures: FIXTURES, port: PORT }));
await store.ensure();
console.log(JSON.stringify({ event: "store_ready" }));
app.listen(PORT, () => {
  console.log(`zephyr worker listening on :${PORT}`);
});
// Bootstrap after listen so health checks are not blocked by fixture ingest.
void runTick({ store, fixturesRoot: FIXTURES })
  .then((r) => console.log(JSON.stringify({ event: "bootstrap_tick", ...r })))
  .catch((err) => console.error("bootstrap_tick_failed", err));
