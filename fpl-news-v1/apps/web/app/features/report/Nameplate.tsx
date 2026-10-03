const names = {daily:"FPL 日报",weekly:"FPL 周报",monthly:"FPL 月报",archive:"资讯归档"};
export function Nameplate({which,className=""}:{which:keyof typeof names;className?:string}) {
  return <svg viewBox="0 0 600 110" className={className} aria-hidden="true" focusable="false"><text x="0" y="88" fontSize="92" fontWeight="800" fontFamily="system-ui, PingFang SC, sans-serif" className="fill-ink">{names[which]}</text></svg>;
}
