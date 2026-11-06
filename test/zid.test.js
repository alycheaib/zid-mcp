import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ZidClient, loadConfig, maskPii } from '../src/zid.js';
import { createDemoFetch, buildDemoStore } from '../src/demo.js';
import { createServer } from '../src/server.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const creds = { ZID_AUTHORIZATION: 'Bearer jwt-abc', ZID_MANAGER_TOKEN: 'mgr-123', ZID_STORE_ID: '999', ZID_MIN_INTERVAL_MS: '0' };

async function inMemory(env, fetchImpl) {
  const server = createServer({ env, fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return r.structuredContent;
  };
  return { client, call };
}

test('sends the documented Zid headers (manager vs catalogue endpoints) and only GETs', async () => {
  const seen = [];
  const { call } = await inMemory(creds, createDemoFetch(buildDemoStore(), { onRequest: (r) => seen.push(r) }));
  await call('list_orders', { order_status: 'delivered' });
  await call('list_products', { search: 'عود' });
  const o = seen.find((r) => r.path === '/v1/managers/store/orders');
  assert.equal(o.headers.Authorization, 'Bearer jwt-abc');
  assert.equal(o.headers['X-Manager-Token'], 'mgr-123');
  assert.equal(o.headers['Accept-Language'], 'ar');
  assert.equal(o.query.order_status, 'delivered');
  const p = seen.find((r) => r.path === '/v1/products');
  assert.equal(p.headers['Access-Token'], 'mgr-123');
  assert.equal(p.headers['Store-Id'], '999');
  assert.equal(p.headers.Role, 'Manager');
  assert.ok(seen.every((r) => r.method === 'GET'));
});

test('sales summary adds up and excludes canceled orders', async () => {
  const store = buildDemoStore();
  const { call } = await inMemory(creds, createDemoFetch(store));
  const s = await call('sales_summary', { date_from: '2026-09-01', date_to: '2026-11-30' });
  const expected = store.orders.filter((o) => o.order_status.code !== 'canceled');
  assert.equal(s.orders, expected.length);
  assert.equal(s.revenue, Math.round(expected.reduce((n, o) => n + o.order_total, 0) * 100) / 100);
  assert.equal(s.canceled, store.orders.length - expected.length);
  assert.ok(s.top_products.length > 0 && s.top_products[0].revenue >= s.top_products.at(-1).revenue);
  assert.equal(Object.values(s.by_status).reduce((n, x) => n + x.orders, 0), s.orders);
  assert.ok(!('canceled' in s.by_status));
});

test('low stock, abandoned carts summary, coupons, categories, single records', async () => {
  const store = buildDemoStore();
  const { call } = await inMemory(creds, createDemoFetch(store));
  const ls = await call('low_stock', { threshold: 4 });
  assert.deepEqual(ls.products.map((p) => p.quantity), [0, 2, 3, 4]);
  assert.equal(ls.out_of_stock, 1);
  const ac = await call('abandoned_carts_summary', {});
  assert.equal(ac.carts, store.carts.length);
  assert.equal(ac.value, Math.round(store.carts.reduce((n, c) => n + c.cart_total, 0) * 100) / 100);
  assert.equal((await call('list_coupons', { status: 'coupon_active' })).count, 2);
  assert.equal((await call('list_categories')).categories.length, 2);
  const ord = await call('get_order', { order_id: store.orders[0].id });
  assert.equal(ord.order.code, store.orders[0].code);
  assert.ok(ord.order.items.length >= 1);
  const prod = await call('get_product', { product_id: store.products[0].id });
  assert.equal(prod.product.sku, 'SKU-100');
  await assert.rejects(call('get_order', { order_id: 1 }), /Not found/);
});

test('personal data is masked by default and can be turned off', async () => {
  const store = buildDemoStore();
  const masked = await (await inMemory(creds, createDemoFetch(store))).call('list_customers', {});
  const c0 = store.customers[0];
  const m0 = masked.customers.find((c) => c.id === c0.id);
  assert.notEqual(m0.email, c0.email);
  assert.match(m0.email, /\*\*\*/);
  assert.notEqual(m0.mobile, c0.mobile);
  assert.notEqual(m0.name, c0.name);
  const orders = await (await inMemory(creds, createDemoFetch(store))).call('list_orders', {});
  assert.ok(orders.orders.every((o) => !o.customer || o.customer.email.includes('***')));
  const carts = await (await inMemory(creds, createDemoFetch(store))).call('abandoned_carts', {});
  assert.ok(carts.carts.every((c) => c.customer_mobile.includes('*')));
  const open = await (await inMemory({ ...creds, ZID_MASK_PII: '0' }, createDemoFetch(store))).call('list_customers', {});
  assert.equal(open.customers.find((c) => c.id === c0.id).email, c0.email);
  assert.equal(maskPii({ products: [{ name: 'عطر' }] }).products[0].name, 'عطر');
});

test('clear errors: missing credentials, missing store id, 401, and 429 retry', async () => {
  const { call } = await inMemory({ ZID_MIN_INTERVAL_MS: '0' }, createDemoFetch());
  await assert.rejects(call('list_orders', {}), /Missing ZID_AUTHORIZATION and ZID_MANAGER_TOKEN/);
  const noStore = await inMemory({ ...creds, ZID_STORE_ID: '' }, createDemoFetch());
  await assert.rejects(noStore.call('list_products', {}), /ZID_STORE_ID is required/);
  const unauth = await inMemory(creds, async () => new Response('{}', { status: 401 }));
  await assert.rejects(unauth.call('store_info'), /rejected the credentials \(401\)/);
  let n = 0;
  const flaky = new ZidClient(loadConfig(creds), async () => (++n === 1
    ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
    : new Response('{"ok":1}', { status: 200 })));
  assert.deepEqual(await flaky.get('/v1/x'), { ok: 1 });
  assert.equal(n, 2);
});

test('rate limiter spaces requests (60/min default)', async () => {
  const times = [];
  const c = new ZidClient(loadConfig({ ...creds, ZID_MIN_INTERVAL_MS: '150' }), async () => { times.push(Date.now()); return new Response('{}'); });
  await Promise.all([c.get('/a'), c.get('/b'), c.get('/c')]);
  assert.ok(times[1] - times[0] >= 140 && times[2] - times[1] >= 140, JSON.stringify(times));
  assert.equal(loadConfig({}).minIntervalMs, 1000);
});

test('stdio server in demo mode (ZID_DEMO=1) answers end to end', async () => {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/cli.js')], env: { ...process.env, ZID_DEMO: '1' } }));
  const { tools } = await client.listTools();
  try {
  assert.equal(tools.length, 13);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  const r = await client.callTool({ name: 'store_info', arguments: {} });
  assert.equal(r.structuredContent.demo, true);
  const s = await client.callTool({ name: 'sales_summary', arguments: { date_from: '2026-10-01', date_to: '2026-11-06' } });
  assert.ok(s.structuredContent.revenue > 0);
  } finally { await client.close(); }
});
