// LFB Portal - "We received your order" email to the partner
// Called by the partner portal right after a partner submits an order.
// Body: { order_id, retailer_id, pin, dryrun? }
//   - Checks the partner's PIN and that the order is theirs
//   - Only for orders created in the last 2 hours, and only once per order
//   - dryrun:true sends the email to info@ instead of the partner (for testing)
// Sends through Resend from orders@lazarfamilybakehouse.com (same as the reminders).
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
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
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + (Number(n) || 0).toFixed(2);
function pretty(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const orderId = Number(body.order_id), retailerId = Number(body.retailer_id), pin = String(body.pin ?? "");
  const dryrun = body.dryrun === true;
  if (!orderId || !retailerId || !pin) return json({ ok: false, error: "missing fields" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: r } = await sb.from("retailers").select("id,name,contact,email,pin").eq("id", retailerId).single();
  if (!r || String(r.pin ?? "") !== pin) return json({ ok: false, error: "not authorized" }, 403);

  const { data: o } = await sb.from("orders")
    .select("id,retailer_id,order_date,delivery_date,notes,total,created_at,received_email_sent_at,order_items(product,qty,unit_price,subtotal)")
    .eq("id", orderId).single();
  if (!o || o.retailer_id !== retailerId) return json({ ok: false, error: "order not found" }, 404);
  if (!dryrun) {
    if (o.received_email_sent_at) return json({ ok: true, skipped: "already sent" });
    if (Date.now() - new Date(o.created_at).getTime() > 2 * 3600e3) return json({ ok: true, skipped: "order too old" });
  }

  const to = String(r.email ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!to.length && !dryrun) return json({ ok: true, skipped: "no email on file" });

  const items = (o.order_items ?? []).filter((i: any) => !FEE_PRODUCTS.includes(i.product));
  const fees = (o.order_items ?? []).filter((i: any) => FEE_PRODUCTS.includes(i.product));
  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const feeTotal = fees.reduce((s: number, i: any) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const firstName = (r.contact || "").trim().split(/\s+/)[0] || "there";
  const wantsDate = o.delivery_date && o.delivery_date !== o.order_date ? pretty(o.delivery_date) : "";
  const notes = o.notes && !/^(Submitted via partner portal|Placed from standing order)/i.test(o.notes) ? o.notes : "";

  const html = buildHtml({ firstName, store: r.name, items, fees, subtotal, total: subtotal + feeTotal, placed: pretty(o.order_date), wantsDate, notes });
  const subject = `We received your order - Lazar Family Bakehouse`;
  const payload: any = {
    from: FROM_EMAIL,
    to: dryrun ? [DRYRUN_TO] : to,
    reply_to: REPLY_TO,
    subject: dryrun ? `[TEST for ${r.name}] ${subject}` : subject,
    html,
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return json({ ok: false, error: "email failed", detail: (await res.text()).slice(0, 300) }, 502);
  if (!dryrun) await sb.from("orders").update({ received_email_sent_at: new Date().toISOString() }).eq("id", orderId);
  return json({ ok: true, sent_to: dryrun ? "test inbox" : to.length + " address(es)", dryrun });
});

function buildHtml(d: { firstName: string; store: string; items: any[]; fees: any[]; subtotal: number; total: number; placed: string; wantsDate: string; notes: string }): string {
  const td = "padding:10px 8px;border-bottom:1px solid #efe3d6;font-size:14px;";
  const rows = d.items.map((i) => `<tr>
      <td style="${td}">${esc(NAMES[i.product] || i.product)}</td>
      <td style="${td}text-align:center;">${Number(i.qty) || 0}</td>
      <td style="${td}text-align:right;">${money(i.unit_price)}</td>
      <td style="${td}text-align:right;font-weight:700;">${money((Number(i.qty) || 0) * (Number(i.unit_price) || 0))}</td></tr>`).join("");
  const feeRows = d.fees.map((f) => `<tr><td colspan="3" style="${td}text-align:right;color:#5c4a3a;">${esc(f.product === "Shipping" ? "Shipping" : "Delivery fee")}</td><td style="${td}text-align:right;">${money(f.unit_price)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#fdf6ee;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#2d1b0e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;padding-bottom:24px;border-bottom:2px solid #ff0000;">
      <img src="${LOGO_URL}" alt="Lazar Family Bakehouse" width="180" style="margin-bottom:16px;"/>
      <h1 style="font-family:Georgia,'Playfair Display',serif;font-size:22px;color:#2d1b0e;margin:0;">We Received Your Order</h1>
    </div>
    <div style="padding:28px 0;">
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">Hi ${esc(d.firstName)},</p>
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
        Thank you for your order! We received it from <strong>${esc(d.store)}</strong> on ${esc(d.placed)}.
        Here's a copy for your records.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
        <thead><tr style="background:#3a2518;color:#ffffff;">
          <th style="padding:10px 8px;text-align:left;font-size:13px;">Product</th>
          <th style="padding:10px 8px;text-align:center;font-size:13px;">Qty</th>
          <th style="padding:10px 8px;text-align:right;font-size:13px;">Unit</th>
          <th style="padding:10px 8px;text-align:right;font-size:13px;">Subtotal</th></tr></thead>
        <tbody>${rows}${feeRows}</tbody>
        <tfoot><tr><td colspan="3" style="padding:12px 8px;text-align:right;font-weight:700;font-size:15px;">Estimated total</td>
          <td style="padding:12px 8px;text-align:right;font-weight:700;font-size:15px;">${money(d.total)}</td></tr></tfoot>
      </table>
      <div style="background-color:#fff8f0;border:1px solid #e8d5c0;border-radius:6px;padding:16px 20px;margin:18px 0 22px;font-size:14px;line-height:1.7;">
        ${d.wantsDate ? `<div><strong>Requested delivery:</strong> ${esc(d.wantsDate)}</div>` : ""}
        ${d.notes ? `<div><strong>Your notes:</strong> ${esc(d.notes)}</div>` : ""}
        <div><strong>What's next:</strong> we'll review your order and send a confirmation with your delivery date and invoice number, usually within one business day.</div>
      </div>
      <p style="font-size:16px;line-height:1.7;margin:0 0 24px;">
        Need to change something? Just reply to this email and we'll take care of it.
      </p>
      <div style="text-align:center;margin:0 0 8px;">
        <a href="${PORTAL_URL}" style="display:inline-block;background:#3a2518;color:#ffffff;text-decoration:none;padding:14px 36px;font-size:16px;font-weight:700;letter-spacing:.04em;">View Your Orders</a>
      </div>
    </div>
    <div style="border-top:2px solid #ff0000;padding-top:20px;text-align:center;">
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">Lazar Family Bakehouse · Englewood, CO</p>
      <p style="font-size:13px;color:#5c4a3a;margin:0;"><a href="mailto:info@lazarfamilybakehouse.com" style="color:#3a2518;text-decoration:underline;">info@lazarfamilybakehouse.com</a></p>
    </div>
  </div>
</body></html>`;
}
