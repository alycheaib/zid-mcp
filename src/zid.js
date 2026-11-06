// Read-only client for the Zid merchant API (https://docs.zid.sa).
// Auth (per docs.zid.sa/authorization): `Authorization: Bearer <authorization>` + `X-Manager-Token: <access_token>`.
// The catalogue endpoints (/v1/products) use `Access-Token`, `Store-Id` and `Role: Manager` instead.
// Rate limit: 60 requests / minute per app per store (leaky bucket) -> we space calls and retry on 429.

export const BASE_URL = 'https://api.zid.sa';

export function loadConfig(env = process.env) {
  return {
    baseUrl: (env.ZID_BASE_URL || BASE_URL).replace(/\/+$/, ''),
    authorization: (env.ZID_AUTHORIZATION || '').replace(/^Bearer\s+/i, '').trim(),
    managerToken: (env.ZID_MANAGER_TOKEN || env.ZID_ACCESS_TOKEN || '').trim(),
    storeId: (env.ZID_STORE_ID || '').trim(),
    language: env.ZID_LANGUAGE === 'en' ? 'en' : 'ar',
    maskPii: env.ZID_MASK_PII !== '0',
    minIntervalMs: Number(env.ZID_MIN_INTERVAL_MS ?? 1000),
    demo: env.ZID_DEMO === '1',
  };
}

export class ZidError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export class ZidClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.c = config;
    this.fetch = fetchImpl;
    this.last = 0;
    this.queue = Promise.resolve();
  }

  missingCredentials() {
    const m = [];
    if (!this.c.authorization) m.push('ZID_AUTHORIZATION');
    if (!this.c.managerToken) m.push('ZID_MANAGER_TOKEN');
    return m;
  }

  /** Serialise requests and keep >= minIntervalMs between them (60/min). */
  async throttle() {
    const run = this.queue.then(async () => {
      const wait = this.last + this.c.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  headers(kind) {
    const h = { Accept: 'application/json', 'Accept-Language': this.c.language };
    if (this.c.authorization) h.Authorization = `Bearer ${this.c.authorization}`;
    if (kind === 'catalog') {
      h['Access-Token'] = this.c.managerToken;
      h.Role = 'Manager';
      if (this.c.storeId) h['Store-Id'] = this.c.storeId;
    } else {
      h['X-Manager-Token'] = this.c.managerToken;
    }
    return h;
  }

  /** GET only — this server never writes to the store. */
  async get(path, query = {}, { kind = 'manager' } = {}) {
    const missing = this.missingCredentials();
    if (missing.length) throw new ZidError(`Missing ${missing.join(' and ')}. See the README: create a private app in the Zid Partner Dashboard (or use ZID_DEMO=1 to try with sample data).`);
    if (kind === 'catalog' && !this.c.storeId) throw new ZidError('ZID_STORE_ID is required for product endpoints (your numeric store id).');
    const url = new URL(this.c.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    for (let attempt = 1; ; attempt++) {
      await this.throttle();
      let res;
      try {
        res = await this.fetch(url, { method: 'GET', headers: this.headers(kind), signal: AbortSignal.timeout(30000) });
      } catch (e) {
        if (attempt < 3) continue;
        throw new ZidError(`Network error calling Zid: ${e.message}`);
      }
      if (res.status === 429 && attempt < 4) {
        const h = res.headers.get('retry-after'); const ra = h !== null && Number.isFinite(Number(h)) ? Number(h) : attempt * 5;
        await new Promise((r) => setTimeout(r, ra * 1000));
        continue;
      }
      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
      if (res.status === 401 || res.status === 403) throw new ZidError(`Zid rejected the credentials (${res.status}). Check ZID_AUTHORIZATION / ZID_MANAGER_TOKEN and the app's scopes.`, res.status);
      if (res.status === 404) throw new ZidError(`Not found (404): ${url.pathname}`, 404);
      if (!res.ok) throw new ZidError(`Zid API error ${res.status}: ${body?.message?.description || body?.message?.name || JSON.stringify(body).slice(0, 200)}`, res.status);
      return body;
    }
  }
}

// ---------- PII masking (on by default) ----------
const maskEmail = (e) => (typeof e === 'string' && e.includes('@') ? e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1***$2***$3') : e);
const maskPhone = (p) => (typeof p === 'string' && p.replace(/\D/g, '').length >= 6 ? p.replace(/\d(?=\d{2})/g, '*') : p);
const maskName = (n) => (typeof n === 'string' ? n.split(/\s+/).map((w) => (w ? w[0] + '***' : w)).join(' ') : n);

const PII_KEYS = {
  email: maskEmail, customer_email: maskEmail, pivotEmail: maskEmail,
  mobile: maskPhone, phone: maskPhone, customer_mobile: maskPhone, telephone: maskPhone, pivotMobile: maskPhone,
  name: null, customer_name: maskName, birth_date: () => '***', tax_number: null, commercial_registration: null,
  address: () => '***', street: () => '***', address_line: () => '***', lat: () => null, lng: () => null,
};

/** Recursively mask personal data. `name` is only masked inside customer-like objects. */
export function maskPii(value, inCustomer = false) {
  if (Array.isArray(value)) return value.map((v) => maskPii(v, inCustomer));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const customerish = inCustomer || /customer|consignee|receiver|sender|address/i.test(k);
    if (k in PII_KEYS && typeof v !== 'object') {
      const fn = PII_KEYS[k];
      out[k] = fn ? fn(v) : (customerish ? (k === 'name' ? maskName(v) : '***') : v);
    } else out[k] = maskPii(v, customerish);
  }
  return out;
}
