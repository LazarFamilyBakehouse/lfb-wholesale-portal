// LFB Portal - Goldbelly API Sync (v2)
// Pulls orders straight from the Goldbelly 3PL API (no browser needed)
// and creates/updates gb_ship events on the portal calendar.
//   - The API only answers per ship date, so we sweep a window:
//     2 days back through 45 days ahead (order date changes get caught)
//   - One calendar event per package line on each order
//   - Pick Your Mix orders include the customer's chosen mix in notes
//   - Never touches events marked done; never duplicates (keyed on GB #order_id)
// Secrets used: GOLDBELLY_API_KEY (+ standard SUPABASE_* vars)
// Query params: ?start=YYYY-MM-DD&days=N  (override the sweep window)
import { createClient } from "npm:@supabase/supabase-js@2";
const GB_KEY = Deno.env.get("GOLDBELLY_API_KEY");

function slugFor(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (n.includes("grandma jeanne")) return "grandma-jeanne-sampler";
  if (n.includes("shabbat")) return "the-shabbat-mandelbites-box";
  if (n.includes("pick your mix") || n.includes("pick-your-mix")) return "mandelbites-pick-your-mix-6-pack";
  if (n.includes("treat the office")) return "treat-the-office";
  if (n.includes("tour")) return "bakehouse-tour";
  return null;
}
function dstr(d: Date): string { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  if (!GB_KEY) return new Response(JSON.stringify({ error: "GOLDBELLY_API_KEY secret not set" }), { status: 500, headers: { "Content-Type": "application/json" } });
  const u = new URL(req.url);
  const days = Math.min(Number(u.searchParams.get("days")) || 45, 90);
  const start = u.searchParams.get("start") ? new Date(u.searchParams.get("start") + "T12:00:00Z") : new Date(Date.now() - 2 * 864e5);
  const dates: string[] = [];
  for (let i = 0; i <= days; i++) { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); dates.push(dstr(d)); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Fetch each ship date (batches of 8 so the whole sweep stays fast)
  const orders: any[] = [];
  const fetchErrors: string[] = [];
  for (let i = 0; i < dates.length; i += 8) {
    const batch = dates.slice(i, i + 8);
    const results = await Promise.all(batch.map(async (ds) => {
      try {
        const r = await fetch("https://api.goldbelly.com/v1/orders?ship_date=" + ds, { headers: { Authorization: "Bearer " + GB_KEY } });
        if (!r.ok) { fetchErrors.push(ds + ": HTTP " + r.status); return []; }
        const j = await r.json();
        return Array.isArray(j) ? j : (j.data ?? []);
      } catch (e) { fetchErrors.push(ds + ": " + (e as Error).message); return []; }
    }));
    for (const arr of results) orders.push(...arr);
  }

  let created = 0, updated = 0, skipped = 0;
  const details: string[] = [];
  for (const o of orders) {
    const status = ((o.status ?? "") + " " + (o.merchant_status ?? "")).toLowerCase();
    if (status.includes("cancel")) { skipped++; continue; }
    const num = o.order_id;
    const addr = o.shipping_address ?? {};
    const recipient = [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "Goldbelly customer";
    const shipDate = o.ship_date;
    if (!num || !shipDate) { skipped++; continue; }
    for (const p of o.products ?? []) {
      const slug = slugFor(p.name);
      const qty = Math.round(Number(p.quantity)) || 1;
      const isMix = slug === "mandelbites-pick-your-mix-6-pack";
      const mix = isMix ? (p.subproducts ?? []).filter((s: any) => s && s.name).map((s: any) => Math.round(Number(s.quantity)) + "x " + s.name).join(", ") : "";
      const notes = ["Synced from Goldbelly API", p.sku ? "SKU " + p.sku : "", mix ? "Customer's mix: " + mix : ""].filter(Boolean).join(" - ");
      const title = recipient + " - GB #" + num + (slug ? "" : " - " + (p.name ?? "package"));
      let q = sb.from("calendar_events").select("id, event_date, qty, done").eq("type", "gb_ship").ilike("title", "%GB #" + num + "%");
      if (slug) q = q.eq("package_key", slug);
      const { data: existing, error: exErr } = await q;
      if (exErr) { details.push("lookup failed for #" + num + ": " + exErr.message); continue; }
      if (existing && existing.length > 0) {
        const ev = existing[0];
        if (ev.event_date !== shipDate || (ev.qty ?? 1) !== qty) {
          const { error } = await sb.from("calendar_events").update({ event_date: shipDate, qty: qty }).eq("id", ev.id);
          if (!error) { updated++; details.push("updated #" + num + " -> " + shipDate); }
        }
      } else {
        const { error } = await sb.from("calendar_events").insert({ event_date: shipDate, type: "gb_ship", title: title, package_key: slug, qty: qty, notes: notes, done: false });
        if (!error) { created++; details.push("created #" + num + " (" + (slug ?? p.name) + ") ship " + shipDate); }
        else details.push("insert failed for #" + num + ": " + error.message);
      }
    }
  }
  return new Response(JSON.stringify({ window: dates[0] + " to " + dates[dates.length - 1], orders_found: orders.length, created, updated, skipped_cancelled: skipped, fetch_errors: fetchErrors, details }), { headers: { "Content-Type": "application/json" } });
});
