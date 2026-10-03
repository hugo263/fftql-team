import type { FplPriceBatch } from "@aihot/contracts/fpl";
import { fullDateTime } from "../../lib/format";
import "./price-bulletin.css";

export function PriceBulletin({ batch, detailed = false }: { batch: FplPriceBatch; detailed?: boolean }) {
  return (
    <div className={`price-bulletin${detailed ? " price-bulletin--detail" : ""}`}>
      {([true, false] as const).map(up => {
        const changes=batch.changes.filter(c=>up ? c.newCost>c.oldCost : c.newCost<c.oldCost);
        const label=up ? "上涨" : "下跌";
        return <section key={label} className={`price-bulletin-group price-bulletin-group--${up?"up":"down"}`} aria-label={`${label}球员`}>
          <h3 className="price-bulletin-label">{up?"↑":"↓"} {label}<span>{changes.length} 人</span></h3>
          {detailed ? changes.length ? <ul className="price-bulletin-players">{changes.map(c=><li key={c.id}>
            <span className="price-bulletin-player"><strong>{c.name}</strong><small>{c.team} · {c.position}</small></span>
            <span className="price-bulletin-price"><span>£{c.oldCost.toFixed(1)}m</span><span aria-label="变为"> → </span><strong>£{c.newCost.toFixed(1)}m</strong></span>
            <strong className="price-bulletin-delta">{up?"+":"−"}£{Math.abs(c.newCost-c.oldCost).toFixed(1)}m</strong>
          </li>)}</ul> : <p className="price-bulletin-empty">本次没有{label}球员</p> : <p className="price-bulletin-names">{changes.map(c=>`${c.name}（${c.team}）`).join("、") || "本次无"}</p>}
        </section>;
      })}
      {detailed && <p className="price-bulletin-note">观测区间：{fullDateTime(batch.previousCheckedAt)} — {fullDateTime(batch.observedAt)}（北京时间）。这是两次官方数据采集之间的价格差异，不是准确调价时刻；仅适用于 Classic，不是涨跌预测。</p>}
    </div>
  );
}
