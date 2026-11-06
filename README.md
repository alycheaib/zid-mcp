# zid-mcp: ask Claude about your Zid store · اسأل Claude عن متجرك في زد

An [MCP](https://modelcontextprotocol.io) server for **[Zid](https://zid.sa)** stores, the Saudi e-commerce platform. Ask Claude, Cursor or any MCP client in Arabic or English:

> «كيف كانت مبيعاتي هذا الشهر؟ ما المنتجات التي ستنفد؟ كم خسرت في السلات المتروكة؟»
> "How were sales this month? What's about to run out? How much is sitting in abandoned carts?"

**Read-only by design:** it only sends `GET` requests and never changes your store. **Customer personal data is masked by default.** It respects Zid's limit of 60 requests a minute.

## Tools (13)
| Tool | What it answers |
|---|---|
| `sales_summary` | Revenue, orders, average order value, breakdown by status, payment method, city and day, top products |
| `low_stock` | Products at or below a stock threshold, out-of-stock first |
| `abandoned_carts_summary` | Money left in abandoned carts, by checkout step, and how many never got a reminder |
| `list_orders` / `get_order` | Orders filtered by status, payment, dates or customer; full order details |
| `list_products` / `get_product` | Catalogue search, prices, stock, variants |
| `list_customers` / `get_customer` | Customers with order count and total spend (masked) |
| `abandoned_carts` | Abandoned carts with phase and value |
| `list_coupons` | Coupons with usage and status |
| `list_categories` | Categories with product counts |
| `store_info` | The connected account (connection test) |

## Try it in 30 seconds (demo store, no Zid account needed)
```bash
claude mcp add zid -e ZID_DEMO=1 -- npx -y github:alycheaib/zid-mcp
```
Then ask Claude: *"كيف كانت مبيعات متجري آخر 30 يوماً؟"*

## Connect your real store
1. In the **[Zid Partner Dashboard](https://partner.zid.sa)**, create an app with read scopes (orders, products, customers, abandoned carts, coupons, categories). Install it on your store, or use a private app if your plan includes **API Access**.
2. Complete the OAuth flow (see [docs.zid.sa/authorization](https://docs.zid.sa/authorization)). You receive an `authorization` token (JWT) and an `access_token` (the manager token).
3. Add it to Claude:

**Claude Code**
```bash
claude mcp add zid \
  -e ZID_AUTHORIZATION=<authorization> \
  -e ZID_MANAGER_TOKEN=<access_token> \
  -e ZID_STORE_ID=<store id> \
  -- npx -y github:alycheaib/zid-mcp
```

**Claude Desktop** (`claude_desktop_config.json`)
```json
{ "mcpServers": { "zid": { "command": "npx", "args": ["-y", "github:alycheaib/zid-mcp"],
  "env": { "ZID_AUTHORIZATION": "…", "ZID_MANAGER_TOKEN": "…", "ZID_STORE_ID": "…" } } } }
```

| Env var | |
|---|---|
| `ZID_AUTHORIZATION` | Authorization token (JWT); the `Bearer ` prefix is optional |
| `ZID_MANAGER_TOKEN` | Store manager token (`access_token`) |
| `ZID_STORE_ID` | Numeric store ID (needed for product endpoints) |
| `ZID_LANGUAGE` | `ar` (default) or `en` |
| `ZID_MASK_PII` | `0` shows full customer names, phones and emails (default: masked) |
| `ZID_DEMO` | `1` uses the built-in demo store |

Tokens stay on your machine and are sent only to `api.zid.sa`.

## Develop
```bash
npm install && npm test   # 7 tests: headers per Zid docs, maths, masking, retries, rate limit, stdio end-to-end
```
Endpoints and headers follow the official OpenAPI reference at docs.zid.sa (orders `/v1/managers/store/orders`, catalogue `/v1/products`, abandoned carts, customers, coupons, categories).

## Need more? · تحتاج أكثر؟
- A WhatsApp agent that answers your customers from live Zid data
- Abandoned-cart recovery campaigns
- Dashboards
- Odoo/ERP sync and ZATCA invoices

**[Request a quote · اطلب عرض سعر](https://github.com/alycheaib/zid-mcp/issues/new?template=custom-work.yml)**

Also from me: [mena-mcp](https://github.com/alycheaib/mena-mcp) (Gulf VAT, ZATCA QR, end-of-service, SOC 2/ISO 27001) · [shorts-studio](https://github.com/alycheaib/shorts-studio) · [Gulf calculators](https://alycheaib.github.io/gulf-calculators/)

*Not affiliated with Zid. "Zid" is a trademark of its owner.* MIT © Aly Cheaib
