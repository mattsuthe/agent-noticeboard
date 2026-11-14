import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import worker from "../relay/src/index";
import { Conversation } from "../shared/conversations";
const e = env as any;
const bot = { authorization: "Bearer test-bot-token" };
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = bot,
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://relay.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    e,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
beforeAll(async () => {
  for (const sql of e.TEST_MIGRATION.split(";").filter((s: string) => s.trim()))
    await e.DB.prepare(sql).run();
});
it("keeps snapshot conversations private, idempotent and honest about agent receipt", async () => {
  const pairing = await (await call("/pairings", "POST", {})).json<any>();
  const device = await (
    await call("/register", "POST", { pairingCode: pairing.code }, {})
  ).json<any>();
  const auth = {
    authorization: `Bearer ${device.secret}`,
    "x-device-id": device.deviceId,
  };
  const page = await (
    await call("/pages", "POST", {
      id: "trading-report",
      title: "Trading report",
      markdown: "Original snapshot",
      agentId: "trader",
    })
  ).json<any>();
  const input = {
    id: crypto.randomUUID(),
    pageId: page.id,
    pageUpdatedAt: page.updatedAt,
    text: "Why did this change?",
  };
  expect((await call("/messages", "POST", input)).status).toBe(401);
  expect((await call("/messages", "POST", input, auth)).status).toBe(202);
  expect((await call("/messages", "POST", input, auth)).status).toBe(202);
  expect(
    (await call("/messages", "POST", { ...input, text: "different" }, auth))
      .status,
  ).toBe(409);
  const path = `/conversations?pageId=${page.id}&version=${encodeURIComponent(page.updatedAt)}`;
  const read = async () =>
    Conversation.parse(
      (await (await call(path, "GET", undefined, auth)).json<any>()).thread,
    );
  let thread = await read();
  expect((await call(`/conversations/${thread.id}`)).status).toBe(200);
  expect(
    (await call(`/conversations/${thread.id}`, "GET", undefined, {})).status,
  ).toBe(401);
  expect(thread.messages).toHaveLength(1);
  expect(thread.messages[0].receivedAt).toBeNull();
  expect(thread.agentId).toBe("trader");
  expect(
    (await call("/messages/ack", "POST", { messageId: input.id }, auth)).status,
  ).toBe(401);
  expect(
    (await call("/messages/ack", "POST", { messageId: input.id })).status,
  ).toBe(200);
  const reply = {
    id: crypto.randomUUID(),
    messageId: input.id,
    text: "Here is the reason.",
  };
  expect((await call("/messages/reply", "POST", reply)).status).toBe(200);
  expect((await call("/messages/reply", "POST", reply)).status).toBe(200);
  expect(
    (await call("/messages/reply", "POST", { ...reply, text: "overwrite" }))
      .status,
  ).toBe(409);
  await call("/pages", "POST", {
    id: page.id,
    title: "New report",
    markdown: "Changed",
    agentId: "other",
  });
  await call(
    "/messages",
    "POST",
    { ...input, id: crypto.randomUUID(), text: "One more thing" },
    auth,
  );
  thread = await read();
  expect(thread.messages).toHaveLength(3);
  expect(thread.messages[0].receivedAt).not.toBeNull();
  expect(thread.page.markdown).toBe("Original snapshot");
  expect(thread.agentId).toBe("trader");
  const events = await (await call("/actions")).json<any>();
  expect(
    events.actions.filter(
      (a: any) => a.payload?.messageId === input.id || a.messageId === input.id,
    ).length,
  ).toBeLessThanOrEqual(1);
  const otherPairing = await (await call("/pairings", "POST", {})).json<any>();
  const other = await (
    await call("/register", "POST", { pairingCode: otherPairing.code }, {})
  ).json<any>();
  expect(
    (
      await (
        await call(path, "GET", undefined, {
          authorization: `Bearer ${other.secret}`,
          "x-device-id": other.deviceId,
        })
      ).json<any>()
    ).thread,
  ).toBeNull();
});
it("rejects collisions with legacy actions and races without duplicate delivery", async () => {
  const pairing = await (await call("/pairings", "POST", {})).json<any>();
  const device = await (
    await call("/register", "POST", { pairingCode: pairing.code }, {})
  ).json<any>();
  const auth = {
    authorization: `Bearer ${device.secret}`,
    "x-device-id": device.deviceId,
  };
  const page = await (
    await call("/pages", "POST", {
      id: "race-report",
      title: "Race",
      markdown: "Snapshot",
    })
  ).json<any>();
  const input = {
    id: crypto.randomUUID(),
    pageId: page.id,
    pageUpdatedAt: page.updatedAt,
    text: "First",
  };
  await call(
    "/action",
    "POST",
    {
      id: input.id,
      actionId: "old",
      source: "app",
      timestamp: new Date().toISOString(),
    },
    auth,
  );
  expect((await call("/messages", "POST", input, auth)).status).toBe(409);
  const racing = { ...input, id: crypto.randomUUID() };
  const outcomes = await Promise.all([
    call("/messages", "POST", racing, auth),
    call("/messages", "POST", racing, auth),
  ]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual([202, 202]);
  const messages = await e.DB.prepare(
    "SELECT * FROM thread_messages WHERE id=?",
  )
    .bind(racing.id)
    .all();
  const actions = await e.DB.prepare("SELECT * FROM actions WHERE id=?")
    .bind(racing.id)
    .all();
  expect(messages.results).toHaveLength(1);
  expect(actions.results).toHaveLength(1);
});
