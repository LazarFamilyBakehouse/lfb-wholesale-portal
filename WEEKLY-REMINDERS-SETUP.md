# Weekly Restock Reminders — Setup Guide

This adds automated weekly emails to retailers who haven't ordered in the last 7 days.

**Stack:** Supabase Edge Function + Resend (all free tier)

---

## Step 1: Create a Resend Account (2 min)

1. Go to [resend.com](https://resend.com) and sign up
2. In the dashboard, go to **API Keys** → **Create API Key**
3. Name it `lfb-weekly-reminders`, give it **Send** permission
4. Copy the key (starts with `re_...`) — you'll need it in Step 3

**Free tier:** 3,000 emails/month — more than enough.

### Set up your domain (recommended)

By default, Resend sends from `onboarding@resend.dev`. To send from `orders@lazarfamilybakehouse.com`:

1. In Resend dashboard → **Domains** → **Add Domain**
2. Enter `lazarfamilybakehouse.com`
3. Add the DNS records Resend gives you (SPF, DKIM, DMARC) at your domain registrar
4. Wait for verification (usually a few minutes)

Until the domain is verified, update `FROM_EMAIL` in the Edge Function to use `onboarding@resend.dev`.

---

## Step 2: Install Supabase CLI (if not installed)

```bash
npm install -g supabase
```

Then link to your project:

```bash
cd lfb-wholesale-portal
supabase login
supabase link --project-ref ylvoswzsijigyezqvaat
```

---

## Step 3: Set the Resend Secret

```bash
supabase secrets set RESEND_API_KEY=re_YOUR_KEY_HERE
```

---

## Step 4: Deploy the Edge Function

```bash
supabase functions deploy weekly-reminder --no-verify-jwt
```

> `--no-verify-jwt` allows the function to be called by pg_cron (which doesn't pass a JWT).
> The portal's manual trigger still sends the anon key for auth.

Test it:

```bash
curl -X POST https://ylvoswzsijigyezqvaat.supabase.co/functions/v1/weekly-reminder \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

---

## Step 5: Set Up Automatic Weekly Schedule (pg_cron)

In the Supabase dashboard:

1. Go to **SQL Editor**
2. Run this to enable pg_cron (if not already):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

3. Schedule the weekly reminder for every Monday at 9:00 AM Mountain Time (3:00 PM UTC):

```sql
SELECT cron.schedule(
  'weekly-restock-reminder',
  '0 15 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ylvoswzsijigyezqvaat.supabase.co/functions/v1/weekly-reminder',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsdm9zd3pzaWppZ3llenF2YWF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2Mjk5MTAsImV4cCI6MjA4OTIwNTkxMH0.iA4QMZkxTsqArV3CgHb-YluiBeiIq5RppGV6kBe8G8g", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

> This uses `pg_net` (built into Supabase) to call the Edge Function on a schedule.

### Verify the schedule

```sql
SELECT * FROM cron.job;
```

### To remove or change the schedule

```sql
-- Remove
SELECT cron.unschedule('weekly-restock-reminder');

-- Change to Tuesdays at 10 AM MT (4 PM UTC)
SELECT cron.schedule('weekly-restock-reminder', '0 16 * * 2', $$ ... $$);
```

---

## Step 6: Test from the Portal

1. Log into the admin portal
2. Go to **Settings**
3. Click **Send Reminders Now**
4. You'll see how many were sent and how many were skipped

---

## How It Works

1. The Edge Function queries Supabase for all **active retailers with email addresses**
2. It checks `orders` for any orders in the last 7 days
3. Retailers who **haven't** ordered get a branded email with a direct link to the portal
4. The admin panel shows results (sent count, skipped count, any errors)

---

## Cost

| Service | Free Tier | Your Usage |
|---------|-----------|------------|
| Supabase Edge Functions | 500K invocations/month | ~4/month |
| Resend | 3,000 emails/month | ~20-50/month |
| pg_cron | Included | 1 job |

**Total cost: $0/month**
