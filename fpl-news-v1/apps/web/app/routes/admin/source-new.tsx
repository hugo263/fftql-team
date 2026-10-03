import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/source-new";
import { useAdminAction } from "../../features/admin/action";
import { adminGet } from "../../lib/admin.server";
import { SourceConfigEditor, SourceTestPanel, SourceWorkflow, SOURCE_TEMPLATES, type SourceTestResult } from "../../features/admin/source-tools";
import { KIND_LABEL, MODE_LABEL, TIER_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, Field, Input, Select } from "../../features/admin/ui";

export const meta: Route.MetaFunction = () => [{ title: `新建信源 · ${SITE.name} 后台` }];

export async function loader({request}: Route.LoaderArgs) { await adminGet(request,"/api/admin/me"); return null; }

export default function NewSource() {
  const navigate = useNavigate();
  const { run, pending } = useAdminAction();
  const [form, setForm] = useState({ id: "", name: "", kind: "rss", tier: "T2", participation_mode: "editorial", interval_minutes: 60, enabled: false, first_party: false, site_fulltext: false, syndicate_fulltext: false, tags: "" });
  const [config, setConfig] = useState(JSON.stringify(SOURCE_TEMPLATES.rss, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SourceTestResult | null>(null);
  const [testedConfig, setTestedConfig] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const parsed = () => {
    try {
      setError(null);
      return JSON.parse(config) as Record<string, unknown>;
    } catch (e) {
      setError(`配置不是合法 JSON：${(e as Error).message}`);
      return null;
    }
  };

  return (
    <AdminPage title="新建信源" subtitle="填写信源 → 测试提取 → 保存 → 手动采集 → 启用自动采集。默认只发布摘要和原文链接。">
      <div className="admin-type-grid" aria-label="选择信源类型">{Object.entries(KIND_LABEL).map(([kind,label]) => <button type="button" className="admin-type" key={kind} aria-pressed={form.kind===kind} onClick={()=>{setForm({...form,kind});setConfig(JSON.stringify(SOURCE_TEMPLATES[kind]??{},null,2));setPreview(null);}}><strong>{label}</strong><small>{({rss:"订阅地址，推荐优先使用",web_list:"HTML 列表与 CSS 解析规则",json_list:"JSON 接口与字段路径",x_search:"账号或搜索条件，需要采集密钥",mp_account:"公众号原始 ID，需要提供商密钥",external:"外部脚本通过接口提交内容"} as Record<string,string>)[kind]}</small></button>)}</div>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card title="信源定义" right={<Badge>默认暂停</Badge>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID" hint="小写字母、数字和连字符，创建后不可改">
              <Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} placeholder="fpl-news-rss" />
            </Field>
            <Field label="名称">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FPL 新闻订阅" />
            </Field>

            <Field label="采集间隔（分钟）">
              <Input type="number" min={1} max={1440} value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="参与方式">
              <Select value={form.participation_mode} onChange={(e) => setForm({ ...form, participation_mode: e.target.value })}>
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="等级">
              <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="标签（逗号分隔）">
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </Field>
            <div className="flex flex-col justify-end gap-2 text-[13px] text-ink-2">
              {([
                ["first_party", "一手信源"],
                ["site_fulltext", "站内可展示全文"],
                ["syndicate_fulltext", "对外接口可带全文"],
              ] as const).map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <SourceConfigEditor kind={form.kind} value={config} onChange={setConfig}/>
            {error && <div className="mt-1 text-[12.5px] text-hot">{error}</div>}
          </div>
          {duplicate && (
            <div className="mt-4 rounded-card bg-amber/10 px-4 py-3 text-[13px] text-ink-2 ring-1 ring-amber/25">
              这个地址已经在监控：<Link className="font-medium text-accent" to={`/admin/sources/${encodeURIComponent(duplicate.id)}`}>{duplicate.name}</Link>（{duplicate.id}）。没有新建。
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              disabled={form.kind==="external"}
              busy={pending === "preview"}
              onClick={async () => {
                const c = parsed();
                if (!c) return;
                const r = await run<SourceTestResult>("POST", "/api/admin/sources/preview", { id: form.id || "draft", kind: form.kind, config: c }, { label: "preview", revalidate: false });
                if (r) {setPreview(r);setTestedConfig(config);}
              }}
            >
              测试提取
            </Button>
            <Button
              tone="primary"
              busy={pending === "create"}
              disabled={!form.id || !form.name}
              onClick={async () => {
                const c = parsed();
                if (!c) return;
                const r = await run<{ created: boolean; duplicate?: { id: string; name: string }; source?: { id: string } }>(
                  "POST",
                  "/api/admin/sources",
                  { ...form, tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), config: c },
                  { label: "create", revalidate: false },
                );
                if (!r) return;
                if (!r.created && r.duplicate) setDuplicate(r.duplicate);
                else if (r.source) navigate(`/admin/sources/${encodeURIComponent(r.source.id)}`);
              }}
            >
              保存为暂停
            </Button>
          </div>
        </Card>
        <SourceTestPanel result={preview} stale={!!preview && config !== testedConfig}/>
      </div>
      <div className="mt-5"><SourceWorkflow/></div>
    </AdminPage>
  );
}
