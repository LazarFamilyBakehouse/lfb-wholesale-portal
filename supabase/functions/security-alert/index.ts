// LFB Portal - Security Alert
// Called automatically by the database when a partner account gets
// locked out (5 failed PIN attempts within 15 minutes).
// Sends an email so Jake knows a brute-force attempt is happening.
// Reuses the same Resend setup as the weekly digest.
import { createClient } from "npm:@supabase/supabase-js@2";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_TO = (Deno.env.get("SECURITY_ALERT_TO") ?? "info@lazarfamilybakehouse.com").split(",").map(s => s.trim()).filter(Boolean);
const FROM_EMAIL = Deno.env.get("DIGEST_FROM") ?? "orders@lazarfamilybakehouse.com";
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const rid = body.retailer_id ?? null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let name = "Unknown partner";
  if (rid) { const { data } = await sb.from("retailers").select("name").eq("id", rid).maybeSingle(); if (data && data.name) name = data.name; }
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await sb.from("login_attempts").select("*", { count: "exact", head: true }).eq("retailer_id", rid).eq("success", false).gte("attempted_at", since);
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  const html = "<div style='font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fdf6ee;padding:24px;border-radius:12px;'><h2 style='color:#c0392b;margin:0 0 8px;'>🔒 Possible brute-force login attempt</h2><p style='color:#2d1b0e;margin:0 0 12px;'>The partner portal just locked out the account for <strong>" + name + "</strong> after repeated wrong PIN entries.</p><table style='width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;'><tr><td style='padding:8px 14px;border-bottom:1px solid #e4d8c8;color:#7a6a58;'>Partner</td><td style='padding:8px 14px;border-bottom:1px solid #e4d8c8;'><strong>" + name + "</strong> (id " + rid + ")</td></tr><tr><td style='padding:8px 14px;border-bottom:1px solid #e4d8c8;color:#7a6a58;'>Failed attempts (last 15 min)</td><td style='padding:8px 14px;border-bottom:1px solid #e4d8c8;'><strong>" + (count ?? "5+") + "</strong></td></tr><tr><td style='padding:8px 14px;color:#7a6a58;'>Time</td><td style='padding:8px 14px;'>" + when + " (Mountain)</td></tr></table><p style='color:#7a6a58;margin:16px 0 0;font-size:14px;'>The account is locked for 15 minutes automatically. Nothing you need to do unless this keeps happening. If it is a real partner who forgot their PIN, they can try again after 15 minutes, or you can send them their PIN from the Retailers tab.</p><p style='color:#b0a08c;font-size:12px;margin-top:16px;'>Sent automatically by the LFB Partner Portal.</p></div>";
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: "LFB Portal Security <" + FROM_EMAIL + ">", to: ALERT_TO, subject: "🔒 Lockout: repeated failed logins for " + name, html: html }) });
  const out = await res.json();
  return new Response(JSON.stringify({ sent_to: ALERT_TO, retailer: name, failures: count, resend: out }), { headers: { "Content-Type": "application/json" } });
});
