// Read-only console aggregates. Keep currencies and unknown paid outcomes separate.
import { sql } from "../db.ts";
import { sourceRuntime } from "./sources.ts";

export async function adminOverview(at = new Date()) {
  const day = new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const since = new Date(day + "T00:00:00+08:00");
  const week = new Date(since.getTime() - 6 * 86400_000);
  const [attention, operations, prices, costs, runtime, x] = await Promise.all([
    sql`SELECT
      (SELECT count(*)::int FROM sources WHERE enabled AND health <> 'ok' AND fail_count > 0) AS sources,
      (SELECT count(*)::int FROM receipts WHERE status = 'unknown') AS receipts,
      (SELECT count(*)::int FROM deliveries WHERE status = 'unknown') AS deliveries,
      (SELECT count(*)::int FROM feedback WHERE status = 'new') AS feedback,
      (SELECT count(*)::int FROM articles WHERE processing_state = 'failed') AS failed`,
    sql`SELECT count(*) FILTER (WHERE discovered_at >= ${since} AND discovered_at <= ${at})::int AS discovered,
      count(*) FILTER (WHERE processing_state = 'new')::int AS waiting,
      count(*) FILTER (WHERE processing_state = 'failed')::int AS failed FROM articles`,
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE new_cost > old_cost)::int AS rises,
      count(*) FILTER (WHERE new_cost < old_cost)::int AS falls FROM fpl_price_changes WHERE observed_at >= ${since} AND observed_at <= ${at}`,
    sql`SELECT to_char(started_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day, service,
      coalesce(currency, '未标币种') AS currency, sum(cost)::text AS amount,
      count(*) FILTER (WHERE cost_basis = 'estimated')::int AS estimated,
      count(*) FILTER (WHERE cost_basis = 'actual')::int AS actual
      FROM receipt_attempts WHERE started_at >= ${week} AND started_at <= ${at} AND origin = 'live' AND cost IS NOT NULL
      GROUP BY 1,2,3 ORDER BY 1,2,3`,
    sourceRuntime(),
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled AND fail_count > 0 AND health <> 'ok')::int AS failing,
      count(*) FILTER (WHERE last_ok_at IS NOT NULL)::int AS ever_ok,
      (SELECT left(error,240) FROM fetch_runs WHERE source_id IN (SELECT id FROM sources WHERE kind = 'x_search') AND status = 'failed' AND started_at > now() - interval '1 day' ORDER BY started_at DESC LIMIT 1) AS error
      FROM sources WHERE kind = 'x_search'`,
  ]);
  return { at: at.toISOString(), day, attention: attention[0], operations: operations[0], prices: prices[0], costs, runtime, x: x[0] };
}
