import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { readFileSync } from 'node:fs';
const migration = ['./relay/migrations/0001_initial.sql', './relay/migrations/0002_pages.sql']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./relay/wrangler.jsonc'},miniflare:{bindings:{BOT_TOKEN:'test-bot-token',TEST_MIGRATION:migration}}})],test:{include:['tests/**/*.test.ts']}});
