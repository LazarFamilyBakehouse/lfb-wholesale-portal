// LFB Portal - "Your order has shipped" email to the partner
// Called by the admin side of the partner portal from the Shipping & Tracking
// window (Mark Shipped), after the order's tracking details are saved.
// Body: { order_id, dryrun? }
//   - Admin only: the caller must be signed in as a portal admin
//   - Reads carrier / tracking number / ship date from the order itself
//   - dryrun:true sends the email to info@ instead of the partner (for testing)
//     and does not mark the order as emailed
// Sends through Resend from orders@lazarfamilybakehouse.com (same as the reminders).
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAILS = (Deno.env.get("PORTAL_ADMIN_EMAILS") ?? "info@lazarfamilybakehouse.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const FROM_EMAIL = "Lazar Family Bakehouse <orders@lazarfamilybakehouse.com>";
const REPLY_TO = "info@lazarfamilybakehouse.com";
const DRYRUN_TO = "info@lazarfamilybakehouse.com";
const PORTAL_URL = "https://partners.lazarfamilybakehouse.com";
const LOGO_URL = "https://partners.lazarfamilybakehouse.com/images/lfb-logo-transparent.png";
const FEE_PRODUCTS = ["Delivery", "Shipping"];
const NAMES: Record<string, string> = {
  "Confetti": "Confetti MandelBites",
  "Almond": "Almond MandelBites",
  "CC Mandelbites": "Chocolate-Chip MandelBites",
  "Confetti Mandelbites": "Confetti MandelBites",
  "Gluten-Free Chocolate-Chip": "Gluten-Free Chocolate-Chip MandelBites",
  "Indiv. Mandel - Chocolate Chip": "Individual Mandel Bread - Chocolate Chip",
  "Indiv. Mandel - Almond": "Individual Mandel Bread - Almond",
  "Indiv. Mandel - Confetti": "Individual Mandel Bread - Confetti",
  "Indiv. Mandel - GF Choc Chip": "Individual Mandel Bread - Gluten-Free Chocolate Chip",
  "Two Pack Chocolate Chip": "Two-Pack Chocolate Chip",
};
// Same carriers and tracking pages as the portal
const CARRIERS: Record<string, { label: string; url: ((n: string) => string) | null }> = {
  USPS: { label: "USPS", url: (n) => "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + encodeURIComponent(n) },
  UPS: { label: "UPS", url: (n) => "https://www.ups.com/track?tracknum=" + encodeURIComponent(n) },
  FedEx: { label: "FedEx", url: (n) => "https://www.fedex.com/fedextrack/?trknbr=" + encodeURIComponent(n) },
  Other: { label: "", url: null },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function pretty(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
const invNum = (n: number | null) => (n && n > 0 ? "INV-" + String(n).padStart(4, "0") : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const orderId = Number(body.order_id);
  const dryrun = body.dryrun === true;
  if (!orderId) return json({ ok: false, error: "missing order" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Only a signed-in portal admin may send this
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await sb.auth.getUser(jwt);
  const callerEmail = (who?.user?.email ?? "").toLowerCase();
  if (!callerEmail || !ADMIN_EMAILS.includes(callerEmail)) return json({ ok: false, error: "not authorized" }, 403);

  const { data: o } = await sb.from("orders")
    .select("id,retailer_id,invoice_num,status,tracking_number,tracking_carrier,shipped_at,order_items(product,qty)")
    .eq("id", orderId).single();
  if (!o) return json({ ok: false, error: "order not found" }, 404);
  if (!o.shipped_at && !o.tracking_number) return json({ ok: false, error: "order is not marked as shipped" }, 400);

  const { data: r } = await sb.from("retailers").select("id,name,contact,email").eq("id", o.retailer_id).single();
  if (!r) return json({ ok: false, error: "partner not found" }, 404);
  const to = String(r.email ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!to.length && !dryrun) return json({ ok: false, error: "no email on file for this partner" }, 400);

  const carrier = CARRIERS[o.tracking_carrier ?? ""] ?? CARRIERS.Other;
  const number = String(o.tracking_number ?? "").trim();
  const trackUrl = number && carrier.url ? carrier.url(number) : "";
  const items = (o.order_items ?? []).filter((i: any) => !FEE_PRODUCTS.includes(i.product));
  const firstName = (r.contact || "").trim().split(/\s+/)[0] || "there";
  const inv = invNum(o.invoice_num);

  const html = buildHtml({ firstName, store: r.name, inv, carrier: carrier.label, number, trackUrl, shipped: pretty(o.shipped_at), items });
  const subject = `Your order${inv ? " " + inv : ""} has shipped - Lazar Family Bakehouse`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: dryrun ? [DRYRUN_TO] : to,
      reply_to: REPLY_TO,
      subject: dryrun ? `[TEST for ${r.name}] ${subject}` : subject,
      html,
    }),
  });
  if (!res.ok) return json({ ok: false, error: "email failed", detail: (await res.text()).slice(0, 300) }, 502);
  if (!dryrun) await sb.from("orders").update({ shipped_email_sent_at: new Date().toISOString() }).eq("id", orderId);
  return json({ ok: true, sent_to: dryrun ? "test inbox" : to.length + " address(es)", dryrun });
});

function buildHtml(d: { firstName: string; store: string; inv: string; carrier: string; number: string; trackUrl: string; shipped: string; items: any[] }): string {
  const td = "padding:9px 8px;border-bottom:1px solid #efe3d6;font-size:14px;";
  const rows = d.items.map((i) => `<tr>
      <td style="${td}">${esc(NAMES[i.product] || i.product)}</td>
      <td style="${td}text-align:right;">${Number(i.qty) || 0}</td></tr>`).join("");
  const line = (label: string, value: string) => value ? `<div><strong>${label}:</strong> ${value}</div>` : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#fdf6ee;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#2d1b0e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;padding-bottom:24px;border-bottom:2px solid #ff0000;">
      <img src="${LOGO_URL}" alt="Lazar Family Bakehouse" width="180" style="margin-bottom:16px;"/>
      <h1 style="font-family:Georgia,'Playfair Display',serif;font-size:22px;color:#2d1b0e;margin:0;">Your Order Has Shipped</h1>
    </div>
    <div style="padding:28px 0;">
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">Hi ${esc(d.firstName)},</p>
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
        Good news! Your order for <strong>${esc(d.store)}</strong> is on its way${d.shipped ? `. It shipped on ${esc(d.shipped)}` : ""}.
      </p>
      <div style="background-color:#fff8f0;border:1px solid #e8d5c0;border-radius:6px;padding:16px 20px;margin:0 0 22px;font-size:15px;line-height:1.8;">
        ${line("Order", esc(d.inv))}
        ${line("Carrier", esc(d.carrier))}
        ${line("Tracking number", d.number ? `<span style="font-family:Menlo,Consolas,monospace;letter-spacing:.03em;">${esc(d.number)}</span>` : "")}
        ${d.number ? "" : `<div>We don't have a tracking number for this shipment. Reply to this email if you'd like an update.</div>`}
      </div>
      ${d.trackUrl ? `<div style="text-align:center;margin:0 0 10px;">
        <a href="${d.trackUrl}" style="display:inline-block;background:#3a2518;color:#ffffff;text-decoration:none;padding:14px 36px;font-size:16px;font-weight:700;letter-spacing:.04em;">Track Your Package</a>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#5c4a3a;text-align:center;margin:0 0 24px;">Tracking can take up to a day to start updating after a package ships.</p>` : ""}
      ${rows ? `<table style="width:100%;border-collapse:collapse;margin:0 0 22px;">
        <thead><tr style="background:#3a2518;color:#ffffff;">
          <th style="padding:9px 8px;text-align:left;font-size:13px;">In this shipment</th>
          <th style="padding:9px 8px;text-align:right;font-size:13px;">Qty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : ""}
      <p style="font-size:16px;line-height:1.7;margin:0;">
        Questions about your shipment? Just reply to this email. You can also see this order any time in your <a href="${PORTAL_URL}" style="color:#3a2518;font-weight:700;">partner portal</a>.
      </p>
    </div>
    <div style="border-top:2px solid #ff0000;padding-top:20px;text-align:center;">
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">Lazar Family Bakehouse · Englewood, CO</p>
      <p style="font-size:13px;color:#5c4a3a;margin:0;"><a href="mailto:info@lazarfamilybakehouse.com" style="color:#3a2518;text-decoration:underline;">info@lazarfamilybakehouse.com</a></p>
    </div>
  </div>
</body></html>`;
}
