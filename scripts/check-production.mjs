import { readFileSync } from "node:fs";
const missing = [
  "EXPO_TOKEN",
  "EXPO_PROJECT_ID",
  "EXPO_OWNER",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
].filter((k) => !process.env[k]);
if (
  readFileSync("relay/wrangler.jsonc", "utf8").includes(
    "00000000-0000-0000-0000-000000000001",
  )
)
  missing.push("configured D1 database_id");
if (missing.length) {
  console.error(
    `Production setup incomplete: ${missing.join(", ")}. See docs/OPERATIONS.md.`,
  );
  process.exit(1);
}
