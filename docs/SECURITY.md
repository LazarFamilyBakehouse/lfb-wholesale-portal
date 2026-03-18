# Security Audit & Hardening — LFB Wholesale Portal

**Audit Date:** 2026-03-17
**Auditor:** Claude (Cowork session)

---

## Security Measures Already In Place

### Supabase
- **RLS enabled** on all three tables (`retailers`, `orders`, `order_items`)
- **Column-level restriction** applied: `anon` role can only SELECT `id`, `name`, `status` from `retailers` — PINs, emails, and phone numbers are not readable anonymously
- **Security Definer RPCs** for all retailer-facing operations — PIN validation happens server-side, cannot be bypassed via REST API
- `admin_all_*` policies require `authenticated` role (not anonymous)

### EmailJS
- Public key only (not service key) embedded in frontend
- Failure is caught silently — orders are still saved even if email fails

### Netlify
- HTTPS enforced on custom domain
- Security headers configured in `netlify.toml`:
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

---

## Known Risks & Recommendations

### HIGH PRIORITY

#### 1. Admin PIN Is Client-Side Only
**Risk:** The admin PIN (`bakehouse`) is stored in `db.adminPin` which is in localStorage. Anyone who reads the portal source code can find the default PIN. Admin auth has no server-side verification.

**Recommendation:**
- Change the admin PIN from the default `bakehouse` immediately (Settings → Change Admin PIN)
- Use a strong PIN (12+ chars, mix of letters/numbers)
- Consider migrating admin login to Supabase Auth (email + password) in a future version

#### 2. Supabase Anon Key in HTML Source
**Risk:** The anon key is visible to anyone who views page source. This is expected and acceptable for Supabase — the anon key is designed to be public. Protection comes from RLS policies.

**Action:** Ensure RLS is always enabled. Never use the service role key in frontend code.

#### 3. Retailer PINs Are Short
**Risk:** 4-character numeric PINs can be brute-forced.

**Recommendation:**
- Enforce minimum 6-character PINs (mix of letters and numbers)
- Add rate limiting to the `validate_retailer_pin` RPC
- Consider adding a lockout after 5 failed attempts

### MEDIUM PRIORITY

#### 4. No Rate Limiting on PIN Validation
**Risk:** An attacker could rapidly call `validate_retailer_pin` to brute-force retailer PINs.

**Recommendation — Add Rate Limiting in Supabase:**
```sql
-- Create a login attempts table
CREATE TABLE login_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  retailer_id uuid,
  attempted_at timestamptz DEFAULT now(),
  success boolean
);

-- In validate_retailer_pin RPC, check attempts in last 15 minutes
-- If > 5 failed attempts, return false without checking PIN
```

#### 5. Admin Operations Use Anon Key Directly
**Risk:** Admin direct table writes (retailers, orders) use the anon key. The `authenticated` role policies technically block this, but it's worth migrating to proper Supabase Auth for admin.

**Recommendation:** Future upgrade — implement Supabase Auth for admin login.

#### 6. No Content Security Policy (CSP)
**Risk:** Without a CSP header, XSS attacks could inject scripts.

**Recommendation — Add to `netlify.toml`:**
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://api.emailjs.com; img-src 'self' data: https:;"
```

### LOW PRIORITY

#### 7. LocalStorage for `db` Object
**Risk:** All portal data (orders, retailers, auto-orders) is cached in localStorage. Anyone with device access can read or modify it.

**Mitigation:** This is a cache only — the authoritative data is in Supabase. On next load, Supabase data overwrites localStorage.

#### 8. Test Table in Supabase Has No RLS
**Risk:** The `Test` table has no RLS policies. It appears to have no data but is technically accessible.

**Recommendation:** Enable RLS on the Test table:
```sql
ALTER TABLE "Test" ENABLE ROW LEVEL SECURITY;
```

---

## Security Hardening Checklist

- [x] RLS enabled on all production tables
- [x] Column-level restrictions on `retailers` (anon can't read PINs)
- [x] Security Definer RPCs for retailer auth
- [x] HTTPS enforced via Netlify
- [x] Security headers in netlify.toml
- [ ] Change admin PIN from default `bakehouse`
- [ ] Enforce minimum PIN length for retailers (6+ chars)
- [ ] Add rate limiting to PIN validation RPC
- [ ] Add Content Security Policy header
- [ ] Enable RLS on `Test` table
- [ ] (Future) Migrate admin auth to Supabase Auth

---

## Passwords & Credentials Reference

| Service | Credential | Where to Update |
|---|---|---|
| Supabase anon key | In `index.html` ~line 480 | Supabase Dashboard → Settings → API |
| Admin PIN | In portal Settings → Change Admin PIN | Updates `db.adminPin` in localStorage |
| EmailJS public key | In `index.html` ~line 12 | EmailJS Dashboard → Account |
| Netlify | DNS/deploy settings | Netlify Dashboard |
| GitHub repo | `LazarFamilyBakehouse/lfb-wholesale-portal` | GitHub |
