# EmailJS Configuration

**Dashboard:** https://dashboard.emailjs.com
**Account:** info@lazarfamilybakehouse.com

---

## Credentials

| Key | Value |
|---|---|
| Public Key | `1senobeAZSp2tKNvL` |
| Service ID | `service_j5qotyn` |
| Template ID | `template_wbhl7fm` |

---

## Template: "Wholesale Order Notification"

**Purpose:** Internal notification sent to `info@lazarfamilybakehouse.com` every time a wholesale partner places an order through the portal.

**Subject:** `Invoice #{{order_id}} — LFB Order Placed | {{retailer_name}}`

**To:** `info@lazarfamilybakehouse.com` (hardcoded)

**From Name:** LFB Wholesale Portal

---

## Template Variables

These variables are passed by the `sendOrderNotification()` function in `index.html`:

| Variable | Type | Example |
|---|---|---|
| `{{retailer_name}}` | string | "The Grand Hotel" |
| `{{order_id}}` | string | "abc123-..." |
| `{{order_date}}` | string | "2026-03-17" |
| `{{delivery_date}}` | string | "2026-03-20" |
| `{{order_notes}}` | string | "Side entrance delivery" |
| `{{#orders}}` | array loop | Line items |
| `{{name}}` | string (in loop) | "CC Mandelbites" |
| `{{units}}` | string (in loop) | "12" |
| `{{price}}` | string (in loop) | "$6.00" |
| `{{/orders}}` | end loop | |
| `{{cost.shipping}}` | string | "$0.00" |
| `{{cost.tax}}` | string | "$0.00" |
| `{{cost.total}}` | string | "$72.00" |

---

## Desired Email Body Content

The internal notification should read (update in EmailJS Dashboard → Email Templates → Edit):

```
Heading:    New LFB Order Received

Body line:  This order has been added to our bake schedule.

Invoice:    Invoice #{{order_id}} — LFB Order Placed
            [order items table]

Footer:     Please go to the wholesale partner portal to view the
            bake schedule and confirm this order:
            https://partners.lazarfamilybakehouse.com
```

### How to Edit the Template Body (Manual Steps)
1. Go to https://dashboard.emailjs.com/admin/templates
2. Click the Edit button on "Wholesale Order Notification"
3. In the Content section, click **Edit Content → Design Editor**
4. Triple-click "Thank You for Your Order" → type: `New LFB Order Received`
5. Triple-click "We'll send you tracking information when the order ships." → type: `This order has been added to our bake schedule.`
6. Triple-click "Order #" → type: `Invoice #`
7. After the items table, add a new text block: `Please visit our partner portal to view the bake schedule: partners.lazarfamilybakehouse.com`
8. Click **Save**

---

## Monthly Request Limit

Free plan: **200 requests/month** (resets monthly)
Current usage: ~1/200

Consider upgrading to a paid plan once order volume increases.

---

## Failure Handling

EmailJS errors are caught silently in the portal:
```js
.catch(err => console.warn('EmailJS notification failed:', err));
```

If an email fails to send, the order is **still saved in Supabase** — you won't lose the order. Check the EmailJS Email History dashboard if you suspect missing notifications.
