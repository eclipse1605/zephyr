import { runTickViaJobs } from "./ingestJobs.js";
import type { Store } from "./store.js";

export type TickOptions = {
  fixturesRoot: string;
  store: Store;
  now?: Date;
};

/** Enqueue catalog/wind/ops shards and drain them (bootstrap and tests). */
export async function runTick(opts: TickOptions) {
  return runTickViaJobs({
    store: opts.store,
    fixturesRoot: opts.fixturesRoot,
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
