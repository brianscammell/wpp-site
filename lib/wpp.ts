export const WPP_BASE = process.env.NEXT_PUBLIC_WPP_BASE ?? "http://localhost:8000";

export async function fetchReport(targetProb = 0.65, metric: "spread" | "ml" | "total" = "spread") {
  const url = new URL(`${WPP_BASE}/report`);
  url.searchParams.set("target_prob", String(targetProb));
  url.searchParams.set("metric", metric);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`WPP /report failed: ${res.status}`);
  const data = await res.json();
  return {
    data,
    rate: {
      limit: Number(res.headers.get("x-ratelimit-limit") ?? 0),
      remaining: Number(res.headers.get("x-ratelimit-remaining") ?? 0),
    },
    cache: {
      status: res.headers.get("x-cache") ?? "MISS",
      ttl: Number(res.headers.get("x-cache-ttl") ?? 0),
    },
  };
}

// Map a /best_edges play into the flattened Row shape used by the page
function mapPlayToRow(p: any) {
  const game = p?.game ?? {};
  const required = p?.required ?? {};
  const pricing = p?.pricing ?? {};
  const prob = p?.prob ?? {};
  const market = p?.market ?? {};
  const fair = p?.fair ?? {};
  return {
    tier: p?.tier ?? "Garbage",
    side: p?.recommendation ?? "none",
    away: game?.away ?? "",
    home: game?.home ?? "",
    market_spread_home: market?.spread_home ?? market?.spread?.home ?? null,
    fair_home_spread: fair?.home_spread ?? null,
    required_buy_points: required?.buy_points ?? null,
    buy_to_line: required?.buy_to_line ?? null,
    p_current: prob?.current ?? null,
    p_target: prob?.target ?? null,
    p_buy: prob?.buy ?? null,
    price_est: pricing?.final_price ?? null,
    price_max_ok: pricing?.max_acceptable_price ?? null,
    ev_ok: pricing?.ev_ok ?? null,
    reason: p?.reason ?? null,          // <-- pass through reason for tooltip
  };
}

// Fetch Garbage plays and return them already flattened
export async function fetchGarbage(
  metric: "spread" | "ml" | "total" = "spread",
  n = 10,
  targetProb = 0.65
) {
  const url = new URL(`${WPP_BASE}/best_edges`);
  url.searchParams.set("tier", "garbage");
  url.searchParams.set("metric", metric);
  url.searchParams.set("n", String(n));
  url.searchParams.set("target_prob", String(targetProb));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`WPP /best_edges (garbage) failed: ${res.status}`);
  const data = await res.json();
  const plays = data?.plays ?? [];
  return plays.map(mapPlayToRow);
}
