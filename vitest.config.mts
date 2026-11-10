import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readdirSync, readFileSync } from "node:fs";
const TEST_MIGRATION = readdirSync("./relay/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`./relay/migrations/${name}`, "utf8"))
  .join("\n");
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./relay/wrangler.jsonc" },
      miniflare: { bindings: { BOT_TOKEN: "test-bot-token", TEST_MIGRATION } },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
