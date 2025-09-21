"use client";
import { useEffect, useRef, useState } from "react";
import { fetchReport, fetchGarbage } from "@/lib/wpp";

type Metric = "spread" | "ml" | "total";
type Row = {
  tier: string; side: string;
  away: string; home: string;
  market_spread_home: number | null;
  fair_home_spread: number | null;
  required_buy_points: number | null;
  buy_to_line: number | null;
  p_current: number | null;
  p_target: number | null;
  p_buy: number | null;
  price_est: number | null;
  price_max_ok: number | null;
  ev_ok: boolean | null;
  reason?: string | null; // server "reason" (present on Garbage)
};

// debounce helper
function useDebounced<T>(val: T, ms = 300) {
  const [v, setV] = useState(val);
  useEffect(() => { const t = setTimeout(() => setV(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return v;
}

// csv helper
function rowsToCsv(rows: Row[]) {
  const headers = ["tier","side","away","home","market_spread_home","fair_home_spread","required_buy_points","buy_to_line","p_current","p_target","p_buy","price_est","price_max_ok","ev_ok"];
  const esc = (v: any) => (v === null || v === undefined) ? "" : String(v).replaceAll('"','""');
  const lines = [headers.join(",")];
  for (const r of rows) {
    const row = headers.map(h => `"${esc((r as any)[h])}"`).join(",");
    lines.push(row);
  }
  return lines.join("\n");
}

// human tooltip for any row/tier
function explain(r: Row): string {
  const pc = r.p_current, pb = r.p_buy, pt = r.p_target;
  const bp = r.required_buy_points;
  const ev = r.ev_ok, pe = r.price_est, pmax = r.price_max_ok;

  if (r.tier === "Fire") {
    const base = `Fire because p(now) ${fmtP(pc)} ≥ p(target) ${fmtP(pt)} (no/cheap buys).`;
    const evPart = (pe != null && pmax != null && ev != null)
      ? ` EV check at est price ${fmtPrice(pe)} vs max ${fmtPrice(pmax)}: ${ev ? "OK" : "FAIL"}.`
      : "";
    return base + evPart;
  }
  if (r.tier === "Watch") {
    const base = `Watch because it needs buys to reach target: buy ${fmtNum(bp)} pts to ${fmtNum(r.buy_to_line)}; p(buy) ${fmtP(pb)} ≥ p(target) ${fmtP(pt)}.`;
    const evPart = (pe != null && pmax != null && ev != null)
      ? ` EV check at est price ${fmtPrice(pe)} vs max ${fmtPrice(pmax)}: ${ev ? "OK" : "FAIL"}.`
      : "";
    return base + evPart;
  }
  // Garbage: prefer server reason, fall back to computed
  if (r.reason) return r.reason;
  if (pb != null && pt != null && pb < pt) {
    return `Garbage because even after buying, p(buy) ${fmtP(pb)} < p(target) ${fmtP(pt)}.`;
  }
  return `Garbage because required buy or price violates rules, or value insufficient.`;
}

function fmtP(v: number | null) { return v == null ? "—" : (v*100).toFixed(1) + "%"; }
function fmtNum(v: number | null) { return v == null ? "—" : String(v); }
function fmtPrice(v: number | null) { return v == null ? "—" : (v > 0 ? `+${v}` : String(v)); }

export default function Home() {
  const [metric, setMetric] = useState<Metric>("spread");
  const [target, setTarget] = useState(0.65);
  const debouncedTarget = useDebounced(target, 250);

  const [fire, setFire] = useState<Row[]>([]);
  const [watch, setWatch] = useState<Row[]>([]);
  const [garbage, setGarbage] = useState<Row[]>([]);
  const [byTier, setByTier] = useState<Record<string, number>>({});
  const [rate, setRate] = useState({ limit: 0, remaining: 0 });
  const [cache, setCache] = useState({ status: "MISS", ttl: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // auto-refresh controls
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSecs, setRefreshSecs] = useState(60);
  const timerRef = useRef<number | null>(null);

  // sorting controls
  type SortKey = keyof Row | "matchup";
  const [sortKey, setSortKey] = useState<SortKey>("required_buy_points");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function doFetch() {
    setLoading(true);
    setErr(null);
    Promise.all([
      fetchReport(debouncedTarget, metric),
      fetchGarbage(metric, 25, debouncedTarget),
    ])
      .then(([{ data, rate, cache }, garbageRows]) => {
        setFire(data.sections?.fire ?? []);
        setWatch(data.sections?.watch ?? []);
        setByTier(data.summary?.by_tier ?? {});
        setRate(rate); setCache(cache);
        setGarbage(garbageRows ?? []);
        setLastUpdated(new Date());
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { doFetch(); }, [metric, debouncedTarget]);

  // auto refresh timer
  useEffect(() => {
    if (!autoRefresh) { if (timerRef.current) window.clearInterval(timerRef.current); timerRef.current = null; return; }
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => doFetch(), Math.max(5, refreshSecs) * 1000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSecs, metric, debouncedTarget]);

  if (err) return <div className="p-6 text-red-600">Error: {err}</div>;
  if (loading) return <div className="p-6">Loading…</div>;

  const sortRows = (rows: Row[]) => {
    return [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = (sortKey === "matchup") ? `${a.away} @ ${a.home}` : (a as any)[sortKey];
      const vb = (sortKey === "matchup") ? `${b.away} @ ${b.home}` : (b as any)[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  };

  const headers: { key: SortKey; label: string }[] = [
    { key: "side", label: "Side" },
    { key: "matchup", label: "Matchup" },
    { key: "market_spread_home", label: "Market (home)" },
    { key: "fair_home_spread", label: "Fair (home)" },
    { key: "required_buy_points", label: "Buy Pts" },
    { key: "buy_to_line", label: "Buy To" },
    { key: "p_current", label: "p(now)" },
    { key: "p_target", label: "p(target)" },
    { key: "p_buy", label: "p(buy)" },
    { key: "price_est", label: "Price est" },
    { key: "price_max_ok", label: "Price max" },
    { key: "ev_ok", label: "EV ok" },
  ];

  const buyRules = (
    <span title={"Watch vs Garbage rules:\n- -3.5 → -2.5 allowed if ≤ ~-145\n- +2.5 → +3 allowed if ≤ ~-135\n- -7.5 → -6.5 allowed if ≤ ~-125\n- No non-key buys"}>
      (rules)
    </span>
  );

  const Table = ({ rows }: { rows: Row[] }) => {
    const sorted = sortRows(rows);
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50">
            {headers.map(h => (
              <th
                key={h.key}
                className="px-3 py-2 border cursor-pointer select-none"
                onClick={() => {
                  if (sortKey === h.key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
                  else { setSortKey(h.key); setSortDir("asc"); }
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {h.label}
                  {sortKey === h.key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                </span>
              </th>
            ))}
            <th className="px-3 py-2 border">Why?</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-3 py-2 border">{r.side}</td>
              <td className="px-3 py-2 border">{r.away} @ {r.home}</td>
              <td className="px-3 py-2 border">{r.market_spread_home ?? "—"}</td>
              <td className="px-3 py-2 border">{r.fair_home_spread ?? "—"}</td>
              <td className="px-3 py-2 border">{r.required_buy_points ?? "—"}</td>
              <td className="px-3 py-2 border">{r.buy_to_line ?? "—"}</td>
              <td className="px-3 py-2 border">{r.p_current ?? "—"}</td>
              <td className="px-3 py-2 border">{r.p_target ?? "—"}</td>
              <td className="px-3 py-2 border">{r.p_buy ?? "—"}</td>
              <td className="px-3 py-2 border">{r.price_est ?? "—"}</td>
              <td className="px-3 py-2 border">{r.price_max_ok ?? "—"}</td>
              <td className="px-3 py-2 border">{r.ev_ok === null ? "—" : r.ev_ok ? "✅" : "❌"}</td>
              <td className="px-3 py-2 border">{<span title={explain(r)}>ℹ️</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const exportCsv = (which: "fire" | "watch" | "garbage") => {
    const rows = which === "fire" ? fire : which === "watch" ? watch : garbage;
    const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wpp-${which}-${metric}-p${target.toFixed(2)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">SCAMMELL Betting Technology — Live Picks</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-medium">Metric</span>
          <select
            className="border rounded px-2 py-1"
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
          >
            <option value="spread">Spread</option>
            <option value="ml">Moneyline</option>
            <option value="total">Total</option>
          </select>
        </label>

        <label className="flex items-center gap-3">
          <span className="font-medium">Target p*</span>
          <input
            type="range" min={0.55} max={0.75} step={0.01}
            value={target}
            onChange={(e) => setTarget(parseFloat(e.target.value))}
          />
          <span className="tabular-nums">{target.toFixed(2)}</span>
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          <span>Auto-refresh</span>
        </label>

        <label className="flex items-center gap-2">
          <span>every</span>
          <input
            className="w-16 border rounded px-2 py-1"
            type="number"
            min={5}
            value={refreshSecs}
            onChange={(e) => setRefreshSecs(parseInt(e.target.value || "60", 10))}
          />
          <span>s</span>
        </label>

        <button className="border rounded px-3 py-1" onClick={() => doFetch()}>Refresh now</button>

        <div className="text-xs text-gray-600">
          Rate: {rate.remaining}/{rate.limit} | Cache: {cache.status} (TTL {cache.ttl}s)
          {lastUpdated && <> | Updated: {lastUpdated.toLocaleTimeString()}</>}
        </div>
      </div>

      {/* Counts + rules tooltip */}
      <div className="flex items-center gap-6 text-sm">
        <div>🔥 Fire: {byTier["Fire"] ?? 0}</div>
        <div>👀 Watch: {byTier["Watch"] ?? 0}</div>
        <div>🗑️ Garbage: {byTier["Garbage"] ?? 0} <span className="text-gray-500">{buyRules}</span></div>
      </div>

      <div className="flex gap-2 text-xs">
        <button className="border rounded px-2 py-1" onClick={() => exportCsv("fire")}>Export Fire CSV</button>
        <button className="border rounded px-2 py-1" onClick={() => exportCsv("watch")}>Export Watch CSV</button>
        <button className="border rounded px-2 py-1" onClick={() => exportCsv("garbage")}>Export Garbage CSV</button>
      </div>

      <h2 className="text-xl font-semibold mt-2">🔥 Fire</h2>
      <Table rows={fire} />

      <h2 className="text-xl font-semibold mt-8">👀 Watch</h2>
      <Table rows={watch} />

      <h2 className="text-xl font-semibold mt-8">🗑️ Garbage</h2>
      <Table rows={garbage} />
    </div>
  );
}
