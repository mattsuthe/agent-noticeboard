# Agent Noticeboard operations — Linux operator

Read [SETUP.md](SETUP.md) first. Every installation uses its own Apple, Expo and Cloudflare resources. All devices on one relay share one dashboard.

## First deployment

1. Clone your own repo and run `npm ci`, `npm run typecheck`, `npm test`.
2. Run `npx wrangler login`, then `npx wrangler d1 create agent-noticeboard`. Put the returned database ID into `relay/wrangler.jsonc` (replace the explicit placeholder). Set Cloudflare account ID in the CI variable `CLOUDFLARE_ACCOUNT_ID`.
3. From `relay/`, run `npx wrangler d1 migrations apply agent-noticeboard --remote`.
4. Create a random 32-byte bot token locally. Install it using `npx wrangler secret put BOT_TOKEN`. Supply values only through the prompt or secret manager, never shell command arguments committed into logs.
5. In Apple Developer, register both bundle IDs, App Group and capabilities. Create an APNs authentication key allowed for the app's push topics. Set Wrangler secrets `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`. The `.p8` belongs in the secret store, not this repository. TestFlight uses production APNs.
6. Optional webhook: set `WEBHOOK_URL` and `WEBHOOK_SECRET` with Wrangler secrets. Use a trusted HTTPS endpoint. Both are required to enable forwarding.
7. Run `npm run relay:deploy` from repository root. Save the resulting HTTPS origin as your relay URL.
8. Run `npx eas-cli login`, create your own Expo project, then run the configuration command in SETUP.md. Verify it with `npx eas-cli project:info` from `app/`.
9. Set `EXPO_PROJECT_ID=00000000-0000-0000-0000-000000000002` and `EXPO_OWNER=YOUR_EXPO_OWNER` as GitHub repository variables. In GitHub's `production` environment, store `EXPO_TOKEN` and a narrowly scoped `CLOUDFLARE_API_TOKEN` for Worker deployment and D1 migrations.
10. Create the App Store Connect app, SKU `agent-noticeboard`, bundle `com.example.agentnoticeboard`. Add its `ascAppId` to `app/eas.json` under `submit.production.ios`. Configure the App Store Connect API key with `eas credentials -p ios`. Let EAS generate and store signing certificates/profiles for both app targets. Initial Apple authentication may require the owner; unattended submission uses the API key.
11. Build with `eas build -p ios --profile production --auto-submit`. Confirm Apple processing completes. Create an **internal** TestFlight group, add the owner as an eligible App Store Connect internal tester, and enable automatic distribution. Do not create an external group or submit for public review.
12. Install TestFlight and the app on the owner's iPhone. Create a pairing code, enter it with the relay URL, or encode `qrPayload` as a QR and scan it. Grant notifications and add the desired widgets. Lock Screen widgets (Bot Card, Metric) are added from the Lock Screen customizer. Chart is a Home Screen widget and is the one to use in StandBy alongside Metric. Siri, Shortcuts, and the Action Button list "Send to Agent" and "Run Button" after this build is installed.

The generated extension is declared in `extra.eas.build.experimental.ios.appExtensions` so EAS can provision it before prebuild. The plugin generates its sources, entitlements, target dependency and embed phase. Never hand-edit generated `app/ios`; change the plugin or source files.

## Shipping

Run commands from `app/` unless noted. The project and owner in `app.config.ts` must match the installed production app.

### Data changes: no release

Call `/state` or `/widget`. Existing renderers and layouts display new data. Widget/APNs refresh is best effort; data is fetched on the next permitted timeline refresh.

### JavaScript-only changes

```sh
npm ci # from repository root
npm run typecheck
npm test
cd app
eas update --channel production --platform ios --environment production --message "Describe the change"
```

Only use this after confirming the native fingerprint matches the installed production runtime. EAS Update applies on a subsequent reload/relaunch, not necessarily in the currently open session. To demonstrate OTA, change visible app text, publish, reopen to download, then reopen again to apply; verify the binary build number stayed unchanged.

### Native changes

