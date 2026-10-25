import "dotenv/config";
import { runWorkerTick } from "../lib/jobHandlers";

// Long-running background worker (Render "worker" service). Every tick is durable: state lives in PostgreSQL.
async function main() {
  console.log("[worker] started");
  for (;;) {
    try {
      const r = await runWorkerTick(20);
      if (r.processed || r.expired) console.log(`[worker] processed=${r.processed} expired=${r.expired}`);
    } catch (e) {
      console.error("[worker] tick failed", e instanceof Error ? e.message : e);
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
}
void main();
