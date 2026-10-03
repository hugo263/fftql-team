import { z } from "zod";
import { credential } from "../config.ts";
import { sql } from "../db.ts";
import { enqueue, ensureQueue } from "../jobs/queue.ts";
import { X_COLLECTION_KEY, X_COLLECTION_LOCK, xCollectionState } from "../sources/x-control.ts";

const Command = z.object({ enabled: z.boolean() }).strict();
const reject = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };

export async function setXCollection(input: unknown, actor: string) {
  const { enabled } = Command.parse(input);
  if (enabled) {
    if (!credential("collectors", "X_BEARER_TOKEN") && !credential("collectors", "SOCIALDATA_API_KEY")) reject("请先在服务器配置 X API 密钥。");
    if (process.env.COLLECT_ENABLED === "false" || !(process.env.COLLECT_KINDS || "rss,web_list,json_list,x_search").split(",").includes("x_search")) reject("服务器未启用 X 采集，请检查采集环境。");
    const [worker] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM settings WHERE key='heartbeat.worker'`;
    if (!worker || Date.now() - worker.updated_at.getTime() >= 180_000) reject("采集进程未在线，请先检查 worker。");
    await ensureQueue("cron.sources.schedule", { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  }
  return sql.begin(async tx => {
    // The same lock protects paid X claims, including manual tests and queued work.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${X_COLLECTION_LOCK}))`;
    const before = await xCollectionState(tx);
    if (before.enabled === enabled) return { ...before, changed: false, message: enabled ? "X 采集已开启。" : "X 采集已关闭。" };
    const after = { enabled, initialized: before.initialized || enabled };
    // Existing preconfigured accounts were paused before the first launch. Later starts retain
    // individual pauses, so stopping the whole collector does not overwrite source preferences.
    if (enabled && !before.initialized) await tx`UPDATE sources SET enabled=true,updated_at=now() WHERE kind='x_search'`;
    let jobId: string | null = null;
    if (enabled) {
      await tx`UPDATE sources SET next_fetch_at=now() WHERE kind='x_search' AND enabled`;
      jobId = await enqueue("cron.sources.schedule", {}, { singletonKey: "x-control-start" }, tx);
    }
    await tx`INSERT INTO settings(key,value,updated_by) VALUES(${X_COLLECTION_KEY},${tx.json(after)},${actor})
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`;
    await tx`INSERT INTO audit_log(actor,action,subject,before,after)
      VALUES(${actor},'collection.x.toggle',${X_COLLECTION_KEY},${tx.json(before)},${tx.json({ ...after, jobId })})`;
    return { ...after, changed: true, message: enabled ? "X 采集已开启，开始按信源配置采集。" : "X 采集已关闭，不再提交新的 X 请求；已提交的请求可能完成。" };
  });
}
