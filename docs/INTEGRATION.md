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
curl -fsS "$RELAY_URL/pages" -X POST -H "Authorization: Bearer $BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"briefing","title":"Morning briefing","markdown":"## Today\n\nReview the queue."}'
curl -fsS "$RELAY_URL/notify" -H "Authorization: Bearer $BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Briefing","body":"Your page is ready.","pageId":"briefing"}'
curl -fsS "$RELAY_URL/actions?cursor=0&limit=50" -H "Authorization: Bearer $BOT_TOKEN"
```

`pageId` on `/notify` must name a page already stored with `POST /pages`. Tapping that notification opens the page. `GET /pages` lists pages for the bot or a paired phone, and `DELETE /pages/:id` removes one. Optional `keepUntil` is an ISO datetime after which the page is no longer readable.

Persist the returned nextCursor after processing events. Route actionId to an allowlisted handler. Multiple agents may share the relay, but all share one dashboard and the same bot-level authority. Use separate deployments for trust isolation; this is not a multi-tenant authorization system. Coordinate writes using the revision field and retry HTTP 409 by reading and merging. Polling requires no inbound server on the agent; optional HMAC-signed webhooks are described in OPERATIONS.md.

For full app changes, your agent can push to your own GitHub repo and use its configured Ship workflow. For content changes, use the API directly: no build or OTA needed.

## Multiple independent widgets

Use `POST /widget` with `id`, `name`, `kind`, `data`, and `revision` (0 to create;
current value to replace). `GET /widgets` lists all named content and revisions;
`DELETE /widgets/:id?revision=N` removes one. Up to 100 items across all kinds.
Omitting id still updates the original default widget. Named content survives
POST /state replacements. See OPERATIONS.md's Independent named widgets section
for curl examples, configuration instructions and action context.

The user chooses each placed widget's Content in iOS Edit Widget. Agent should
create catalog entries before asking the user to select them, keep IDs stable,
and author pageId destinations when richer context is available. New clients
sync `/state?widgets=1`; old clients retain the legacy response. Named grid taps
carry widgetId. Never claim a widget is placed or refreshed solely because APNs
accepted its push; iOS controls placement and refresh scheduling.

## Receive report feedback

Handle `actionId: "report-feedback"` in the signed webhook or the existing
cursor-based `/actions` consumer. Pass `feedback.text`, the full `feedback.page`
snapshot and widget metadata to the agent named by `agentId`. Tag named widgets
with top-level `agentId` and authored pages with `agentId` when publishing. Missing
agentId means the default assistant. Report feedback is a user message, not a
shell command or trading order. See OPERATIONS.md for input, event shape,
idempotency, snapshot semantics and a copyable agent-setup instruction.

## Action receiver setup (works without a webhook)

An agent reading this repository should configure both publication and receipt.
The relay does not know how to invoke a particular model or conversation; the
operator supplies that small adapter. Polling needs no inbound port or new key.

1. Create a trusted executable handler on the agent's Linux host. It reads one
   complete event as JSON from stdin. For `actionId=report-feedback`, route to
   `agentId` (or the default assistant), submit `feedback.text` together with
   `feedback.page` and widget metadata to that agent's conversation/inbox, and
   return exit status 0 only after the inbox has accepted it durably.
2. Deduplicate by event.id inside that inbox/handler. Delivery is at least once:
   a crash after the handler accepts but before the cursor saves can replay it.
   Dispatch other action IDs to the existing handlers; do not execute text as code.
3. Load RELAY_URL and BOT_TOKEN from the existing secret store. Set ACTION_HANDLER
   to the adapter's absolute executable path. Run from repository root:

```sh
export ACTION_HANDLER=/absolute/path/to/your-agent-action-handler
export ACTION_CURSOR_FILE=/absolute/persistent/path/noticeboard-actions.json
node relay/scripts/consume-actions.mjs
# Or invoke once from an existing scheduler:
node relay/scripts/consume-actions.mjs --once
```

The bridge polls every 10 seconds, drains backlogs in batches of 100, passes each
event on stdin without a shell, and advances the durable cursor only after that
handler succeeds. A failure exits nonzero; use your process supervisor's restart
policy. With --once, an existing scheduler can retry. Keep one receiver per cursor
file. The default cursor file is .agent-state/actions.json (gitignored). Files are
private to the user. Do not delete/reset the cursor casually: absent state starts
at cursor 0 and delivers history. The handler should recognize already-handled
UUIDs. A receiver crash can leave a .lock directory next to the cursor; verify no
receiver is running before removing that stale lock and restarting.

For multiple agents, prefer one dispatcher whose handler routes by agentId. If
using independent receivers, give each its own persistent cursor and deliberately
ignore events assigned to another agent. Unknown IDs should go to an operator
inbox, not disappear. The bridge cannot invent a model-specific API or credentials;
wire the handler to your existing agent runtime, then send a test from the phone
and confirm the same event ID arrived in the intended conversation.

WEBHOOK_URL plus WEBHOOK_SECRET remains an alternative for immediate push delivery.
Validate its HMAC and use the same event handler/deduplication logic. Do not run two
receivers for the same agent without shared event-ID deduplication.
