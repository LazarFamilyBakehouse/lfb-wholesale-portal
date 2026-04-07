# Partner Reminder Emails — Schedule Update

The reminder system now has **two tracks** that replace the old single Wednesday weekly reminder.

## What Changed

| Track | Who Gets It | Cadence | When |
|---|---|---|---|
| **Restock Nudge** (`?track=active`) | Partners who ordered in last 60 days but not in last 14 days | Biweekly | 1st & 3rd Tuesday, 3 PM MT |
| **We Miss You** (`?track=inactive`) | Partners with no order in 60+ days (or never ordered) | Monthly | 1st Tuesday only, 3 PM MT |

Same Edge Function (`weekly-reminder`) handles both — just pass `?track=active` or `?track=inactive`.

---

## Step 1 · Redeploy the Edge Function

1. Open Supabase Dashboard → **Edge Functions** → `weekly-reminder`.
2. Click **Edit function**.
3. Open `/sessions/cool-exciting-euler/mnt/Desktop/lfb-wholesale-portal/supabase/functions/weekly-reminder/index.ts` in Notepad.
4. Copy the entire contents, paste into the Supabase editor (replace everything).
5. Click **Deploy**.

---

## Step 2 · Remove the Old Wednesday Cron

Supabase Dashboard → **SQL Editor** → New query → paste and run:

```sql
-- Remove the old weekly Wednesday reminder
SELECT cron.unschedule('lfb-weekly-reminder');
```

---

## Step 3 · Add the Two New Cron Jobs

Paste and run in the SQL Editor:

```sql
-- Biweekly restock nudge — Tuesdays of weeks 1 & 3 of the month, 3 PM MT (21 UTC)
SELECT cron.schedule(
  'lfb-restock-nudge-biweekly',
  '0 21 1-7,15-21 * 2',
  $$
  SELECT net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-reminder?track=active',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-SUPABASE-ANON-KEY'
    ),
    body := '{"track":"active"}'::jsonb
  );
  $$
);

-- Monthly re-engagement — first Tuesday of the month, 3 PM MT (21 UTC)
SELECT cron.schedule(
  'lfb-reengagement-monthly',
  '0 21 1-7 * 2',
  $$
  SELECT net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-reminder?track=inactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-SUPABASE-ANON-KEY'
    ),
    body := '{"track":"inactive"}'::jsonb
  );
  $$
);
```

**Before running**: replace `YOUR-PROJECT-REF` with your Supabase project ref, and `YOUR-SUPABASE-ANON-KEY` with your anon key (same values used in the old cron).

Verify the jobs are scheduled:

```sql
SELECT jobname, schedule, active FROM cron.job;
```

You should see both `lfb-restock-nudge-biweekly` and `lfb-reengagement-monthly` listed as active.

---

## Step 4 · Test from the Admin Portal

1. Open the portal → Admin → **Settings** tab.
2. New **Partner Reminder Emails** panel has two buttons:
   - **Send Restock Nudge Now** (brown) — triggers the active track manually.
   - **Send Re-Engagement Now** (gold) — triggers the inactive track manually.
3. Click each to verify the counts match your expectations before the first automated run.

---

## Cron Schedule Reference

- `0 21 1-7,15-21 * 2` → Tuesdays of the first week AND third week, 21:00 UTC = 3 PM MDT / 2 PM MST
- `0 21 1-7 * 2` → Tuesday of the first week only, 21:00 UTC

Note: during MST (Nov–Mar), these fire at 2 PM MT instead of 3 PM. If you want to lock in 3 PM year-round, use `0 22 …` for the MST months or switch cron UTC offsets manually.
