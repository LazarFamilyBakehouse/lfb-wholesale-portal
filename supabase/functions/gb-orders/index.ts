// LFB Portal - Goldbelly Orders Ledger (v1)
// Pulls completed orders from the Goldbelly 3PL API by ORDER date (not ship date)
// and upserts them into public.gb_orders so we keep a permanent, queryable
// history of every Goldbelly sale: when it was placed, what was in it, how much,
// which discount code, and which state it shipped to.
//
// Why: Goldbelly marketplace orders carry NO purchaser email (see API docs:
// purchaser_email is nil for marketplace orders), so they cannot be attached to
// Klaviyo profiles. This ledger is the next best thing: it lets us line up order
// timestamps against Klaviyo send times and read lift per email, and it makes
// discount-code attribution exact if Goldbelly ever issues us campaign codes.
//
// Query params:
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   order-completion window (default: last 7 days)
//   ?dryrun=true                     fetch + summarize, do not write
// Secrets: GOLDBELLY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Setup: run GB_ORDERS_SETUP.sql once, then
//   supabase functions deploy gb-orders --project-ref ylvoswzsijigyezqvaat
import { createClient } from "npm:@supabase/supabase-js@2";

const GB_KEY = Deno.env.get("GOLDBELLY_API_KEY");
const dstr = (d: Date) => d.toISOString().slice(0, 10);

function shortName(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("grandma jeanne")) return "Grandma Jeanne Sampler";
  if (n.includes("shabbat")) return "Shabbat Box";
  if (n.includes("pick your mix") || n.includes("pick-your-mix")) return "Pick Your Mix 6-Pack";
  if (n.includes("treat the office")) return "Treat the Office";
  if (n.includes("tour")) return "Bakehouse Tour";
  return name || "Unknown";
}

Deno.serve(async (req) => {
  const hdr = { "Content-Type": "application/json" };
  if (!GB_KEY) return new Response(JSON.stringify({ error: "GOLDBELLY_API_KEY secret not set" }), { status: 500, headers: hdr });

  const u = new URL(req.url);
  const dryrun = u.searchParams.get("dryrun") === "true";
  const to = u.searchParams.get("to") ? new Date(u.searchParams.get("to") + "T12:00:00Z") : new Date();
  const from = u.searchParams.get("from") ? new Date(u.searchParams.get("from") + "T12:00:00Z") : new Date(to.getTime() - 7 * 864e5);
  const dates: string[] = [];
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) dates.push(dstr(d));
  if (dates.length > 92) return new Response(JSON.stringify({ error: "window too large (max 92 days)" }), { status: 400, headers: hdr });

  // Fetch by order_date, 8 days at a time
  const orders: any[] = [];
  const fetchErrors: string[] = [];
  for (let i = 0; i < dates.length; i += 8) {
    const batch = dates.slice(i, i + 8);
    const results = await Promise.all(batch.map(async (ds) => {
      try {
        const r = await fetch("https://api.goldbelly.com/v1/orders?order_date=" + ds, { headers: { Authorization: "Bearer " + GB_KEY } });
        if (!r.ok) { fetchErrors.push(ds + ": HTTP " + r.status); return []; }
        const j = await r.json();
        return Array.isArray(j) ? j : (j.data ?? []);
      } catch (e) { fetchErrors.push(ds + ": " + (e as Error).message); return []; }
    }));
    for (const arr of results) orders.push(...arr);
  }

  // Normalize
  const seen = new Set<number>();
  const rows = [];
  for (const o of orders) {
    if (!o.order_id || seen.has(o.order_id)) continue;
    seen.add(o.order_id);
    const status = ((o.status ?? "") + " " + (o.merchant_status ?? "")).toLowerCase();
    const addr = o.shipping_address ?? {};
    const items = (o.products ?? []).map((p: any) => ({
      name: shortName(p.name), raw_name: p.name, sku: p.sku, qty: Math.round(Number(p.quantity)) || 1,
      mix: (p.subproducts ?? []).filter((s: any) => s?.name).map((s: any) => (Math.round(Number(s.quantity)) || 1) + "x " + s.name),
    }));
    rows.push({
      order_id: o.order_id,
      customer_reference_number: o.customer_reference_number ?? null,
      completed_at: o.completed_at ?? null,
      updated_at: o.updated_at ?? null,
      status: o.status ?? null,
      merchant_status: o.merchant_status ?? null,
      cancelled: status.includes("cancel"),
      source: o.source ?? null,
      subtotal_cents: o.subtotal_in_cents ?? null,
      discount_code: o.discount_code ?? null,
      discount_cents: o.discount_amount_in_cents ?? null,
      shipping_cents: o.shipping_in_cents ?? null,
      purchaser_email: o.purchaser_email ?? null, // nil on marketplace; populated only on whitelabel
      purchaser_name: o.purchaser_name ?? null,
      ship_date: o.ship_date ?? null,
      delivery_date: o.delivery_date ?? null,
      ship_state: addr.state ?? null,
      ship_postal: addr.postal_code ?? null,
      ship_city: addr.city ?? null,
      is_gift: !!(o.gift_message && (o.gift_message.message || o.gift_message.sender_name)),
      items,
      item_count: items.reduce((a: number, b: any) => a + b.qty, 0),
      raw: o,
    });
  }

  // Summary (live orders only)
  const live = rows.filter((r) => !r.cancelled);
  const byDay: Record<string, { orders: number; revenue_cents: number }> = {};
  const byCode: Record<string, number> = {};
  const byProduct: Record<string, number> = {};
  for (const r of live) {
    const day = (r.completed_at ?? "").slice(0, 10) || "unknown";
    byDay[day] ??= { orders: 0, revenue_cents: 0 };
    byDay[day].orders++; byDay[day].revenue_cents += r.subtotal_cents ?? 0;
    if (r.discount_code) byCode[r.discount_code] = (byCode[r.discount_code] ?? 0) + 1;
    for (const it of r.items) byProduct[it.name] = (byProduct[it.name] ?? 0) + it.qty;
  }
  const summary = {
    window: dates[0] + " to " + dates[dates.length - 1],
    orders: live.length, cancelled: rows.length - live.length,
    revenue: (live.reduce((a, r) => a + (r.subtotal_cents ?? 0), 0) / 100).toFixed(2),
    with_email: live.filter((r) => r.purchaser_email).length,
    by_day: byDay, by_discount_code: byCode, by_product: byProduct,
    fetch_errors: fetchErrors,
  };

  if (dryrun) return new Response(JSON.stringify({ dryrun: true, ...summary }), { headers: hdr });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let upserted = 0; const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from("gb_orders").upsert(rows.slice(i, i + 100), { onConflict: "order_id" });
    if (error) errors.push(error.message); else upserted += Math.min(100, rows.length - i);
  }
  return new Response(JSON.stringify({ upserted, errors, ...summary }), { headers: hdr });
});
