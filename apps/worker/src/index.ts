import { config as loadEnv } from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processReportMessage, runTick, deliverPendingTasks, syncState, openStore, resolveFromRoot, resolveListenPort, authorizeInternal, refreshWindGrid, enqueueIngestJobs, claimNextJob, runClaimedJob, newId } from "@zephyr/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ZEPHYR_ROOT ?? path.resolve(__dirname, "../../..");
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });
const DATA = resolveFromRoot(ROOT, process.env.ZEPHYR_DATA_DIR, path.join(ROOT, ".data"));
const FIXTURES = resolveFromRoot(ROOT, process.env.ZEPHYR_FIXTURES, path.join(ROOT, "fixtures"));
const PORT = resolveListenPort("worker");

const store = await openStore(DATA);
export const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "worker" });
});

app.use("/internal", (req, res, next) => {
  const ok = authorizeInternal({
    authorization: req.header("authorization"),
    cronHeader: req.header("x-cron-secret"),
    secret: process.env.CRON_SECRET,
    emulator: Boolean(process.env.PUBSUB_EMULATOR_HOST?.trim()),
    cloudRun: Boolean(process.env.K_SERVICE?.trim()),
  });
  if (!ok) return res.status(401).json({ error: "unauthorized" });
  next();
});

app.post("/internal/catalog", async (_req, res) => {
  const queued = await enqueueIngestJobs(store);
  res.json({ ok: true, scope: "twelve-cities", ...queued });
});

app.post("/internal/wind", async (_req, res) => {
  try {
    const result = await refreshWindGrid({
      dataDir: DATA,
      samplePath: path.join(FIXTURES, "wind", "sample.json"),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "wind" });
  }
});

app.post("/internal/tick", async (_req, res) => {
  // Scheduler only enqueues; workers claim shards separately.
  const queued = await enqueueIngestJobs(store);
  res.json({ ok: true, enqueued: queued.enqueued, jobIds: queued.jobIds });
});

app.post("/internal/jobs/run", async (_req, res) => {
  const job = await claimNextJob(store, {
    store,
    fixturesRoot: FIXTURES,
    dataDir: DATA,
    sampleWindPath: path.join(FIXTURES, "wind", "sample.json"),
  });
  if (!job) {
    await deliverPendingTasks(store);
    await syncState(store).catch(() => undefined);
    return res.json({ ok: true, ran: false });
  }
  await runClaimedJob(job, {
    store,
    fixturesRoot: FIXTURES,
    dataDir: DATA,
    sampleWindPath: path.join(FIXTURES, "wind", "sample.json"),
  });
  res.json({ ok: true, ran: true, jobId: job.id, kind: job.kind, shard: job.shard });
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
if (process.env.ZEPHYR_NO_LISTEN !== "1") {
  app.listen(PORT, () => {
    console.log(`zephyr worker listening on :${PORT}`);
  });
  // Bootstrap after listen so health checks are not blocked by fixture ingest.
  void runTick({ store, fixturesRoot: FIXTURES, dataDir: DATA })
    .then((r) => console.log(JSON.stringify({ event: "bootstrap_tick", ...r })))
    .catch((err) => console.error("bootstrap_tick_failed", err));
}
