// LFB Weekly Reminder Edge Function
// Sends a friendly restock reminder to retailers who haven't ordered in 7+ days.
// Trigger: pg_cron (automatic weekly) or manual via admin portal button.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "Lazar Family Bakehouse <orders@lazarfamilybakehouse.com>";
const REPLY_TO = "info@lazarfamilybakehouse.com";
const PORTAL_URL = "https://partners.lazarfamilybakehouse.com";
const LOGO_URL = "https://www.lazarfamilybakehouse.com/cdn/shop/files/New-Logo.svg";

serve(async (req: Request) => {
  // Allow CORS for portal calls
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
      },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Get all active retailers with email addresses
    const { data: retailers, error: retErr } = await supabase
      .from("retailers")
      .select("id, name, contact, email")
      .eq("status", "Active")
      .neq("email", "");

    if (retErr) throw retErr;
    if (!retailers?.length) {
      return jsonResp({ sent: 0, message: "No active retailers with emails." });
    }

    // 2. Get orders from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split("T")[0];

    const { data: recentOrders, error: ordErr } = await supabase
      .from("orders")
      .select("retailer_id")
      .gte("order_date", cutoff);

    if (ordErr) throw ordErr;

    // 3. Find retailers who HAVEN'T ordered in 7+ days
    const recentOrdererIds = new Set(
      (recentOrders || []).map((o: any) => o.retailer_id)
    );
    const needsReminder = retailers.filter(
      (r: any) => !recentOrdererIds.has(r.id) && r.email
    );

    if (!needsReminder.length) {
      return jsonResp({ sent: 0, message: "All retailers ordered recently!" });
    }

    // 4. Send reminder emails via Resend
    let sent = 0;
    const errors: string[] = [];

    for (const retailer of needsReminder) {
      const firstName = (retailer.contact || retailer.name || "").split(" ")[0] || "Partner";
      const html = buildEmailHtml(firstName, retailer.name);

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [retailer.email],
            reply_to: REPLY_TO,
            subject: "Time to Restock? Your Weekly Reminder from Lazar Family Bakehouse",
            html,
          }),
        });

        if (res.ok) {
          sent++;
        } else {
          const errBody = await res.text();
          errors.push(`${retailer.name}: ${errBody}`);
        }
      } catch (e: any) {
        errors.push(`${retailer.name}: ${e.message}`);
      }
    }

    // 5. Log results
    console.log(
      `[LFB Reminder] Sent ${sent}/${needsReminder.length} emails. Errors: ${errors.length}`
    );

    return jsonResp({
      sent,
      total: needsReminder.length,
      skipped: retailers.length - needsReminder.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[LFB Reminder] Error:", err);
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function buildEmailHtml(firstName: string, storeName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Restock Reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#fdf6ee;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#2d1b0e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="text-align:center;padding-bottom:24px;border-bottom:2px solid #e4d8c8;">
      <img src="${LOGO_URL}" alt="Lazar Family Bakehouse" width="180" style="margin-bottom:16px;"/>
      <h1 style="font-family:Georgia,'Playfair Display',serif;font-size:22px;color:#2d1b0e;margin:0;">
        Time to Restock?
      </h1>
    </div>

    <!-- Body -->
    <div style="padding:28px 0;">
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
        Hi ${firstName},
      </p>
      <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
        It's been about a week since your last order — just a friendly nudge to check your stock levels
        for <strong>${storeName}</strong>. Our Mandelbites, Mandel Bread, and Two-Packs are moving fast
        with your customers, and we'd hate for you to run low!
      </p>
      <p style="font-size:16px;line-height:1.7;margin:0 0 24px;">
        Placing a new order takes just a minute through your partner portal:
      </p>

      <!-- CTA Button -->
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${PORTAL_URL}" style="display:inline-block;background:#3a2518;color:#ffffff;text-decoration:none;padding:14px 36px;font-size:16px;font-weight:700;letter-spacing:.04em;">
          Place an Order
        </a>
      </div>

      <p style="font-size:14px;line-height:1.6;color:#5c4a3a;margin:0 0 8px;">
        As a reminder, here are our minimums:
      </p>
      <ul style="font-size:14px;line-height:1.8;color:#5c4a3a;margin:0 0 24px;padding-left:20px;">
        <li>Mandelbites pouches — 8 units (increments of 8)</li>
        <li>Two-Pack — 25 units (increments of 25)</li>
        <li>Individual pieces — 40 units (increments of 40)</li>
      </ul>

      <p style="font-size:16px;line-height:1.7;margin:0;">
        Thank you for being part of the Lazar Family Bakehouse family. We truly appreciate
        your partnership!
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top:2px solid #e4d8c8;padding-top:20px;text-align:center;">
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">
        Lazar Family Bakehouse · Greenwood Village, CO
      </p>
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">
        <a href="mailto:info@lazarfamilybakehouse.com" style="color:#3a2518;text-decoration:underline;">
          info@lazarfamilybakehouse.com
        </a>
      </p>
      <p style="font-size:11px;color:#8a7968;margin:12px 0 0;">
        You're receiving this because you're a wholesale partner.
        To opt out, reply to this email or contact us directly.
      </p>
    </div>

  </div>
</body>
</html>`;
}
