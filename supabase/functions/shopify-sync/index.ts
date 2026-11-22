// LFB Portal - Shopify (website) sales sync
// Pulls recent orders from lazarfamilybakehouse.com (Shopify Admin API),
// totals them per day (Denver time), and upserts into the web_sales table
// that powers the Website channel on the Analytics page.
//   - Net sales per order = current_subtotal_price (after discounts & refunds,
//     excludes shipping and tax) to match Shopify's "net sales" report.
//   - Cancelled and test orders are ignored.
//   - Re-syncs the whole window every run, so refunds/edits correct themselves.
// Secrets (either option works):
//   A) SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  (Dev Dashboard app with read_orders,
//      installed on the store; a fresh 24h token is fetched each run)
//   B) SHOPIFY_ADMIN_TOKEN                        (older custom-app token)
//   SHOPIFY_STORE (optional, defaults to 10f913-36.myshopify.com)
// Query params: ?days=N (default 30, max 400)   GET ?check=1 just tests the Shopify connection
import { createClient } from "npm:@supabase/supabase-js@2";

const STORE = Deno.env.get("SHOPIFY_STORE") ?? "10f913-36.myshopify.com";
const API = "2026-01";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function denverDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

async function getToken(): Promise<{ token?: string; error?: string; via?: string }> {
  const id = Deno.env.get("SHOPIFY_CLIENT_ID");
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (id && secret) {
    const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    });
    const t = await r.text();
    if (!r.ok) return { error: `Shopify token request failed (HTTP ${r.status}): ${t.slice(0, 300)}` };
    try { return { token: JSON.parse(t).access_token, via: "client_credentials" }; }
    catch { return { error: "Shopify token response was not JSON: " + t.slice(0, 200) }; }
  }
  const legacy = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (legacy) return { token: legacy, via: "admin_token" };
  return { error: "No Shopify credentials set. Add SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Supabase > Edge Functions > Secrets." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = await getToken();
  if (!auth.token) return json({ ok: false, error: auth.error }, 500);
  const TOKEN = auth.token;
  const u = new URL(req.url);

  if (u.searchParams.get("check")) {
    const r = await fetch(`https://${STORE}/admin/api/${API}/shop.json?fields=name,myshopify_domain`, { headers: { "X-Shopify-Access-Token": TOKEN } });
    return json({ ok: r.ok, via: auth.via, status: r.status, shop: r.ok ? (await r.json()).shop : (await r.text()).slice(0, 300) }, r.ok ? 200 : 502);
  }

  const days = Math.min(Number(u.searchParams.get("days")) || 30, 400);
  const since = new Date(Date.now() - days * 864e5);

  // Page through every order in the window
  const orders: any[] = [];
  let url: string | null = `https://${STORE}/admin/api/${API}/orders.json?status=any&limit=250` +
    `&created_at_min=${since.toISOString()}&fields=id,created_at,current_subtotal_price,cancelled_at,test`;
  while (url) {
    const r: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
    if (!r.ok) return json({ ok: false, error: "Shopify HTTP " + r.status, body: (await r.text()).slice(0, 500) }, 502);
    const j = await r.json();
    orders.push(...(j.orders ?? []));
    const link = r.headers.get("link") ?? "";
    const next = link.split(",").find((p) => p.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
  }

  // Seed every day in the window with zero so refunded/cancelled days correct to 0
  const byDay: Record<string, { orders: number; net: number }> = {};
  // The oldest day is only partly inside the window, so leave it alone entirely
  const firstDay = denverDate(since.toISOString());
  for (let i = 1; i <= days; i++) {
    byDay[denverDate(new Date(since.getTime() + i * 864e5).toISOString())] = { orders: 0, net: 0 };
  }
  for (const o of orders) {
    if (o.cancelled_at || o.test) continue;
    const d = denverDate(o.created_at);
    if (d === firstDay) continue;
    const slot = byDay[d] ?? (byDay[d] = { orders: 0, net: 0 });
    slot.orders += 1;
    slot.net += Number(o.current_subtotal_price) || 0;
  }

  const rows = Object.entries(byDay).map(([sale_date, v]) => ({
    sale_date, orders: v.orders, net_sales: Math.round(v.net * 100) / 100, source: "shopify", updated_at: new Date().toISOString(),
  }));
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await sb.from("web_sales").upsert(rows, { onConflict: "sale_date" });
  if (error) return json({ ok: false, error: error.message }, 500);

  const total = rows.reduce((s, r) => s + r.net_sales, 0);
  return json({ ok: true, via: auth.via, window_days: days, orders_found: orders.length, days_upserted: rows.length, net_total: Math.round(total * 100) / 100 });
});
