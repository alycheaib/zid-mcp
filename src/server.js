import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ZidClient, loadConfig, maskPii } from './zid.js';
import { createDemoFetch } from './demo.js';

export const INSTRUCTIONS = `Zid (zid.sa) store data, read-only. Answer the merchant in their language (Arabic or English), with numbers in SAR.
For "how are sales" questions use sales_summary; for stock questions use low_stock; for lost revenue use abandoned_carts_summary.
Customer personal data is masked unless the operator disabled masking. Never invent orders or figures that the tools did not return.`;

const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }], structuredContent: o });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const ORDER_STATUSES = ['new', 'preparing', 'ready', 'indelivery', 'delivered', 'canceled'];
const r2 = (n) => Math.round(n * 100) / 100;
const pickName = (n) => (n && typeof n === 'object' ? n.ar || n.en || Object.values(n)[0] : n);
const statusCode = (o) => o.order_status?.code || o.order_status?.name || o.order_status || 'unknown';

function compactOrder(o) {
  return {
    id: o.id, code: o.code, created_at: o.created_at, status: statusCode(o), payment_status: o.payment_status,
    payment_method: o.payment?.method?.code || o.payment?.method?.name, total: Number(o.order_total), currency: o.currency_code,
    customer: o.customer ? { id: o.customer.id, name: o.customer.name, mobile: o.customer.mobile, email: o.customer.email } : undefined,
    city: o.shipping?.address?.city?.name, source: o.source,
    items: o.products?.map((p) => ({ name: pickName(p.name), sku: p.sku, quantity: p.quantity, price: Number(p.price), total: Number(p.total ?? p.price * p.quantity) })),
  };
}
function compactProduct(p) {
  return { id: p.id, sku: p.sku, name: pickName(p.name), price: Number(p.price), sale_price: p.sale_price == null ? null : Number(p.sale_price),
    currency: p.currency, quantity: p.is_infinite ? 'unlimited' : p.quantity, published: p.is_published, sold: p.sold_products_count,
    categories: p.categories?.map((c) => pickName(c.name)), url: p.html_url };
}

