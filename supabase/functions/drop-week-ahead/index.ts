// LFB Portal - Week-Ahead Digest + Day-Before Reminders (v2: per-person)
// Two modes, one function:
//   (no params)      -> Sunday 3 PM MT: the full week ahead, to Jake + Victoria
//   ?mode=tomorrow   -> daily 3 PM MT: what's happening tomorrow, with
//                      type-specific subjects, split by assignee:
//                      events marked "jake" only email Jake, "victoria" only
//                      Victoria, "both" (and all orders/Goldbelly/auto-orders)
//                      email everyone. Identical emails collapse into one send.
// Items marked done send NO day-before reminder and show crossed out Sunday.
import { createClient } from "npm:@supabase/supabase-js@2";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RECIPIENTS = (Deno.env.get("DIGEST_RECIPIENTS") ?? "info@lazarfamilybakehouse.com").split(",").map(s => s.trim()).filter(Boolean);
const JAKE_EMAIL = Deno.env.get("JAKE_EMAIL") ?? "info@lazarfamilybakehouse.com";
const VICTORIA_EMAIL = Deno.env.get("VICTORIA_EMAIL") ?? "victoria@lazarfamilybakehouse.com";
const FROM_EMAIL = Deno.env.get("DIGEST_FROM") ?? "orders@lazarfamilybakehouse.com";
const GB_SUMMARY: Record<string, string> = { "grandma-jeanne-sampler": "Grandma Jeanne's Sampler - each box: 1 bag Chocolate-Chip, 1 Almond, 1 Funfetti, 1 Gluten-Free CC + 2 Mandel Bread two-packs + thank-you card", "the-shabbat-mandelbites-box": "Shabbat Box - each box: 2 bags Chocolate-Chip, 1 Almond, 1 Gluten-Free CC + thank-you card", "mandelbites-pick-your-mix-6-pack": "Pick Your Mix 6-Pack - 6 bags in the MIX THE CUSTOMER CHOSE (check the Goldbelly order slip!)", "treat-the-office": "Treat the Office - 24 little pouches of Chocolate-Chip Mandel Bread (2 pieces each)", "bakehouse-tour": "Bakehouse Tour - 2 bags of EVERY flavor (8 bags total) + thank-you card" };
const DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function mtToday(): Date { const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" })); now.setHours(12,0,0,0); return now; }
function dstr(d: Date): string { return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function pretty(ds: string): string { const p = ds.split("-").map(Number); const dt = new Date(p[0], p[1]-1, p[2]); return DOW[dt.getDay()] + ", " + dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function projectAO(ao: any, dates: string[]): string[] { const dow = DOW.indexOf(ao.day); if (dow < 0) return []; const startD = ao.start_date ? new Date(ao.start_date + "T12:00:00") : null; return dates.filter(ds => { const p = ds.split("-").map(Number); const dt = new Date(p[0], p[1]-1, p[2], 12); if (dt.getDay() !== dow) return false; if (startD && dt < startD) return false; if (ao.freq === "Weekly") return true; if (ao.freq === "Bi-Weekly") { const anchor = startD ?? dt; return Math.round((dt.getTime() - anchor.getTime()) / (7*864e5)) % 2 === 0; } const nth = startD ? Math.ceil(startD.getDate()/7) : 1; return Math.ceil(p[2]/7) === nth; }); }
Deno.serve(async (req) => {
const mode = new URL(req.url).searchParams.get("mode") ?? "week";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const base = mtToday(); if (mode === "tomorrow") base.setDate(base.getDate() + 1);
const span = mode === "tomorrow" ? 1 : 7;
const dates: string[] = []; for (let i = 0; i < span; i++) { const d = new Date(base); d.setDate(base.getDate() + i); dates.push(dstr(d)); }
const d0 = dates[0]; const dl = dates[dates.length - 1];
const { data: orders } = await sb.from("orders").select("id, invoice_num, retailer_id, delivery_date, status, total, order_items(product, qty)").gte("delivery_date", d0).lte("delivery_date", dl).neq("status", "Pending");
const { data: retailers } = await sb.from("retailers").select("id, name");
const rName = new Map((retailers ?? []).map((r: any) => [r.id, r.name]));
const { data: events } = await sb.from("calendar_events").select("*").gte("event_date", d0).lte("event_date", dl);
const { data: aos } = await sb.from("auto_orders").select("*").eq("active", true);
type Item = { ds: string; sort: number; html: string; who: string };
const items: Item[] = [];
const add = (ds: string, sort: number, html: string, who = "both") => { items.push({ ds, sort, html, who }); };
const whoName = (w: string) => w === "jake" ? "Jake" : w === "victoria" ? "Victoria" : "";
for (const o of orders ?? []) { const what = (o.order_items ?? []).map((i: any) => i.qty + "x " + i.product).join(", "); add(o.delivery_date, 1, "<strong>📦 Deliver to " + (rName.get(o.retailer_id) ?? "?") + "</strong> - INV-" + String(o.invoice_num).padStart(4, "0") + " - $" + Number(o.total).toFixed(2) + (what ? "<br><span style='color:#7a6a58;font-size:13px;'>What is in it: " + what + "</span>" : "")); }
for (const e of events ?? []) { if (e.done && mode === "tomorrow") continue; const who = (e.assignee === "jake" || e.assignee === "victoria") ? e.assignee : "both"; const tag = (mode === "week" && who !== "both") ? " <em style='color:#8a7a68;font-size:12px;'>(" + whoName(who) + ")</em>" : ""; const noteLine = (e.notes && e.type !== "gb_ship") ? "<br><span style='color:#7a6a58;font-size:13px;'>✎ " + e.notes + "</span>" : ""; const dp = e.done ? "✓ <span style='text-decoration:line-through;opacity:.6;'>" : ""; const dsx = e.done ? "</span>" : ""; if (e.type === "gb_ship") { const s = GB_SUMMARY[e.package_key ?? ""] ?? e.title ?? "Goldbelly package"; const q = e.qty ?? 1; add(e.event_date, 0, dp + "<strong style='color:#c0392b;'>🚚 SHIP GOLDBELLY: " + q + " box" + (q > 1 ? "es" : "") + "</strong><br><span style='color:#7a6a58;font-size:13px;'>" + s + (q > 1 ? " - ship " + q + " of these" : "") + "</span>" + (e.title ? "<br><span style='color:#7a6a58;font-size:13px;'>📝 " + e.title + "</span>" : "") + dsx); } else if (e.type === "bake") { add(e.event_date, 2, dp + "<strong style='color:#8b6914;'>🍞 Bake day</strong>" + (e.title ? " - " + e.title : "") + tag + noteLine + dsx, who); } else if (e.type === "media") { add(e.event_date, 3, dp + "<strong style='color:#7b5ea7;'>📸 Media</strong>" + (e.title ? " - " + e.title : "") + tag + noteLine + dsx, who); } else if (e.type === "prospect") { add(e.event_date, 3, dp + "<strong style='color:#1f7a72;'>🤝 Potential partner drop/ship</strong>" + (e.title ? " - " + e.title : "") + tag + noteLine + dsx, who); } else { add(e.event_date, 3, dp + "📝 " + (e.title || "Note") + tag + noteLine + dsx, who); } }
for (const ao of aos ?? []) { for (const ds of projectAO(ao, dates)) { const what = (ao.products ?? []).map((p: any) => p.qty + "x " + p.product).join(", "); add(ds, 4, "<em style='color:#8a7a68;'>🔄 " + ao.retailer_name + " auto-order due (" + ao.freq + ")</em>" + (what ? "<br><span style='color:#7a6a58;font-size:13px;'>Usual order: " + what + " - open the portal to create it</span>" : "")); } }
function buildEmail(mine: Item[]) {
  const byDay = new Map<string, Item[]>();
  for (const it of mine) { if (!byDay.has(it.ds)) byDay.set(it.ds, []); byDay.get(it.ds)!.push(it); }
  let daysHtml = ""; let total = 0;
  for (const ds of dates) { const list = (byDay.get(ds) ?? []).sort((a, b) => a.sort - b.sort); total += list.length; daysHtml += "<tr><td style='padding:10px 14px;border-bottom:1px solid #e4d8c8;vertical-align:top;white-space:nowrap;'><strong>" + pretty(ds) + "</strong></td><td style='padding:10px 14px;border-bottom:1px solid #e4d8c8;'>" + (list.length ? list.map(i => "<div style='margin:4px 0;'>" + i.html + "</div>").join("") : "<span style='color:#b0a08c;'>Nothing scheduled</span>") + "</td></tr>"; }
  const day0 = byDay.get(d0) ?? []; const nGb = day0.filter(i => i.sort === 0).length; const nDel = day0.filter(i => i.sort === 1).length; const nBake = day0.filter(i => i.sort === 2).length;
  let heading = "🗓 The Week Ahead"; let sub = "🗓 Week Ahead: " + total + " item" + (total === 1 ? "" : "s") + " - " + pretty(d0);
  if (mode === "tomorrow") { const parts: string[] = []; if (nBake) parts.push(nBake === 1 ? "a bake" : nBake + " bakes"); if (nGb) parts.push(nGb === 1 ? "a Goldbelly shipment" : nGb + " Goldbelly shipments"); if (nDel) parts.push(nDel === 1 ? "a delivery" : nDel + " deliveries"); if (nBake && !nGb && !nDel) { heading = "🍞 Your bake starts tomorrow"; sub = "Reminder: your bake starts tomorrow (" + pretty(d0) + ")"; } else if (nGb && !nBake && !nDel) { const pkgs = (events ?? []).filter((e: any) => e.type === "gb_ship" && e.event_date === d0 && !e.done).map((e: any) => (e.qty ?? 1) + "x " + ((GB_SUMMARY[e.package_key ?? ""] ?? "package").split(" - ")[0])).join(", "); heading = "🚚 Shipping tomorrow"; sub = "Reminder: you're shipping " + pkgs + " tomorrow - what's included is below"; } else if (nDel && !nBake && !nGb) { heading = "📦 Delivering tomorrow"; sub = nDel === 1 ? "Reminder: you have a delivery tomorrow" : "Reminder: you have " + nDel + " deliveries tomorrow"; } else if (parts.length) { heading = "⏰ Tomorrow at the bakehouse"; sub = "Reminder for tomorrow: " + parts.join(", "); } else { heading = "⏰ Tomorrow"; sub = "Reminder: " + total + " item" + (total === 1 ? "" : "s") + " scheduled tomorrow"; } }
  const html = "<div style='font-family:Georgia,serif;max-width:640px;margin:0 auto;background:#fdf6ee;padding:24px;border-radius:12px;'><div style='text-align:center;margin-bottom:14px;'><img src='https://partners.lazarfamilybakehouse.com/images/lfb-logo-transparent.png' alt='Lazar Family Bakehouse' width='150' style='max-width:150px;height:auto;'/></div><h2 style='color:#2d1b0e;margin:0 0 4px;'>" + heading + "</h2><p style='color:#7a6a58;margin:0 0 16px;'>" + pretty(d0) + (span > 1 ? " through " + pretty(dl) : "") + " - " + total + " item" + (total === 1 ? "" : "s") + " scheduled</p><table style='width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;'>" + daysHtml + "</table><p style='color:#b0a08c;font-size:12px;margin-top:16px;'>Sent automatically by the LFB Partner Portal calendar.</p></div>";
  return { total, sub, html };
}
async function send(to: string[], sub: string, html: string) { const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Lazar Family Bakehouse <" + FROM_EMAIL + ">", to, subject: sub, html }) }); return await res.json(); }
if (mode === "week") {
  const e = buildEmail(items);
  const out = await send(RECIPIENTS, e.sub, e.html);
  return new Response(JSON.stringify({ mode, sent_to: RECIPIENTS, items: e.total, resend: out }), { headers: { "Content-Type": "application/json" } });
}
// tomorrow mode: split by person; if both see the same list, send once to both
const jakeItems = items.filter(i => i.who === "both" || i.who === "jake");
const vicItems = items.filter(i => i.who === "both" || i.who === "victoria");
const sameList = jakeItems.length === vicItems.length && jakeItems.every((it, idx) => it === vicItems[idx]);
const sent: any[] = [];
if (sameList) {
  const e = buildEmail(jakeItems);
  if (e.total === 0) return new Response(JSON.stringify({ skipped: "nothing scheduled tomorrow" }), { headers: { "Content-Type": "application/json" } });
  sent.push({ to: [JAKE_EMAIL, VICTORIA_EMAIL], items: e.total, resend: await send([JAKE_EMAIL, VICTORIA_EMAIL], e.sub, e.html) });
} else {
  for (const p of [{ email: JAKE_EMAIL, list: jakeItems }, { email: VICTORIA_EMAIL, list: vicItems }]) {
    const e = buildEmail(p.list);
    if (e.total === 0) { sent.push({ to: [p.email], skipped: true }); continue; }
    sent.push({ to: [p.email], items: e.total, resend: await send([p.email], e.sub, e.html) });
  }
}
return new Response(JSON.stringify({ mode, sent }), { headers: { "Content-Type": "application/json" } });
});