Changes to SDK/native dependencies, Swift sources, config plugins, entitlements, widget layout, ActivityKit attributes, app identifiers or deployment target require a new build. Lock Screen families, the Chart widget, StandBy layout, Live Activity layout, and Siri/Shortcuts/Action Button intents are native. Chart and decision-button JSON can be posted without another release only after that binary is installed; the previous app build rejects unknown widget keys.

```sh
eas build -p ios --profile production --auto-submit --non-interactive --wait
```

`runtimeVersion.policy` is `fingerprint`. Do not replace it with a fixed version or manually send incompatible updates. All widget Swift and plugin inputs must participate in the fingerprint. Widget **data** can change without rebuilding; widget **layout code** cannot.

### Automated releases

Push to `main`: Ship calls the reusable Verify workflow for TypeScript, relay integration tests, JS export, hosted native compilation and simulator launch. Only after verification succeeds, Ship compares the whole push against its previous commit and deploys changed relay code/migrations and runs `scripts/ship-mobile.mjs` for app/shared changes. OTA requires a matching production fingerprint, a successful EAS submission, and a build less than 80 days old. Otherwise it builds and submits. API errors stop the release rather than guessing. Confirm Apple processing and internal-group distribution after submission; EAS upload success alone cannot prove installation. A failed submission can be retried with `eas submit -p ios --id BUILD_ID --profile production --non-interactive`.

The workflow runs a forced build on the first of every month at 14:00 UTC. TestFlight builds expire after 90 days; monthly rebuilds provide overlap. A successful upload is not proof of tester availability: check App Store Connect processing and internal group distribution. Enable GitHub failure notifications and inspect any failed Ship run promptly.

For manual execution: `gh workflow run ship.yml`. For an update rollback, use `eas update:republish --group GOOD_UPDATE_GROUP --channel production --platform ios` after checking the intended runtime. For a native regression, ship a corrected new binary; TestFlight users can select an earlier unexpired build. For relay rollback, use `npx wrangler rollback` from `relay/`; keep D1 migrations backward-compatible and do not drop data as part of rollback.

## Authentication and enrollment

Bot: `Authorization: Bearer $BOT_TOKEN`.
Device: `Authorization: Bearer $DEVICE_SECRET` plus `X-Device-ID: $DEVICE_ID`.

Per-device secrets are generated during single-use enrollment, stored in iOS Keychain, and stored as hashes in D1. They are not Wrangler environment secrets. Relay operator secrets are Wrangler secrets only; CI deployment credentials live in GitHub secrets. Never put `BOT_TOKEN` in the app or pairing URL.

```sh
export RELAY_URL=https://your-worker.workers.dev
# Load BOT_TOKEN from your secret manager without echoing it.
curl -fsS "$RELAY_URL/pairings" -X POST -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{}'
# Returns code, expiresAt (epoch milliseconds), and qrPayload. Expires in 10 minutes.
curl -fsS "$RELAY_URL/register" -H 'Content-Type: application/json' -d '{"pairingCode":"ONE_TIME_CODE","name":"My iPhone"}'
# Returns deviceId and secret ONCE. The app normally performs this exchange.
curl -fsS "$RELAY_URL/register" -H "Authorization: Bearer $DEVICE_SECRET" -H "X-Device-ID: $DEVICE_ID" -H 'Content-Type: application/json' -d '{"tokens":{"device":"APNS_HEX_TOKEN","widget":"WIDGET_HEX_TOKEN","pushToStart":"START_HEX_TOKEN","activities":[{"id":"job-123","token":"ACTIVITY_HEX_TOKEN"}]}}'
```

Tokens are distinct. Never substitute an Expo push token for a native APNs token. The Swift observer registers remote-started activity update tokens independently of the JavaScript screen lifecycle. Tokens rotate; registration is repeatable.

## State contract

`GET /state` accepts device or bot authentication. Returns `schemaVersion:1`, `revision`, ISO `updatedAt`, `blocks`, and `widgets`. The canonical schema is `shared/schema.ts`; reject unsupported schema versions instead of guessing.

All blocks have unique `id` and `type`:

