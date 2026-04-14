// LFB Partner Reminder Edge Function
// Two tracks:
//   ?track=active   → Biweekly (2nd & 4th Tuesdays). Emails "Active" partners
//                     who haven't ordered in 14+ days. Restock nudge.
//   ?track=inactive → Monthly (2nd Tuesday only). Emails "Previously Ordered" partners.
//                     Friendly re-engagement check-in, no discount.
//   ?dryrun=true    → Routes ALL emails to dryrun_email (default: info@lazarfamilybakehouse.com).
//                     No partners receive emails. Subject prefixed with [DRY RUN].
// Triggered by pg_cron or manual via admin portal buttons.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "Lazar Family Bakehouse <orders@lazarfamilybakehouse.com>";
const REPLY_TO = "info@lazarfamilybakehouse.com";
const BCC_EMAIL = "info@lazarfamilybakehouse.com";   // you get a copy of every send
const PORTAL_URL = "https://partners.lazarfamilybakehouse.com";
const LOGO_URL = "https://partners.lazarfamilybakehouse.com/images/lfb-logo-transparent.png";

const RESTOCK_QUIET_DAYS = 14;   // don't nudge if ordered in last 14 days

// Partners excluded from biweekly active emails
const EXCLUDED_PARTNERS: string[] = [
  "Lucky's Market Boulder",
  "Lucky's Market Fort Collins",
];

