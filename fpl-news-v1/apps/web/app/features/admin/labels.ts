// Shared admin vocabulary.
export const KIND_LABEL: Record<string, string> = { rss: "RSS", web_list: "网页列表", json_list: "JSON", x_search: "X", mp_account: "公众号", external: "外部上报" };
export const MODE_LABEL: Record<string, string> = { editorial: "精选", hot_signal: "氛围", isolated: "隔离" };
export const HEALTH_LABEL: Record<string, string> = { ok: "正常", degraded: "不稳定", failing: "失败", paused: "已暂停", unknown: "未检查" };
export const VISIBILITY_LABEL: Record<string, string> = { public: "公开", "summary-only": "仅摘要", withdrawn: "已下架" };
export const FEEDBACK_STATUS: Record<string, string> = { new: "新反馈", triaged: "处理中", replied: "已回复", resolved: "已解决", spam: "垃圾信息" };
export const TIER_LABEL: Record<string, string> = { T1: "T1", T1_5: "T1.5", T2: "T2", EXCLUDE_MP: "排除公众号" };

export const CONTENT_STATE_LABEL: Record<string,string> = {new:"待处理",extracting:"提取中",analyzing:"分析中",analyzed:"已分析",failed:"处理失败",skipped:"已跳过",ignored:"已忽略",blocked:"已过滤"};

export function sourceHealthLabel(health:string, enabled:boolean, error:string|null) {
  if (health==="paused" && enabled) return error ? /budget|预算|额度|限额/i.test(error) ? "预算暂停" : "等待重试" : "等待采集";
  return HEALTH_LABEL[health] ?? health;
}
