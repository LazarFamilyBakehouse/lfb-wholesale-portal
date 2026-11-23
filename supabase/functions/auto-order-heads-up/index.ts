// LFB Portal - Auto-Order Heads-Up
// Runs daily right after the auto-order creator (which books each recurring
// order exactly 7 days before its delivery date). For every recurring order
// due in one week, emails Jake + Victoria:
//   "Team - in one week you have to fulfill <partner>'s order"
// Query params:
//   ?dryrun=true  -> send only to info@ with a [TEST] subject
// Secrets used: RESEND_API_KEY, JAKE_EMAIL, VICTORIA_EMAIL, DIGEST_FROM (+ SUPABASE_*)
import { createClient } from "npm:@supabase/supabase-js@2";
// Same product names partners see in the portal
const PRODUCT_NAMES: Record<string, string> = { "CC Mandelbites": "Chocolate-Chip MandelBites", "Confetti Mandelbites": "Confetti MandelBites", "Confetti": "Confetti MandelBites", "Gluten-Free Chocolate-Chip": "Gluten-Free Chocolate-Chip MandelBites", "Almond": "Almond MandelBites", "Two Pack Chocolate Chip": "Two-Pack Chocolate Chip", "Indiv. Mandel - Chocolate Chip": "Individual Mandel Bread - Chocolate Chip", "Indiv. Mandel - Almond": "Individual Mandel Bread - Almond", "Indiv. Mandel - GF Choc Chip": "Individual Mandel Bread - Gluten-Free Chocolate Chip" };

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const JAKE = (Deno.env.get("JAKE_EMAIL") ?? "info@lazarfamilybakehouse.com").trim();
const VICTORIA = (Deno.env.get("VICTORIA_EMAIL") || "victoria@lazarfamilybakehouse.com").trim();
const FROM_EMAIL = Deno.env.get("DIGEST_FROM") ?? "orders@lazarfamilybakehouse.com";
const LOGO = "https://partners.lazarfamilybakehouse.com/images/lfb-logo-transparent.png";
const PORTAL = "https://partners.lazarfamilybakehouse.com";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const dryrun = u.searchParams.get("dryrun") === "true";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const target = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  // Recurring orders are auto-created with this notes marker, 7 days ahead.
  const { data: orders, error } = await sb.from("orders")
    .select("id, invoice_num, retailer_id, delivery_date, total, notes, order_items(product, qty)")
    .eq("delivery_date", target)
    .ilike("notes", "%auto-order%");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({ sent: 0, due_on: target, message: "No recurring orders due in one week." }), { headers: { "Content-Type": "application/json" } });
  }

  const ids = [...new Set(orders.map((o: any) => o.retailer_id))];
  const { data: rets } = await sb.from("retailers").select("id, name").in("id", ids);
  const nameOf: Record<number, string> = Object.fromEntries((rets ?? []).map((r: any) => [r.id, r.name]));
  const fmtDate = new Date(target + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const cards = orders.map((o: any) => {
    const who = nameOf[o.retailer_id] ?? "Partner";
    const items = (o.order_items ?? []).map((i: any) => "<li style='margin:2px 0;'>" + Math.round(Number(i.qty)) + "&times; " + (PRODUCT_NAMES[i.product] || i.product) + "</li>").join("");
    const inv = o.invoice_num ? "INV-" + String(o.invoice_num).padStart(4, "0") : "order #" + o.id;
    return "<div style='background:#fff;border:1px solid #e4d8c8;border-radius:10px;padding:14px 18px;margin:10px 0;'>" +
      "<div style='font-weight:700;color:#2d1b0e;font-size:16px;'>" + who + " <span style='font-weight:400;color:#7a6a58;font-size:13px;'>(" + inv + ")</span></div>" +
      "<ul style='margin:8px 0 6px;padding-left:20px;color:#2d1b0e;'>" + items + "</ul>" +
      "<div style='color:#7a6a58;font-size:14px;'>Total: <strong style='color:#2d1b0e;'>$" + (Number(o.total) || 0).toFixed(2) + "</strong></div>" +
      "</div>";
  }).join("");

  const many = orders.length > 1;
  const html = "<div style='font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fdf6ee;padding:24px;border-radius:12px;'>" +
    "<img src='" + LOGO + "' width='150' alt='Lazar Family Bakehouse' style='display:block;margin:0 auto 14px;'>" +
    "<h2 style='color:#8b1e1e;margin:0 0 8px;'>&#9200; One week out</h2>" +
    "<p style='color:#2d1b0e;margin:0 0 12px;'>Team &mdash; in one week, on <strong>" + fmtDate + "</strong>, you have to fulfill " +
    (many ? "these " + orders.length + " recurring orders:" : "this recurring order:") + "</p>" +
    cards +
    "<p style='color:#7a6a58;font-size:14px;margin:14px 0 0;'>" + (many ? "They're" : "It's") + " already on the books as <strong>Pending</strong> &mdash; review and confirm in the <a href='" + PORTAL + "' style='color:#8b1e1e;'>portal</a>.</p>" +
    "<p style='color:#b0a08c;font-size:12px;margin-top:16px;'>Sent automatically by the LFB Partner Portal.</p></div>";

  const names = orders.map((o: any) => nameOf[o.retailer_id] ?? "Partner").join(", ");
  const to = dryrun ? ["info@lazarfamilybakehouse.com"] : [JAKE, VICTORIA].filter(Boolean);
  const subject = (dryrun ? "[TEST] " : "") + "⏰ One week out: fulfill " + names + " on " + fmtDate;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Lazar Family Bakehouse <" + FROM_EMAIL + ">", to, subject, html }),
  });
  const out = await res.json();
  return new Response(JSON.stringify({ sent: 1, to, due_on: target, orders: orders.length, resend: out }), { headers: { "Content-Type": "application/json" } });
});
