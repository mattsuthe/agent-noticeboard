# Security

BOT_TOKEN grants dashboard and notification control; per-device secrets grant device access. Never expose BOT_TOKEN to the app bundle. Store production APNs keys only in Wrangler secrets and an owner-controlled secret manager. Pairing codes are short-lived and single-use. Revoke a compromised device via DELETE /devices/:id, and rotate a compromised bot token in both Wrangler and the agent's secret store.

Use private GitHub vulnerability reporting for sensitive reports. Do not include live tokens in reports. This template is provided without a security warranty; operators are responsible for access controls, backups and account security.
