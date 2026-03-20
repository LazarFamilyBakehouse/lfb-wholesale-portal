# LFB Wholesale Partner Portal

Live at → **[partners.lazarfamilybakehouse.com](https://partners.lazarfamilybakehouse.com)**

A single-file wholesale partner portal for Lazar Family Bakehouse. Partners log in with a PIN to place orders, view invoices, and manage standing auto-orders. The admin dashboard provides full analytics, order management, and retailer CRM.

---

## Architecture Overview

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML/CSS/JS (single file) | Portal UI, order placement, admin dashboard |
| Hosting | Netlify | Auto-deploys from `main` branch |
| Database | Supabase (PostgreSQL) | Retailers, orders, order items |
| Email | EmailJS | Order notification emails to LFB |
| Auth | PIN-based (via Supabase RPCs) | Retailer login; admin PIN client-side |

---

## Repository Structure

```
lfb-wholesale-portal/
├── index.html          # Main portal (all HTML/CSS/JS in one file)
├── netlify.toml        # Netlify deploy config + SPA redirect rules
├── README.md           # This file
└── docs/
    ├── SUPABASE.md     # Database schema, RLS policies, RPC functions
    ├── EMAILJS.md      # EmailJS template config and variables
    ├── SECURITY.md     # Security audit and hardening notes
    └── CHANGELOG.md    # Change log of all updates
```

---

## Quick-Start: Making Changes

1. Edit `index.html` locally
2. Upload via GitHub web UI → **Add file → Upload files** (or use git push)
3. Netlify auto-deploys within ~60 seconds
4. Verify at [partners.lazarfamilybakehouse.com](https://partners.lazarfamilybakehouse.com)

---

## Key Configuration

All configuration lives in `index.html` around **line 472–820**:

| Constant | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON` | Supabase anon key (public, safe to expose; RLS protects data) |
| `PRODUCTS[]` | Active orderable SKU list |
| `PRODUCT_PRICES{}` | Base wholesale prices per SKU |
| `PRODUCT_SECTIONS[]` | Catalog groupings shown to retail partners |
| `DELIVERY_FEES{}` | Per-retailer delivery fee (localStorage-backed) |
| EmailJS `publicKey` | `1senobeAZSp2tKNvL` |
| EmailJS `service_id` | `service_j5qotyn` |
| EmailJS `template_id` | `template_wbhl7fm` |

---

## Admin Access

- URL: [partners.lazarfamilybakehouse.com](https://partners.lazarfamilybakehouse.com)
- Login type: **Admin**
- PIN: stored in `db.adminPin` (default: `bakehouse`) — change in Settings

## Retailer Access

- Same URL, select retailer name, enter PIN
- PIDs managed in the Admin → Retailers section

---

## Netlify

- **Site:** `genuine-pika-5a22e7.netlify.app`
- **Custom domain:** `partners.lazarfamilybakehouse.com`
- **Deploy trigger:** Push to `main` branch
- **Build command:** none (static site)
- **Publish directory:** `.` (repo root)
