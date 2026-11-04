import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { readFileSync } from 'node:fs';
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./relay/wrangler.jsonc'},miniflare:{bindings:{BOT_TOKEN:'test-bot-token',TEST_MIGRATION:readFileSync('./relay/migrations/0001_initial.sql','utf8')}}})],test:{include:['tests/**/*.test.ts']}});
