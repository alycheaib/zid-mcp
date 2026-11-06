// A fake Zid store (shapes follow docs.zid.sa) so the server can be tried, listed and tested without credentials.
const STATUSES = ['new', 'preparing', 'ready', 'indelivery', 'delivered', 'canceled'];
const PAY = ['zid_cod', 'zid_credit_card', 'zid_bank_transfer'];
const CITIES = ['الرياض', 'جدة', 'الدمام', 'مكة', 'المدينة', 'الخبر'];
const NAMES = ['محمد العتيبي', 'سارة القحطاني', 'عبدالله الشهري', 'نورة الدوسري', 'فهد الغامدي', 'ريم الحربي', 'خالد الزهراني', 'لمى المطيري'];
const PRODUCTS = [
  ['عطر عود ملكي 100مل', 'Royal Oud 100ml', 349, 4], ['بخور كمبودي فاخر', 'Cambodian Bakhoor', 189, 12], ['دهن عود 3 تولة', 'Oud Oil 3 Tola', 520, 2],
  ['مبخرة كهربائية', 'Electric Incense Burner', 129, 40], ['معطر مفارش', 'Linen Mist', 59, 85], ['طقم هدايا رمضان', 'Ramadan Gift Set', 279, 0],
  ['عطر مسك أبيض', 'White Musk', 159, 7], ['زيت ورد طائفي', 'Taif Rose Oil', 410, 3],
];

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function buildDemoStore(now = new Date('2026-11-06T12:00:00Z')) {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const products = PRODUCTS.map(([ar, en, price, qty], i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`, sku: `SKU-${100 + i}`, name: { ar, en }, price, sale_price: null,
    currency: 'SAR', quantity: qty, is_infinite: false, is_published: true, sold_products_count: Math.floor(r() * 300),
    categories: [{ id: 1, name: i < 3 || i > 5 ? 'عطور' : 'منزل' }], html_url: `https://demo.zid.store/products/${i}`,
    created_at: '2026-01-10 10:00:00', updated_at: '2026-10-01 10:00:00',
  }));
  const customers = NAMES.map((name, i) => ({
    id: 100 + i, name, email: `customer${i}@example.com`, mobile: `9665${String(10000000 + i * 1234567).slice(0, 8)}`,
    gender: i % 2 ? 'female' : 'male', type: 'individual', is_active: true, verified: true,
    city: { id: i, name: CITIES[i % CITIES.length] }, order_counts: 0, order_total_payments: 0, created_at: '2026-02-01 09:00:00',
  }));
  const orders = [];
  for (let i = 0; i < 60; i++) {
    const created = new Date(now.getTime() - Math.floor(r() * 45 * 86400000));
    const cust = pick(customers);
    const lines = Array.from({ length: 1 + Math.floor(r() * 3) }, () => { const p = pick(products); const q = 1 + Math.floor(r() * 2); return { id: p.id, sku: p.sku, name: p.name.ar, quantity: q, price: p.price, total: p.price * q }; });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const status = created > new Date(now.getTime() - 3 * 86400000) ? pick(['new', 'preparing', 'ready']) : pick(['delivered', 'delivered', 'delivered', 'indelivery', 'canceled']);
    const total = +(subtotal * 1.15 + 25).toFixed(2);
    cust.order_counts++; if (status !== 'canceled') cust.order_total_payments += total;
    orders.push({
      id: 68340000 + i, code: `ZD${5000 + i}`, invoice_number: `INV-${5000 + i}`, store_id: 999, store_name: 'متجر عبير للعطور (تجريبي)',
      order_status: { name: status, code: status }, display_status: { name: status, code: status }, currency_code: 'SAR',
      customer: { id: cust.id, name: cust.name, email: cust.email, mobile: cust.mobile },
      order_total: total, order_total_string: `${total} ر.س`, payment_status: status === 'canceled' ? 'voided' : 'paid',
      payment: { method: { code: pick(PAY), name: 'payment' } }, shipping: { address: { city: { name: cust.city.name }, street: 'شارع الملك فهد' } },
      source: pick(['Store', 'Store App', 'Mazeed']), created_at: created.toISOString().replace('T', ' ').slice(0, 19), updated_at: created.toISOString().replace('T', ' ').slice(0, 19),
      products: lines,
    });
  }
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const p of products) p.sold_products_count = orders.filter((o) => o.order_status.code !== 'canceled').flatMap((o) => o.products).filter((l) => l.sku === p.sku).reduce((n, l) => n + l.quantity, 0);
  const carts = Array.from({ length: 14 }, (_, i) => {
    const c = pick(customers); const p = pick(products); const created = new Date(now.getTime() - Math.floor(r() * 10 * 86400000));
    const total = p.price * (1 + Math.floor(r() * 2));
    return { id: `cart-${i}`, cart_id: 7000 + i, phase: pick(['shipping_address', 'payment_method', 'shipping_method', 'login']), customer_id: c.id,
      customer_name: c.name, customer_email: c.email, customer_mobile: c.mobile, products_count: 1, reminders_count: Math.floor(r() * 2),
      cart_total: total, cart_total_string: `${total} ر.س`, currency_code: 'SAR', url: `https://demo.zid.store/cart/${i}`,
      created_at: created.toISOString().replace('T', ' ').slice(0, 19), products: [{ name: p.name.ar, quantity: 1, price: p.price }] };
  });
  const coupons = [
    { id: 1, code: 'WELCOME10', name: 'خصم الترحيب', discount_type: 'p', discount: 10, total_usage: 54, coupon_status: 'coupon_active', date_start: '2026-01-01', date_end: '2026-12-31' },
    { id: 2, code: 'RAMADAN25', name: 'رمضان', discount_type: 'p', discount: 25, total_usage: 212, coupon_status: 'coupon_expired', date_start: '2026-02-18', date_end: '2026-03-20' },
    { id: 3, code: 'SHIPFREE', name: 'شحن مجاني', discount_type: 'f', discount: 25, total_usage: 31, coupon_status: 'coupon_active', date_start: '2026-10-01', date_end: '2026-11-30' },
  ];
  return { products, customers, orders, carts, coupons, me: { id: 1, name: 'Demo Manager', email: 'owner@example.com', store: { id: 999, title: 'متجر عبير للعطور (تجريبي)', currency: 'SAR' } } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const pageOf = (arr, page, size) => { const p = Math.max(1, +page || 1), s = Math.max(1, +size || 15); return { items: arr.slice((p - 1) * s, p * s), pagination: { page: p, page_size: s, next_page: p * s < arr.length ? p + 1 : null, last_page: Math.max(1, Math.ceil(arr.length / s)), result_count: arr.length } }; };
const inRange = (d, from, to) => (!from || d.slice(0, 10) >= from) && (!to || d.slice(0, 10) <= to);

/** A fetch() replacement that answers like api.zid.sa. Also used by the tests. */
export function createDemoFetch(store = buildDemoStore(), { onRequest } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url); const q = Object.fromEntries(u.searchParams); const p = u.pathname.replace(/\/+$/, '');
    onRequest?.({ path: p, query: q, headers: init.headers, method: init.method });
    if ((init.method || 'GET') !== 'GET') return json({ message: 'read-only demo' }, 405);
    let m;
    if (p === '/v1/managers/account/me') return json({ status: 'object', user: store.me });
    if (p === '/v1/managers/store/orders') {
      let o = store.orders.filter((x) => inRange(x.created_at, q.date_from, q.date_to));
      if (q.order_status) o = o.filter((x) => x.order_status.code === q.order_status);
      if (q.payment_status) o = o.filter((x) => x.payment_status === q.payment_status);
      if (q.customer_id) o = o.filter((x) => String(x.customer.id) === q.customer_id);
      if (q.search_term) o = o.filter((x) => JSON.stringify(x).includes(q.search_term));
      const { items } = pageOf(o, q.page, q.per_page);
      const slim = q.payload_type === 'default' ? items : items.map(({ products, ...rest }) => rest);
      return json({ status: 'object', orders: slim, total_order_count: o.length });
    }
    if ((m = p.match(/^\/v1\/managers\/store\/orders\/(\d+)\/view$/))) {
      const o = store.orders.find((x) => String(x.id) === m[1]);
      return o ? json({ status: 'object', order: o }) : json({ message: { description: 'Order not found' } }, 404);
    }
    if (p === '/v1/products') {
      let pr = store.products;
      if (q.search) pr = pr.filter((x) => JSON.stringify(x.name).includes(q.search) || x.sku.includes(q.search));
      if (q.quantity__lte) pr = pr.filter((x) => !x.is_infinite && x.quantity <= +q.quantity__lte);
      if (q.in_stock === 'true') pr = pr.filter((x) => x.is_infinite || x.quantity > 0);
      const { items } = pageOf(pr, q.page, q.page_size);
      return json({ count: pr.length, next: null, previous: null, results: items });
    }
    if ((m = p.match(/^\/v1\/products\/([\w-]+)$/))) {
      const pr = store.products.find((x) => x.id === m[1] || x.sku === m[1]);
      return pr ? json(pr) : json({ detail: 'Not found.' }, 404);
    }
    if (p === '/v1/managers/store/customers') {
      let c = store.customers;
      if (q.search_term) c = c.filter((x) => JSON.stringify(x).includes(q.search_term));
      const { items } = pageOf(c, q.page, q.per_page);
      return json({ status: 'object', customers: items, total_customers_count: c.length });
    }
    if ((m = p.match(/^\/v1\/managers\/store\/customers\/(\d+)$/))) {
      const c = store.customers.find((x) => String(x.id) === m[1]);
      return c ? json({ status: 'object', customer: c }) : json({ message: { description: 'not found' } }, 404);
    }
    if (p === '/v1/managers/store/abandoned-carts') {
      let c = store.carts.filter((x) => inRange(x.created_at, q.date_from, q.date_to));
      if (q.phase) c = c.filter((x) => x.phase === q.phase);
      const { items, pagination } = pageOf(c, q.page, q.page_size);
      return json({ status: 'object', 'abandoned-carts': items.map(({ products, ...x }) => x), pagination });
    }
    if ((m = p.match(/^\/v1\/managers\/store\/abandoned-carts\/([\w-]+)$/))) {
      const c = store.carts.find((x) => x.id === m[1]);
      return c ? json({ status: 'object', abandoned_cart: c }) : json({ message: { description: 'not found' } }, 404);
    }
    if (p === '/v1/managers/store/coupons') {
      let c = store.coupons;
      if (q.discount_status) c = c.filter((x) => x.coupon_status === q.discount_status);
      const { items, pagination } = pageOf(c, q.page, q.per_page);
      return json({ status: 'object', coupons: items, count: c.length, pagination });
    }
    if (p === '/v1/managers/store/categories') return json({ status: 'object', categories: [{ id: 1, name: 'عطور', products_count: 5 }, { id: 2, name: 'منزل', products_count: 3 }] });
    return json({ message: { description: `unknown path ${p}` } }, 404);
  };
}
