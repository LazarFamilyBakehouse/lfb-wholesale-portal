# Changelog

All notable changes to the LFB Wholesale Portal are documented here.

---

## [2026-03-17] — Security Hardening & Analytics Upgrade

### Security
- **Supabase column-level restriction:** Revoked `SELECT` on all retailer columns for `anon` role; granted `SELECT` only on `id`, `name`, `status`. Anonymous users can no longer read PINs, emails, or phone numbers via the REST API.
- Documented full security audit in `docs/SECURITY.md`

### Analytics
- Fixed **Order Frequency table** color contrast — order count numbers now use consistent `var(--brown-dk)` instead of rotating product chart colors (some of which were illegible on white)
- Added **"Avg Orders / Month" KPI card** (trailing 6 months) to analytics header row, with left border accent for visual distinction
- Added **"Orders per Month (trailing 6 months)" bar chart** — new panel in analytics showing monthly order counts as a bar chart
- Added **companion stat panel** showing the average orders/month as a large Playfair Display number

### Products
- Renamed legacy SKU display name: `CC Mandel Bread (Full Loaf)` → `Red Bag of Chocolate Chip Mango Bread`
- Confirmed this SKU is NOT in the active catalog (`PRODUCTS[]` or `PRODUCT_SECTIONS[]`); it only appears in historical order data
- Confirmed price entry for this SKU: `$16.00/unit`

### EmailJS
- Updated email template **Subject** to: `Invoice #{{order_id}} — LFB Order Placed | {{retailer_name}}`
- Documented remaining body text changes in `docs/EMAILJS.md` (manual steps provided)

### Repository
- Added `README.md` with architecture overview, configuration reference, and quick-start guide
- Added `docs/` folder with `SUPABASE.md`, `EMAILJS.md`, `SECURITY.md`, `CHANGELOG.md`

---

## [2026-03-16] — Initial Deployment

### Portal
- Single-file wholesale partner portal deployed to `partners.lazarfamilybakehouse.com`
- EmailJS order notification integration live (Service: `service_j5qotyn`, Template: `template_wbhl7fm`)
- Supabase backend connected (Project: `ylvoswzsijigyezqvaat`)
- Netlify auto-deploy configured from `LazarFamilyBakehouse/lfb-wholesale-portal` `main` branch
- Fixed broken Netlify–GitHub SSH deploy key by unlinking and re-linking the repository

### Features at Launch
- Retailer PIN login
- Product catalog with MOQ enforcement
- Order placement with invoice generation
- Admin dashboard: retailers, orders, analytics, auto-orders, settings
- Standing auto-order support
- Order notifications via EmailJS
- Realtime Supabase subscription for order updates
