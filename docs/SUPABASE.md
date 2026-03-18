# Supabase Backend Documentation

**Project:** LazarFamilyBakehouse Partner Storage
**Project ID:** `ylvoswzsijigyezqvaat`
**URL:** `https://ylvoswzsijigyezqvaat.supabase.co`
**Dashboard:** https://supabase.com/dashboard/project/ylvoswzsijigyezqvaat

---

## Tables

### `retailers`
Stores wholesale partner accounts.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `name` | text | Business name |
| `contact` | text | Contact person name |
| `email` | text | Contact email |
| `phone` | text | Contact phone |
| `pin` | text | Portal login PIN (4–8 chars) |
| `delivery_day` | text | Preferred delivery day |
| `notes` | text | Internal notes |
| `status` | text | `Active` or `Inactive` |
| `joined_date` | text | Date added (YYYY-MM-DD) |
| `price_overrides` | jsonb | Per-SKU price overrides `{"Minis": 5.50}` |

### `orders`
Invoice-level order records.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `retailer_id` | uuid (FK → retailers.id) | |
| `invoice_num` | integer | Sequential invoice number |
| `order_date` | text | YYYY-MM-DD |
| `delivery_date` | text | YYYY-MM-DD (nullable) |
| `status` | text | `Pending`, `Confirmed`, `Delivered` |
| `notes` | text | Order notes |
| `total` | numeric | Order total in dollars |

### `order_items`
Line items for each order.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `order_id` | uuid (FK → orders.id) | |
| `product` | text | SKU name |
| `qty` | integer | Quantity ordered |
| `unit_price` | numeric | Price per unit |
| `subtotal` | numeric | qty × unit_price |

---

## Row Level Security (RLS) Policies

All three main tables have RLS **enabled**.

### `retailers`
| Policy | Role | Operation | Condition |
|---|---|---|---|
| `admin_all_retailers` | authenticated | ALL | `true` |
| `anon_read_active_retailers` | anon | SELECT | `status = 'Active'` |

**Column-level restriction (applied 2026-03-17):**
```sql
REVOKE SELECT ON TABLE public.retailers FROM anon;
GRANT SELECT (id, name, status) ON TABLE public.retailers TO anon;
```
This ensures anonymous users can ONLY read `id`, `name`, `status` — NOT PINs, emails, or phone numbers.

### `orders`
| Policy | Role | Operation | Condition |
|---|---|---|---|
| `admin_all_orders` | authenticated | ALL | `true` |

### `order_items`
| Policy | Role | Operation | Condition |
|---|---|---|---|
| `admin_all_order_items` | authenticated | ALL | `true` |

---

## RPC Functions (Security Definer)

These functions run with elevated privileges and bypass RLS. They validate the retailer PIN server-side before returning data.

| Function | Purpose |
|---|---|
| `validate_retailer_pin(p_retailer_id, p_pin)` | Returns boolean — validates PIN |
| `get_retailer_profile(p_retailer_id, p_pin)` | Returns retailer row if PIN valid |
| `get_retailer_orders(p_retailer_id, p_pin)` | Returns orders + items if PIN valid |
| `submit_retailer_order(p_retailer_id, p_pin, p_invoice_num, p_date, p_delivery_date, p_notes, p_items)` | Creates order + items if PIN valid |

---

## Security Notes

- The `SUPABASE_ANON` key is embedded in the frontend HTML. This is expected and safe — all data access is governed by RLS policies and Security Definer RPCs.
- **Never expose the service role key** in frontend code.
- PIN validation happens server-side in RPCs — a malicious actor cannot bypass it by calling the API directly.
- Column-level grants prevent the anon role from reading PINs even with `select=*` REST calls.

---

## Rotate Anon Key

If the anon key is ever compromised:
1. Go to Supabase Dashboard → Settings → API
2. Click "Reveal" next to anon key → Rotate
3. Update `SUPABASE_ANON` in `index.html` (~line 480)
4. Push to GitHub → Netlify auto-deploys
