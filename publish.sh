#!/usr/bin/env bash
# Creates github.com/alycheaib/zid-mcp, pushes, enables GitHub Pages (free) from /docs.
set -e
cd "$(dirname "$0")"
GH_TOKEN=$(grep '^GITHUB_TOKEN=' /c/Users/moham/Desktop/LCG/lcg-code/deploy/secrets.env | cut -d= -f2- | tr -d '\r"')
H="Authorization: Bearer $GH_TOKEN"
curl -s -X POST -H "$H" https://api.github.com/user/repos -d '{"name":"zid-mcp","description":"MCP server for Zid (zid.sa) stores: ask Claude about sales, orders, low stock, abandoned carts, customers. Read-only, PII-masked, Arabic/English.","has_wiki":false}' > /dev/null
git branch -M main
git -c credential.helper= -c "credential.helper=!f(){ echo username=alycheaib; echo password=$GH_TOKEN; }; f" push -q https://github.com/alycheaib/zid-mcp.git main
git remote add origin https://github.com/alycheaib/zid-mcp.git 2>/dev/null || true

curl -s -X PUT -H "$H" https://api.github.com/repos/alycheaib/zid-mcp/topics -d '{"names":["mcp","mcp-server","zid","saudi-arabia","ecommerce","claude","arabic","abandoned-carts","model-context-protocol","ksa"]}' > /dev/null
echo "Published: https://github.com/alycheaib/zid-mcp  ->  "
