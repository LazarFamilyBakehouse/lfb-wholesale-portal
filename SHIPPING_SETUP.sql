-- LFB Portal - Shipping + tracking (run once in the Supabase SQL editor; already applied Nov 2026)
-- Adds the Shipped status fields to orders and lets partners read tracking
-- through their PIN-checked order lookup.
alter table public.orders
  add column if not exists tracking_number text,
  add column if not exists tracking_carrier text,
  add column if not exists shipped_at date,
  add column if not exists shipped_email_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_retailer_orders(p_retailer_id integer, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not validate_retailer_pin(p_retailer_id, p_pin) then raise exception 'Invalid credentials'; end if;
  return (
    select coalesce(json_agg(json_build_object(
      'id', o.id, 'invoice_num', o.invoice_num, 'date', o.order_date, 'delivery_date', o.delivery_date,
      'status', o.status, 'total', o.total, 'notes', o.notes,
      'tracking_number', o.tracking_number, 'tracking_carrier', o.tracking_carrier, 'shipped_at', o.shipped_at,
      'items', (
        select coalesce(json_agg(json_build_object(
          'product', oi.product, 'qty', oi.qty, 'price', oi.unit_price, 'subtotal', oi.subtotal, 'note', oi.note
        ) order by oi.id), '[]'::json) from order_items oi where oi.order_id = o.id
      )
    ) order by o.order_date desc, o.id desc), '[]'::json)
    from orders o where o.retailer_id = p_retailer_id
  );
end;
$function$;