export function createServer({ env = process.env, fetchImpl } = {}) {
  const cfg = loadConfig(env);
  let f = fetchImpl;
  if (!f && cfg.demo) { f = createDemoFetch(); Object.assign(cfg, { authorization: 'demo', managerToken: 'demo', storeId: '999', minIntervalMs: 0 }); }
  const zid = new ZidClient(cfg, f);
  const out = (o) => json(cfg.maskPii ? maskPii(o) : o);
  const server = new McpServer({ name: 'zid-mcp', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: true };

  async function fetchOrders({ date_from, date_to, order_status, payment_status, withProducts, max = 500 }) {
    const all = [];
    for (let page = 1; all.length < max; page++) {
      const r = await zid.get('/v1/managers/store/orders', { page, per_page: 50, date_from, date_to, order_status, payment_status,
        date_attribute: 'created_at', payload_type: withProducts ? 'default' : undefined });
      const batch = r.orders || [];
      all.push(...batch);
      if (batch.length < 50) break;
    }
    return all.slice(0, max);
  }

  server.registerTool('store_info', {
    title: 'Store / account info', description: 'The connected Zid manager account and store (also a quick connection test).',
    inputSchema: {}, annotations: ro,
  }, async () => {
    const r = await zid.get('/v1/managers/account/me');
    return out({ demo: cfg.demo, user: r.user ?? r });
  });

  server.registerTool('list_orders', {
    title: 'List orders', description: 'List orders with filters (status, payment status, date range, customer, search by code/phone).',
    inputSchema: {
      order_status: z.enum(ORDER_STATUSES).optional(), payment_status: z.enum(['pending', 'paid', 'refunded', 'voided']).optional(),
      date_from: date.optional(), date_to: date.optional(), customer_id: z.string().optional(), search: z.string().optional(),
      include_products: z.boolean().optional(), page: z.number().int().min(1).optional(), per_page: z.number().int().min(1).max(100).optional(),
    }, annotations: ro,
  }, async (a) => {
    const r = await zid.get('/v1/managers/store/orders', { page: a.page || 1, per_page: a.per_page || 20, order_status: a.order_status,
      payment_status: a.payment_status, date_from: a.date_from, date_to: a.date_to, customer_id: a.customer_id, search_term: a.search,
      date_attribute: a.date_from || a.date_to ? 'created_at' : undefined, payload_type: a.include_products ? 'default' : undefined });
    return out({ total: r.total_order_count ?? r.orders?.length, page: a.page || 1, orders: (r.orders || []).map(compactOrder) });
  });

  server.registerTool('get_order', {
    title: 'Get order', description: 'Full details of one order: items, payment, shipping, customer.',
    inputSchema: { order_id: z.union([z.string(), z.number()]) }, annotations: ro,
  }, async ({ order_id }) => {
    const r = await zid.get(`/v1/managers/store/orders/${encodeURIComponent(order_id)}/view`);
    return out({ order: r.order ? { ...compactOrder(r.order), raw_status: r.order.display_status } : r });
  });

  server.registerTool('sales_summary', {
    title: 'Sales summary', description: 'Revenue, order count, average order value, breakdown by status/payment method/city/day and top products for a date range (computed from orders).',
    inputSchema: { date_from: date, date_to: date, include_canceled: z.boolean().optional(), top: z.number().int().min(1).max(50).optional() }, annotations: ro,
  }, async (a) => {
    const orders = await fetchOrders({ date_from: a.date_from, date_to: a.date_to, withProducts: true, max: 2000 });
    const counted = orders.filter((o) => a.include_canceled || statusCode(o) !== 'canceled');
    const by = (fn) => counted.reduce((m, o) => { const k = fn(o) || 'unknown'; m[k] ??= { orders: 0, revenue: 0 }; m[k].orders++; m[k].revenue = r2(m[k].revenue + Number(o.order_total || 0)); return m; }, {});
    const revenue = r2(counted.reduce((s, o) => s + Number(o.order_total || 0), 0));
    const prod = {};
    for (const o of counted) for (const p of o.products || []) {
      const k = p.sku || pickName(p.name); prod[k] ??= { name: pickName(p.name), sku: p.sku, quantity: 0, revenue: 0 };
      prod[k].quantity += Number(p.quantity || 0); prod[k].revenue = r2(prod[k].revenue + Number(p.total ?? p.price * p.quantity));
    }
    return out({
      period: { from: a.date_from, to: a.date_to }, currency: orders[0]?.currency_code || 'SAR',
      orders: counted.length, canceled: orders.filter((o) => statusCode(o) === 'canceled').length, revenue,
      average_order_value: counted.length ? r2(revenue / counted.length) : 0,
      by_status: by(statusCode), by_payment_method: by((o) => o.payment?.method?.code || o.payment?.method?.name),
      by_city: by((o) => o.shipping?.address?.city?.name), by_day: by((o) => String(o.created_at).slice(0, 10)),
      top_products: Object.values(prod).sort((x, y) => y.revenue - x.revenue).slice(0, a.top || 10),
      note: orders.length >= 2000 ? 'Capped at 2000 orders; narrow the date range for exact totals.' : undefined,
    });
  });

  server.registerTool('list_products', {
    title: 'List products', description: 'Search the catalogue (name/SKU), filter by stock, with price and quantity.',
    inputSchema: { search: z.string().optional(), in_stock: z.boolean().optional(), page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional() }, annotations: ro,
  }, async (a) => {
    const r = await zid.get('/v1/products/', { page: a.page || 1, page_size: a.page_size || 20, search: a.search, in_stock: a.in_stock === undefined ? undefined : String(a.in_stock) }, { kind: 'catalog' });
    return out({ total: r.count ?? r.results?.length, products: (r.results || []).map(compactProduct) });
  });

  server.registerTool('get_product', {
    title: 'Get product', description: 'One product by id: price, stock, variants, categories, rating.',
    inputSchema: { product_id: z.string() }, annotations: ro,
  }, async ({ product_id }) => {
    const r = await zid.get(`/v1/products/${encodeURIComponent(product_id)}/`, {}, { kind: 'catalog' });
    return out({ product: { ...compactProduct(r), variants: r.variants?.map(compactProduct), rating: r.rating } });
  });

  server.registerTool('low_stock', {
    title: 'Low stock report', description: 'Products at or below a stock threshold (excludes unlimited-stock items), lowest first.',
    inputSchema: { threshold: z.number().int().min(0).max(100000).optional() }, annotations: ro,
  }, async ({ threshold = 5 }) => {
    const list = [];
    for (let page = 1; page <= 20; page++) {
      const r = await zid.get('/v1/products/', { page, page_size: 100, quantity__lte: threshold, is_infinite: 'false' }, { kind: 'catalog' });
      list.push(...(r.results || []));
      if (!r.next || !(r.results || []).length) break;
    }
    const items = list.filter((p) => !p.is_infinite && Number(p.quantity) <= threshold).map(compactProduct).sort((x, y) => x.quantity - y.quantity);
    return out({ threshold, count: items.length, out_of_stock: items.filter((p) => p.quantity === 0).length, products: items });
  });

  server.registerTool('list_customers', {
    title: 'List customers', description: 'Customers with order count and total spend (personal data masked by default).',
    inputSchema: { search: z.string().optional(), page: z.number().int().min(1).optional(), per_page: z.number().int().min(1).max(100).optional() }, annotations: ro,
  }, async (a) => {
    const r = await zid.get('/v1/managers/store/customers', { page: a.page || 1, per_page: a.per_page || 20, search_term: a.search });
    return out({ total: r.total_customers_count ?? r.customers?.length, customers: (r.customers || []).map((c) => ({ id: c.id, name: c.name, email: c.email, mobile: c.mobile,
      city: pickName(c.city?.name), type: c.type, orders: c.order_counts, total_spent: c.order_total_payments, last_order_date: c.last_order_date, created_at: c.created_at })) });
  });

  server.registerTool('get_customer', {
    title: 'Get customer', description: 'One customer by id (masked by default).',
    inputSchema: { customer_id: z.union([z.string(), z.number()]) }, annotations: ro,
  }, async ({ customer_id }) => out(await zid.get(`/v1/managers/store/customers/${encodeURIComponent(customer_id)}`)));

  server.registerTool('abandoned_carts', {
    title: 'Abandoned carts', description: 'List abandoned carts (phase, value, reminders sent) for a date range.',
    inputSchema: { date_from: date.optional(), date_to: date.optional(), phase: z.string().optional(), page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional() }, annotations: ro,
  }, async (a) => {
    const r = await zid.get('/v1/managers/store/abandoned-carts', { page: a.page || 1, page_size: a.page_size || 20, date_from: a.date_from, date_to: a.date_to, phase: a.phase, filter_order_by: 'created_at', filter_sort_by: 'DESC' });
    return out({ pagination: r.pagination, carts: (r['abandoned-carts'] || r.abandoned_carts || []).map((c) => ({ id: c.id, phase: c.phase, total: Number(c.cart_total),
      currency: c.currency_code, products_count: c.products_count, reminders_sent: c.reminders_count, customer_name: c.customer_name, customer_mobile: c.customer_mobile, created_at: c.created_at, order_id: c.order_id })) });
  });

  server.registerTool('abandoned_carts_summary', {
    title: 'Abandoned carts summary', description: 'Total value left in abandoned carts, by checkout phase, and how many got no reminder — the revenue a follow-up campaign could recover.',
    inputSchema: { date_from: date.optional(), date_to: date.optional() }, annotations: ro,
  }, async (a) => {
    const carts = [];
    for (let page = 1; page <= 20; page++) {
      const r = await zid.get('/v1/managers/store/abandoned-carts', { page, page_size: 100, date_from: a.date_from, date_to: a.date_to });
      const b = r['abandoned-carts'] || r.abandoned_carts || [];
      carts.push(...b);
      if (b.length < 100 || !r.pagination?.next_page) break;
    }
    const open = carts.filter((c) => !c.order_id);
    const byPhase = open.reduce((m, c) => { m[c.phase] ??= { carts: 0, value: 0 }; m[c.phase].carts++; m[c.phase].value = r2(m[c.phase].value + Number(c.cart_total || 0)); return m; }, {});
    return out({ period: { from: a.date_from, to: a.date_to }, carts: open.length, value: r2(open.reduce((s, c) => s + Number(c.cart_total || 0), 0)),
      currency: open[0]?.currency_code || 'SAR', never_reminded: open.filter((c) => !Number(c.reminders_count)).length, by_phase: byPhase });
  });

  server.registerTool('list_coupons', {
    title: 'List coupons', description: 'Coupons with usage counts and status.',
    inputSchema: { status: z.enum(['coupon_active', 'coupon_inactive', 'coupon_expired', 'coupon_used', 'coupon_unstarted']).optional() }, annotations: ro,
  }, async (a) => {
    const r = await zid.get('/v1/managers/store/coupons', { page: 1, per_page: 100, discount_status: a.status });
    return out({ count: r.count ?? r.coupons?.length, coupons: (r.coupons || []).map((c) => ({ code: c.code, name: c.name, type: c.discount_type === 'p' ? 'percent' : 'fixed',
      discount: Number(c.discount), uses: c.total_usage, status: c.coupon_status, from: c.date_start, to: c.date_end })) });
  });

  server.registerTool('list_categories', {
    title: 'List categories', description: 'Product categories with product counts.',
    inputSchema: {}, annotations: ro,
  }, async () => {
    const r = await zid.get('/v1/managers/store/categories');
    return out({ categories: (r.categories || []).map((c) => ({ id: c.id, name: pickName(c.name), products: c.products_count, published: c.is_published })) });
  });

  return server;
}