| Type | Fields |
|---|---|
| `text` | `text`, optional `title` |
| `markdown` | `markdown`; headings, emphasis, lists, inline/fenced code; no HTML or executable links |
| `metric` | `label`, `value` string, optional `delta`, optional `color` (`#RRGGBB`) |
| `list` | `items` string array, optional `title` |
| `image` | HTTPS `url`, accessibility `alt` |
| `button` | `label`, `actionId` |

Widget shapes:

```json
{
  "botCard":{"title":"Agent is ready","body":"Your update","timestamp":"2026-11-01T12:00:00Z"},
  "metric":{"label":"Tasks","value":"3","delta":"+1","color":"#92EDB9"},
  "buttonGrid":{"buttons":[{"id":"check-in","label":"Check in"}]},
  "chart":{"title":"Billable hours","unit":"h","target":8,"color":"#92EDB9","points":[{"label":"Mon","value":6},{"label":"Tue","value":7.5}]}
}
```

`chart` is optional. Readers treat a missing chart as an empty series titled "Chart" with color `#72E4B4` and no points. The relay does not write that placeholder into D1, so a state document from before charts still round-trips and still omits `chart`. A stored chart needs a title (1–80 characters), a unit (at most 16 characters, default empty), an optional finite `target`, an optional `#RRGGBB` color (default `#72E4B4`), and 0–30 points. Each point has a label (1–24 characters) and a finite number. Posting the empty placeholder clears a previously stored chart.

Button Grid accepts 1–4 buttons. Optional `prompt` is a single line of at most 120 characters shown above the buttons, for example "Approve the example order?". Each button may set `style` to `primary`, `destructive`, or `default`. Omit `style` for the original appearance. Metric values and deltas are display strings. Timestamps are ISO UTC strings. Live Activity `endTime` is Unix **seconds**, not milliseconds. The Lock Screen and Dynamic Island show it as a countdown; the activity attributes are otherwise unchanged.

Do not post `chart`, `prompt`, or button `style` until the phone is running a build that understands them. Older builds use a strict widget schema and fail the whole sync when those keys are present.

```sh
curl -fsS "$RELAY_URL/state" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/state" -H "Authorization: Bearer $DEVICE_SECRET" -H "X-Device-ID: $DEVICE_ID"
curl -fsS "$RELAY_URL/state" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"mode":"patch","revision":0,"state":{"blocks":[{"id":"hello","type":"text","title":"Hello","text":"Updated by Agent"}]}}'
```

Supply the current revision; HTTP 409 means fetch and reapply the intended change. `mode:replace` requires the full content (`schemaVersion`, `blocks`, `widgets`). `mode:patch` uses JSON Merge Patch: arrays replace entirely; null removes a key but the resulting state must still validate.

```sh
curl -fsS "$RELAY_URL/widget" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"kind":"botCard","data":{"title":"Hello from Agent","body":"Widget data updated","timestamp":"2026-11-01T12:00:00Z"}}'
curl -fsS "$RELAY_URL/widget" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"kind":"chart","data":{"title":"Billable hours","unit":"h","target":8,"color":"#92EDB9","points":[{"label":"Mon","value":6},{"label":"Tue","value":7.5},{"label":"Wed","value":8}]}}'
curl -fsS "$RELAY_URL/widget" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"kind":"buttonGrid","data":{"prompt":"Approve the example order?","buttons":[{"id":"approve","label":"Approve","style":"primary"},{"id":"reject","label":"Reject","style":"destructive"}]}}'
curl -fsS "$RELAY_URL/notify" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"title":"Agent","body":"Your noticeboard is connected"}'
curl -fsS "$RELAY_URL/notify" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"silent":true}'
```

`/notify` optionally accepts `deviceId`; otherwise it targets all enrolled devices with tokens. Omit `title` and the alert title is Agent Noticeboard. Optional `pageId` names a page to open when the notification is tapped. If that page does not exist, the request returns HTTP 404 and queues nothing. `/widget` updates shared state and queues pushes to enrolled widget tokens. Jobs contain status, not proof of display. No registered tokens means an empty job list.

## Pages

