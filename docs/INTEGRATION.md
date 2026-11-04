# Connect any agent

Your agent needs only RELAY_URL and BOT_TOKEN from your own secret store. It does not need Expo, Cloudflare, or Apple credentials to update dashboard content. Those credentials are for deployment. Any agent capable of HTTPS can use this interface, regardless of provider, framework, or operating system.

```sh
# Load these from your secret manager; never commit a literal token.
export RELAY_URL=https://your-relay.workers.dev
curl -fsS "$RELAY_URL/state" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/widget" -H "Authorization: Bearer $BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"metric","data":{"label":"Tasks completed","value":"3","delta":"+1","color":"#007AFF"}}'
curl -fsS "$RELAY_URL/notify" -H "Authorization: Bearer $BOT_TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Your agent","body":"Your report is ready."}'
curl -fsS "$RELAY_URL/actions?cursor=0&limit=50" -H "Authorization: Bearer $BOT_TOKEN"
```

Persist the returned nextCursor after processing events. Route actionId to an allowlisted handler. Multiple agents may share the relay, but all share one dashboard and the same bot-level authority. Use separate deployments for trust isolation; this is not a multi-tenant authorization system. Coordinate writes using the revision field and retry HTTP 409 by reading and merging. Polling requires no inbound server on the agent; optional HMAC-signed webhooks are described in OPERATIONS.md.

For full app changes, your agent can push to your own GitHub repo and use its configured Ship workflow. For content changes, use the API directly: no build or OTA needed.
