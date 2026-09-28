// Runs the cron's keepalive read against the real database (what the route does after planting). Read-only.
// Run from api/: pnpm tsx --env-file=.env.local spikes/probe-keepalive.ts
import { getRepo } from "../src/db/repo";
const repo = await getRepo();
try { await repo.keepalive(); console.log("keepalive OK"); } catch (e) { console.log(`keepalive THREW: ${e instanceof Error ? e.message : String(e)}`); }