`POST /pages` (bot auth) upserts a reminder page and returns the stored page. `GET /pages` returns `{ "pages": [...] }` and `GET /pages/:id` returns one page; both accept bot or paired-device auth. `DELETE /pages/:id` (bot auth) removes one. A page has `id` (1–128 characters), `title` (1–200 characters), `markdown` (at most 10,000 characters; the same small Markdown subset as a dashboard block), optional `keepUntil` (ISO datetime), and, in responses, `updatedAt`. Omit `keepUntil` to keep the page until it is deleted; sending a replacement without `keepUntil` clears an existing expiry. After `keepUntil`, the page is left out of lists and reads as not found. The scheduled relay pass deletes expired pages.

The alert payload includes `pageId` next to `aps` when one was requested. The app opens that page from the notification tap, and also lists pages from the noticeboard. The screen is JavaScript-only, so it can ship as an update to a binary that already includes the current native runtime.

```sh
curl -fsS "$RELAY_URL/pages" -X POST -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"id":"briefing","title":"Morning briefing","markdown":"## Today\n\nReview the queue.","keepUntil":"2026-12-01T00:00:00Z"}'
curl -fsS "$RELAY_URL/pages" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/pages/briefing" -H "Authorization: Bearer $DEVICE_SECRET" -H "X-Device-ID: $DEVICE_ID"
curl -fsS "$RELAY_URL/notify" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d '{"title":"Briefing","body":"Your morning page is ready.","pageId":"briefing"}'
curl -fsS -X DELETE "$RELAY_URL/pages/briefing" -H "Authorization: Bearer $BOT_TOKEN"
```

## Live Activities

```sh
curl -fsS "$RELAY_URL/activity" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d "{\"deviceId\":\"$DEVICE_ID\",\"event\":\"start\",\"activityId\":\"job-123\",\"content\":{\"title\":\"Research\",\"status\":\"Working\",\"progress\":0.1}}"
# Wait for the per-activity token to register before update/end; HTTP 409 indicates missing token.
curl -fsS "$RELAY_URL/activity" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d "{\"deviceId\":\"$DEVICE_ID\",\"event\":\"update\",\"activityId\":\"job-123\",\"content\":{\"title\":\"Research\",\"status\":\"Halfway\",\"progress\":0.5,\"endTime\":1793707200}}"
curl -fsS "$RELAY_URL/activity" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d "{\"deviceId\":\"$DEVICE_ID\",\"event\":\"end\",\"activityId\":\"job-123\",\"content\":{\"title\":\"Research\",\"status\":\"Done\",\"progress\":1}}"
```

A logical activity ID correlates the activity's native attributes with relay registration. Keep content small (ActivityKit payload constraints apply). Push-to-start requires iOS 17.2+, but this app targets 26+. Live Activities are time-limited by iOS, not permanent widgets; do not use them as an always-on background process. The compact Dynamic Island shows the title plus the countdown when `endTime` is set, otherwise the percent. The minimal presentation is a progress gauge. The expanded island and the Lock Screen show the title, status, percent, progress bar, and countdown together.

## Lock Screen, StandBy, Siri

Bot Card and Metric include the Lock Screen families `accessoryInline`, `accessoryCircular`, and `accessoryRectangular`. Add them by customizing the Lock Screen. Chart is Home Screen `systemSmall` and `systemMedium` only. StandBy scales Metric and Chart: the primary value is large, `containerBackground` supplies the plate, and a dimmed display (StandBy at night, Always On) uses a black plate, white ink, and a sparkline without the area fill.

Siri, Shortcuts, and the Action Button can run the current Button Grid actions ("Run Button") and send an arbitrary action id ("Send to Agent"). Both call the same device-authenticated `POST /action` path as a widget button, with `source` `widget`. They never use the bot token. New button labels are picked up for voice phrases the next time the app opens and syncs. In Shortcuts, the button list is read from the latest synced grid when you edit the shortcut. Assign either shortcut to the Action Button in Settings. The iPhone must already be paired; the shared Keychain is unavailable until the first unlock after reboot.

## Actions and delivery diagnostics

