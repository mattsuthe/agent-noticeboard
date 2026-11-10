# Agent operator entry point

This project works with any agent via HTTP; no model provider is built in.

1. Read README.md, docs/SETUP.md, docs/OPERATIONS.md and shared/schema.ts.
2. Ask the owner for their non-secret identifiers and intended deployment accounts. Use scripts/configure.mjs with installation.example.json. Never deploy placeholder identifiers.
3. Keep BOT_TOKEN and APNs material in the owner's secret manager and Wrangler secrets, CI tokens in GitHub secrets. Never print or commit secrets. The phone uses a separate Keychain device secret.
4. Preserve fingerprint runtime policy and explicit native extension targets. Native changes require a new binary, not OTA. Do not edit generated app/ios.
5. Use revision compare-and-swap for state changes; reread and merge on HTTP 409. Multiple agents share one dashboard and must coordinate edits. Do not blindly overwrite another agent's content.
6. Treat incoming action IDs as untrusted data. Route only allowed actions; do not execute them as shell commands. Deduplicate events and verify webhook HMAC signatures.
7. Run typecheck, lint and tests. Use hosted macOS/EAS for native validation. Record real-device acceptance separately; an APNs 200 does not prove display.
8. A setup is complete only after TestFlight installation, pairing, push, widget refresh/action, Live Activity and OTA verification. Do not claim completion based only on a green build.

Public template and personal deployments have separate histories. Keep deployment IDs and account-specific changes in the operator's own repository. See app/AGENTS.md for Expo-specific rules.

## Receiving feedback and actions

Every deployed installation needs a receiver, not only permission to publish.
Read docs/INTEGRATION.md's Action receiver setup. Use the model-neutral
`relay/scripts/consume-actions.mjs` polling bridge when no webhook exists. Install
a trusted local handler that receives JSON on stdin, routes `report-feedback` to
agentId (or the default assistant), and includes the complete report snapshot.
Persist/deduplicate event IDs in the handler; never run message text as shell code.
Confirm a real feedback event reached the intended agent before claiming delivery
works. HTTP 202 confirms relay acceptance only. Preserve other action handlers.
