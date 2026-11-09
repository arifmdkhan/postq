import next from "./.open-next/worker.js";
import { runScheduled } from "./src/features/publishing/scheduler.ts";

const worker = {
  fetch: next.fetch,
  async scheduled(_event, env) {
    await runScheduled(env);
  },
};
export default worker;