```sh
curl -fsS "$RELAY_URL/action" -H "Authorization: Bearer $DEVICE_SECRET" -H "X-Device-ID: $DEVICE_ID" -H 'Content-Type: application/json' -d '{"id":"9f340c16-63d0-447d-83de-68612eb452cb","actionId":"check-in","source":"widget","timestamp":"2026-11-01T12:00:00Z"}'
curl -fsS "$RELAY_URL/actions?cursor=0&limit=50" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/devices" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/deliveries" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS -X DELETE "$RELAY_URL/devices/$DEVICE_ID" -H "Authorization: Bearer $BOT_TOKEN"
curl -fsS "$RELAY_URL/health"
```

Persist `nextCursor` after processing actions. Device/action UUID pairs deduplicate retries. Webhook delivery is at least once. Validate `X-Agent-Signature` as hex HMAC-SHA256 over `X-Agent-Timestamp + "." + raw request body`, using `WEBHOOK_SECRET`. Reject timestamps outside a five-minute window and deduplicate `X-Agent-Event-ID`. Do not reserialize JSON before verification. Polling remains available when webhooks fail.

Outbox retries back off and stop after eight failed attempts. Inspect `/deliveries` for failures. APNs 410/unregistered tokens are retired. Widget pushes coalesce and are limited to one per device per minute; iOS imposes its own additional budget. Do not interpret `sent` as a notification the user saw.

## Secret inventory and rotation

| Store | Names / material | Rotation |
|---|---|---|
| Wrangler secrets | `BOT_TOKEN` | Install replacement; update bot secret store; old token stops working immediately. |
| Wrangler secrets | `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` | Create replacement Apple key, update all three, verify push, then revoke old key. |
| Wrangler secrets | `WEBHOOK_URL`, `WEBHOOK_SECRET` | Coordinate receiver and relay; temporarily accept old/new signatures at receiver while switching. |
| GitHub production secrets | `EXPO_TOKEN` | Create replacement Expo automation token, update GitHub, verify, revoke old token. |
| GitHub production secrets | `CLOUDFLARE_API_TOKEN` | Replace scoped token, verify deploy, revoke old token. |
| EAS credentials | signing certificate, app/extension profiles, App Store Connect API key | Use `eas credentials -p ios`; replace API key and verify submission before revoking old key. Regenerate profiles after entitlement changes. |
| iPhone shared Keychain / D1 hashes | per-device secret | Revoke device and pair again. |

Non-secret configuration: Expo owner/project UUID, Cloudflare account/database IDs, Apple Team ID, App Store Connect app ID, bundle identifiers. Local `.dev.vars`, `.env`, signing keys and profiles are gitignored. Never dump secret environment values in CI logs.

## Testing and known limits

Run `RELAY_URL=... BOT_TOKEN=... bash relay/scripts/smoke.sh` with credentials loaded securely. The script temporarily replaces dashboard/widget state, restores it on exit, creates/revokes a disposable device, and retains one test action. Run against a development relay or during an agreed test window without concurrent state writers. It exercises `/activity`'s missing-token failure, not real activity delivery.

Physical acceptance: install internal TestFlight, pair, allow alerts, confirm `/notify` buzzes; publish a page and confirm a `pageId` notification opens it; add Bot Card and confirm `/widget` refresh; add the Lock Screen Metric or Bot Card; add Chart and confirm a chart payload draws; tap Button Grid, including a prompt and a destructive style, and confirm `/actions`; run "Send to Agent" from Shortcuts or the Action Button and confirm the same action row; remotely start/update/end Live Activity and confirm the countdown; publish an OTA visible home change and verify no binary rebuild. Record observations in `docs/ACCEPTANCE.md`.

Widget pushes supplement timelines. They do not guarantee immediate refresh. Silent pushes may be delayed or omitted, especially after force-quit. Keychain is unavailable until the first device unlock after reboot. Notification permission, Focus and sound settings affect buzzing. Offline widget actions remain in the App Group queue and retry on a later timeline/app opportunity. TestFlight installation, permissions, adding widgets, and visible/audible confirmation require the phone owner.

References: [EAS submission](https://docs.expo.dev/submit/ios/), [fingerprint deployment workflow](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/), [WidgetKit pushes](https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications), [Expo native subscribers](https://docs.expo.dev/modules/appdelegate-subscribers/).
