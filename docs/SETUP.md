# Set up your own installation

Use GitHub's **Use this template** to create your own repository (private is recommended for your deployment). Clone it with Node 24, npm, Git, jq, GitHub CLI available. Run `npm ci`.

## Create resources and install non-secret identifiers

1. Create an Expo project with slug `agent-noticeboard` in your own account. Copy its project UUID and account name.
2. In Apple Developer, choose a unique reverse-DNS bundle ID, for example `com.yourcompany.agentnoticeboard`. Register it and `<bundleId>.widgets`; register App Group `group.<bundleId>` and associate both targets. Enable push notifications for the app and required shared capabilities. Create an App Store Connect iOS app for that bundle; copy the numeric app ID and your Apple Team ID.
3. From `relay/`, run `npx wrangler login` and `npx wrangler d1 create agent-noticeboard`. Copy the database UUID.
4. Copy `installation.example.json` to a local file and fill all six fields. Run `node scripts/configure.mjs /path/to/installation.json` from the repository root. This updates the app, native entitlements, shared storage, plugin, relay, tests, release script and verification workflow together. It validates all inputs before writing. Review `git diff`. Do this once on a fresh template; changing identities later creates a different installation.
5. In `app/`, run `npx eas-cli@latest login` and `npx eas-cli@latest project:info`. Confirm your own project. The default slug is `agent-noticeboard`; if your Expo project uses another slug, set it in `app/app.config.ts`.

App Store Connect requires an available listing name. Choose one for your installation, such as “Your Team Noticeboard”; the template author’s listing name may already be taken. The installed app’s display name is configured separately in `app/app.config.ts`.

The template includes placeholder identifiers so offline lint/tests can run. Never build or deploy those placeholders. Product name and icon can be changed in app/app.config.ts and app/assets. A product-name change also changes the generated Xcode workspace/scheme; update .github/workflows/verify.yml accordingly.

## Deploy and sign

Follow the secret setup and first-deployment commands in [OPERATIONS.md](OPERATIONS.md). From `relay/`, apply migrations with `npx wrangler d1 migrations apply agent-noticeboard --remote`, then deploy from root with `npm run relay:deploy`. Use a random BOT_TOKEN stored in Wrangler and your agent's secret manager. Configure APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID for production APNs. Widget pushes use `<appBundleId>.push-type.widgets`; Live Activities use `<appBundleId>.push-type.liveactivity`.

From `app/`, configure EAS signing and the App Store Connect API key with `npx eas-cli@latest credentials -p ios`. Your account owner may need to complete initial Apple sign-in and agreements. Let EAS manage certificates/profiles for both targets. Run `npx eas-cli@latest build -p ios --profile production --auto-submit` for the first build.

## Enable automation

Set GitHub repository variables EXPO_OWNER, EXPO_PROJECT_ID and CLOUDFLARE_ACCOUNT_ID to your own values. Store EXPO_TOKEN and CLOUDFLARE_API_TOKEN in repository secrets or the `production` environment. Cloudflare CI needs Workers Scripts Edit and D1 Edit for your account. Expo CI needs access to your Expo project. Set DEPLOY_ENABLED=true only after configuring these. Then dispatch Ship. Main pushes choose OTA or build based on native fingerprint; monthly releases renew TestFlight before 90-day expiration.

Use only an internal TestFlight group if you want private testing. Add eligible App Store Connect users, install, generate a 10-minute pairing code from /pairings, and enter your relay URL plus code in Settings. Grant notifications and add widgets.

## Verify before handing off

Follow docs/OPERATIONS.md physical checks and relay/scripts/smoke.sh. Do not run smoke against a dashboard while another agent is writing: it temporarily replaces and restores state. Record build/runtime, phone OS, and observed push/widget/action/OTA results in your own deployment notes. Infrastructure setup, code presence, and APNs acceptance alone are not physical acceptance.