serve(async (req: Request) => {
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
    // Determine track from query string or body (default: active)
    const url = new URL(req.url);
    let track = url.searchParams.get("track") || "active";
    const force = url.searchParams.get("force") === "true";
    const dryrun = url.searchParams.get("dryrun") === "true";
    const dryrunEmail = url.searchParams.get("dryrun_email") || "info@lazarfamilybakehouse.com";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.track) track = body.track;
      } catch { /* no body */ }
    }
    if (track !== "active" && track !== "inactive") track = "active";

    // ─────────────── DEFENSIVE DATE GATE (third safety layer) ───────────────
    // Refuses to send unless today is a scheduled send day.
    //   Active track  → 2nd Tuesday OR 4th Tuesday of month (day 8–14 or 22–28)
    //   Inactive track → 2nd Tuesday only (day 8–14)
    // Admin portal manual triggers must pass ?force=true to bypass.
    if (!force) {
      const now = new Date();
      const dow = now.getUTCDay();   // 0 = Sun, 2 = Tue
      const dom = now.getUTCDate();
      const isTuesday = dow === 2;
      const is2ndTue = isTuesday && dom >= 8 && dom <= 14;
      const is4thTue = isTuesday && dom >= 22 && dom <= 28;

      if (track === "active" && !(is2ndTue || is4thTue)) {
        return jsonResp({
          sent: 0,
          track,
          skipped: true,
          reason: `Blocked by date gate. Active track only fires on the 2nd or 4th Tuesday of the month. Today (UTC) is ${now.toISOString().slice(0, 10)} dow=${dow} dom=${dom}. Pass ?force=true to override.`,
        });
      }
      if (track === "inactive" && !is2ndTue) {
        return jsonResp({
          sent: 0,
          track,
          skipped: true,
          reason: `Blocked by date gate. Inactive track only fires on the 2nd Tuesday of the month. Today (UTC) is ${now.toISOString().slice(0, 10)} dow=${dow} dom=${dom}. Pass ?force=true to override.`,
        });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. All active retailers with email addresses and their email_enrollment setting.
    //    email_enrollment drives targeting:
    //      'Active'              → biweekly restock nudge
    //      'Previously Ordered'  → monthly "We Miss You" check-in
    //      'New - Don't Send Yet'→ never emailed by the cron
    const { data: retailers, error: retErr } = await supabase
      .from("retailers")
      .select("id, name, contact, email, created_at, pin, email_enrollment")
      .eq("status", "Active")
      .neq("email", "");
    if (retErr) throw retErr;
    if (!retailers?.length) {
      return jsonResp({ sent: 0, track, message: "No active retailers with emails." });
    }

    // 2. Pull all orders so we can compute each retailer's last-order date
    //    (still needed for the "last order date" line in the inactive email body).
    const { data: allOrders, error: ordErr } = await supabase
      .from("orders")
      .select("retailer_id, order_date");
    if (ordErr) throw ordErr;

    // retailer_id -> most recent order_date (YYYY-MM-DD)
    const lastOrderMap = new Map<number, string>();
    for (const o of allOrders || []) {
      if (!o.order_date) continue;
      const prev = lastOrderMap.get(o.retailer_id);
      if (!prev || o.order_date > prev) lastOrderMap.set(o.retailer_id, o.order_date);
    }

    const today = new Date();
    const daysBetween = (isoDate: string) => {
      const d = new Date(isoDate + "T12:00:00");
      return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    };

    // 3. Filter retailers per track, driven entirely by email_enrollment.
    let targets: any[] = [];
    if (track === "active") {
      // Active track: only partners explicitly marked 'Active'.
      // Skip if they just ordered within the last RESTOCK_QUIET_DAYS (avoid nudging right after a restock).
      targets = retailers.filter((r: any) => {
        if (r.email_enrollment !== "Active") return false;
        const last = lastOrderMap.get(r.id);
        if (last && daysBetween(last) < RESTOCK_QUIET_DAYS) return false;
        return true;
      });
    } else {
      // Inactive track: only partners explicitly marked 'Previously Ordered'.
      targets = retailers.filter((r: any) => r.email_enrollment === "Previously Ordered");
    }

    if (!targets.length) {
      return jsonResp({ sent: 0, track, message: `No ${track} partners need an email right now.` });
    }

    // 4. Send via Resend
    let sent = 0;
    const errors: string[] = [];
    const subject = track === "active"
      ? "Time to Restock? A Quick Check-In from Lazar Family Bakehouse"
      : "We Miss You — A Note from Lazar Family Bakehouse";

    // CC overrides: retailer name -> emails that should be CC'd instead of TO
    const CC_OVERRIDES: Record<string, string[]> = {
      "SkyMarket": ["Brandon.McFadden@JAFConcessions.com"],
    };

    for (const retailer of targets) {
      const firstName = (retailer.contact || retailer.name || "").split(" ")[0] || "Partner";
      const last = lastOrderMap.get(retailer.id) || null;
      const pin = retailer.pin || "";
      const html = track === "active"
        ? buildActiveHtml(firstName, retailer.name, pin)
        : buildInactiveHtml(firstName, retailer.name, last, pin);

      // Split emails into TO and CC based on overrides
      const allEmails = retailer.email.split(",").map((e: string) => e.trim()).filter(Boolean);
      const ccList = CC_OVERRIDES[retailer.name] || [];
      const ccLower = ccList.map((e: string) => e.toLowerCase());
      const toEmails = allEmails.filter((e: string) => !ccLower.includes(e.toLowerCase()));
      const ccEmails = allEmails.filter((e: string) => ccLower.includes(e.toLowerCase()));

      // In dryrun mode, redirect ALL recipients to the dryrun email
      // so real partners never get emailed during testing.
      const emailPayload: any = {
        from: FROM_EMAIL,
        to: dryrun ? [dryrunEmail] : toEmails,
        reply_to: REPLY_TO,
        bcc: dryrun ? [] : [BCC_EMAIL],
        subject: dryrun ? `[DRY RUN — for ${retailer.name}] ${subject}` : subject,
        html,
      };
      if (!dryrun && ccEmails.length) emailPayload.cc = ccEmails;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailPayload),
        });
        if (res.ok) sent++;
        else errors.push(`${retailer.name}: ${await res.text()}`);
      } catch (e: any) {
        errors.push(`${retailer.name}: ${e.message}`);
      }
    }

    console.log(`[LFB Reminder:${track}] Sent ${sent}/${targets.length}. Errors: ${errors.length}`);

    return jsonResp({
      sent,
      track,
      dryrun: dryrun || undefined,
      dryrun_email: dryrun ? dryrunEmail : undefined,
      total: targets.length,
      skipped: retailers.length - targets.length,
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
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ───────────────────────── ACTIVE (biweekly restock nudge) ─────────────────────────
function buildActiveHtml(firstName: string, storeName: string, pin: string): string {
  return shell(`
    <h1 style="font-family:Georgia,'Playfair Display',serif;font-size:22px;color:#2d1b0e;margin:0;">
      Time to Restock?
    </h1>
  `, `
    <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">Hi ${firstName},</p>
    <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
      We hope you're doing well! Just a friendly follow-up to see if
      <strong>${storeName}</strong> needs a restock. Our Mandelbites, Mandel Bread,
      Two-Packs, and Mandel Bread Rounds move fast with your customers, and we'd hate for you to run low.
    </p>
    <p style="font-size:16px;line-height:1.7;margin:0 0 24px;">
      Placing a new order takes just a minute through your partner portal:
    </p>
    ${ctaButton("Place an Order")}
    ${loginBox(storeName, pin)}
    <p style="font-size:14px;line-height:1.6;color:#5c4a3a;margin:0 0 8px;">As a reminder, here are our minimums:</p>
    <ul style="font-size:14px;line-height:1.8;color:#5c4a3a;margin:0 0 24px;padding-left:20px;">
      <li>Mandelbites pouches — 8 units (increments of 8)</li>
      <li>Two-Pack — 25 units (increments of 25)</li>
      <li>Individual pieces — 40 units (increments of 40)</li>
      <li>Mandel Bread Rounds — 40 units (increments of 40). Our classic mandel bread reimagined in cookie form.</li>
    </ul>
    <p style="font-size:16px;line-height:1.7;margin:0;">
      Thanks for being part of the Lazar Family Bakehouse family — we truly appreciate your partnership!
    </p>
  `);
}

// ───────────────────────── INACTIVE (monthly check-in) ─────────────────────────
function buildInactiveHtml(firstName: string, storeName: string, lastOrderDate: string | null, pin: string): string {
  const lastLine = lastOrderDate
    ? `<p style="font-size:14px;line-height:1.7;color:#5c4a3a;margin:0 0 18px;font-style:italic;">
         Your last order with us was on ${formatPretty(lastOrderDate)}.
       </p>`
    : "";
  return shell(`
    <h1 style="font-family:Georgia,'Playfair Display',serif;font-size:22px;color:#2d1b0e;margin:0;">
      We Miss You!
    </h1>
  `, `
    <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">Hi ${firstName},</p>
    <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
      It's been a little while since we've baked for <strong>${storeName}</strong>,
      and we just wanted to check in. We hope everything is going well on your end!
    </p>
    ${lastLine}
    <p style="font-size:16px;line-height:1.7;margin:0 0 18px;">
      Our Mandelbites come in four flavors: Chocolate Chip, Funfetti, Gluten-Free Chocolate Chip, and Almond.
      We also have <strong>Mandel Bread Rounds</strong>, a great addition to any bakery display case that also
      make for delicious ice cream sandwiches.
    </p>
    <p style="font-size:16px;line-height:1.7;margin:0 0 24px;">
      If anything's changed on your side, like a different buyer, new delivery preferences,
      or questions about what's working, we'd love to hear from you. Just hit reply.
    </p>
    ${ctaButton("Visit the Portal")}
    ${loginBox(storeName, pin)}
    <p style="font-size:16px;line-height:1.7;margin:0;">
      Whenever you're ready, we're here. Thanks for being part of the LFB family.
    </p>
  `);
}

function loginBox(storeName: string, pin: string): string {
  if (!pin) return "";
  return `
    <div style="background-color:#fff8f0;border:1px solid #e8d5c0;border-radius:6px;padding:20px 24px;margin:0 0 24px;">
      <p style="font-size:15px;font-weight:700;color:#2d1b0e;margin:0 0 10px;">Your login details:</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 4px;">
        <strong>Store:</strong> ${storeName}
      </p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 4px;">
        <strong>PIN:</strong> ${pin}
      </p>
      <p style="font-size:13px;color:#5c4a3a;margin:8px 0 0;">
        Select your store from the dropdown, enter your PIN, and you're in.
      </p>
    </div>`;
}

function ctaButton(label: string): string {
  return `
    <div style="text-align:center;margin:0 0 28px;">
      <a href="${PORTAL_URL}" style="display:inline-block;background:#3a2518;color:#ffffff;text-decoration:none;padding:14px 36px;font-size:16px;font-weight:700;letter-spacing:.04em;">
        ${label}
      </a>
    </div>`;
}

function shell(header: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#fdf6ee;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#2d1b0e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;padding-bottom:24px;border-bottom:2px solid #ff0000;">
      <img src="${LOGO_URL}" alt="Lazar Family Bakehouse" width="180" style="margin-bottom:16px;"/>
      ${header}
    </div>
    <div style="padding:28px 0;">${body}</div>
    <div style="border-top:2px solid #ff0000;padding-top:20px;text-align:center;">
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">Lazar Family Bakehouse · Englewood, CO</p>
      <p style="font-size:13px;color:#5c4a3a;margin:0 0 6px;">
        <a href="mailto:info@lazarfamilybakehouse.com" style="color:#3a2518;text-decoration:underline;">info@lazarfamilybakehouse.com</a>
      </p>
      <p style="font-size:11px;color:#8a7968;margin:12px 0 0;">
        You're receiving this because you're our partner. To opt out, reply to this email or contact us directly.
      </p>
    </div>
  </div>
</body></html>`;
}

function formatPretty(iso: string): string {
  const [y, m, d] = iso.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
