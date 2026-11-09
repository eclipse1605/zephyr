import { runTickViaJobs } from "./ingestJobs.js";
import type { FileStore } from "./store.js";

export type TickOptions = {
  fixturesRoot: string;
  store: FileStore;
  now?: Date;
  dataDir?: string;
};

/** Enqueue catalog/wind/ops shards and drain them (bootstrap and tests). */
export async function runTick(opts: TickOptions) {
  return runTickViaJobs({
    store: opts.store,
    fixturesRoot: opts.fixturesRoot,
    dataDir: opts.dataDir ?? process.env.ZEPHYR_DATA_DIR?.trim(),
    now: opts.now,
  });
}

export {
  enqueueIngestJobs,
  claimNextJob,
  runClaimedJob,
  drainIngestJobs,
  replayIngestJob,
  stationContentHash,
  runTickViaJobs,
} from "./ingestJobs.js";
