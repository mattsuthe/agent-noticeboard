# Report-linked conversations

This additive relay contract lets an app attach follow-ups to an immutable report
snapshot and receive observable acknowledgments and replies. Existing `/feedback`,
`/state`, widgets and action consumers remain compatible. The template's existing
feedback screen still uses `/feedback`; a client must adopt the endpoints below
to display threads and delivery states.

Apply migration `0006_report_threads.sql` before deploying the new Worker. No new
secret or model provider is required. Use existing per-device authentication for
app calls and `BOT_TOKEN` for receiver calls. Never embed bot credentials in an app.

## App contract

- `POST /messages`: `{id,pageId,pageUpdatedAt,text}`; `id` is a UUID, text is 1–4000
  characters. Persist the ID, text and report version before sending. Reuse the
  same payload on retry. 202 means Submitted; it does not mean agent receipt.
- `GET /conversations?pageId=<id>&version=<ISO timestamp>`: `{thread:null}` before
  the first message, otherwise the snapshot, owner and messages for this device.
- `GET /conversations/<threadId>`: same data, restricted to the owning device.

Keep drafts across interruptions. A conflicting retry ID returns 409. Starting a
thread against a changed report returns 409; preserve the draft and let the user
review the current report. An established conversation remains anchored to its
original report and agent, even after the published source is edited or removed.

## Agent contract

The existing `report-feedback` action now optionally includes `threadId` and
`messageId`, with the same complete `feedback.page` snapshot. Poll `/actions` or
receive the existing HMAC-signed webhook. Deduplicate by event ID, route by agentId,
and durably accept the event into the intended agent's inbox before acknowledging.

```sh
curl -fsS "$RELAY_URL/conversations/$THREAD_ID" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/messages/ack" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"messageId":"<user-message-uuid>"}'
curl -fsS "$RELAY_URL/messages/reply" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"id":"<stable-reply-uuid>","messageId":"<user-message-uuid>","text":"Your response"}'
```

Receipts and replies are idempotent. Reusing a reply ID for different content
returns 409. A reply also acknowledges its parent message. Message ordering uses
an insertion sequence rather than relying on timestamp uniqueness.

The polling bridge now acknowledges new conversation events after the trusted
handler succeeds and before checkpointing. If acknowledgment fails, the cursor
is retained. Handler success must mean durable acceptance; handler deduplication
makes retries safe. Legacy events without `messageId` keep their existing behavior.

Display Sending during an in-flight request, Submitted after acceptance,
Received by agent only when `receivedAt` is present, and Reply available only
when an agent message exists. A real integration is complete only after an actual
client → intended agent → reply round trip. Synthetic tests do not establish that.

For rollback, restore the previous Worker/client version and retain the additive
tables and conversation data. Old code ignores the new tables.
