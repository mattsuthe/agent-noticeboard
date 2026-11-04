import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, it, expect, vi } from "vitest";
import worker from "../relay/src/index";
import {
  Content,
  contentForStorage,
  initialContent,
  NotifyRequest,
  Page,
  PageList,
  PageWrite,
  State,
} from "../shared/schema";
import { mergePatch, signature } from "../relay/src/security";
const e = env as any;
async function call(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = { authorization: "Bearer test-bot-token" },
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://relay.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
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
describe("relay integration", () => {
  it("rejects unauthenticated access and protects bot endpoints from device credentials", async () => {
    expect((await call("/state", "GET", undefined, {})).status).toBe(401);
    const pairing = await (await call("/pairings", "POST", {})).json<any>();
    const enrollment = await (
      await call("/register", "POST", { pairingCode: pairing.code }, {})
    ).json<any>();
    const headers = {
      authorization: `Bearer ${enrollment.secret}`,
      "x-device-id": enrollment.deviceId,
    };
    expect((await call("/state", "GET", undefined, headers)).status).toBe(200);
    expect((await call("/notify", "POST", {}, headers)).status).toBe(401);
    expect(
      (await call("/register", "POST", { pairingCode: pairing.code }, {}))
        .status,
    ).toBe(401);
  });
  it("replaces and patches state with optimistic concurrency", async () => {
    const current = await (await call("/state")).json<any>();
    const res = await call("/state", "POST", {
      mode: "patch",
      revision: current.revision,
      state: { blocks: [{ id: "a", type: "text", text: "Changed" }] },
    });
    expect(res.status).toBe(200);
    const updated = await res.json<any>();
    expect(updated.state.blocks[0].text).toBe("Changed");
    expect(State.safeParse(updated.state).success).toBe(true);
    expect(
      (
        await call("/state", "POST", {
          mode: "replace",
          revision: current.revision,
          state: initialContent,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/state", "POST", {
          mode: "replace",
          revision: updated.state.revision,
          state: { schemaVersion: 2 },
        })
      ).status,
    ).toBe(400);
  });
  it("validates widget data and returns no fake delivery when no tokens exist", async () => {
    expect(
      (
        await call("/widget", "POST", {
          kind: "buttonGrid",
          data: { buttons: [] },
        })
      ).status,
    ).toBe(400);
    const r = await call("/widget", "POST", {
      kind: "botCard",
      data: {
        title: "Test",
        body: "Hello",
        timestamp: new Date().toISOString(),
      },
    });
    expect(r.status).toBe(202);
    expect((await r.json<any>()).jobs).toEqual([]);
  });
  it("deduplicates actions, paginates, and revokes device credentials", async () => {
    const pair = await (await call("/pairings", "POST", {})).json<any>();
    const d = await (
      await call("/register", "POST", { pairingCode: pair.code }, {})
    ).json<any>();
    const headers = {
      authorization: `Bearer ${d.secret}`,
      "x-device-id": d.deviceId,
    };
    const action = {
      id: crypto.randomUUID(),
      actionId: "check-in",
      source: "widget",
      timestamp: new Date().toISOString(),
    };
    expect((await call("/action", "POST", action, headers)).status).toBe(202);
    await call("/action", "POST", action, headers);
    const log = await (await call("/actions")).json<any>();
    expect(log.actions.filter((a: any) => a.id === action.id)).toHaveLength(1);
    expect(
      (await (await call(`/actions?cursor=${log.nextCursor}`)).json<any>())
        .actions,
    ).toHaveLength(0);
    await call(`/devices/${d.deviceId}`, "DELETE");
    expect((await call("/state", "GET", undefined, headers)).status).toBe(401);
  });
  it("keeps a pre-chart document readable and stores a chart series", async () => {
    await call("/state");
    const legacy = {
      schemaVersion: 1,
      blocks: [
        {
          id: "welcome",
          type: "text",
          title: "Agent Noticeboard",
          text: "Your assistant, within reach.",
        },
      ],
      widgets: {
        botCard: {
          title: "Kept title",
          body: "Kept body",
          timestamp: "2026-11-01T00:00:00Z",
        },
        metric: { label: "Status", value: "Ready", color: "#72E4B4" },
        buttonGrid: { buttons: [{ id: "check-in", label: "Check in" }] },
      },
    };
    await e.DB.prepare("UPDATE state SET content=? WHERE id=1")
      .bind(JSON.stringify(legacy))
      .run();
    const raw = await (await call("/state")).json<any>();
    expect(raw.widgets.chart).toBeUndefined();
    expect(raw.widgets.botCard.title).toBe("Kept title");
    expect(State.parse(raw).widgets.chart).toMatchObject({
      title: "Chart",
      points: [],
      color: "#72E4B4",
    });
    const patched = await call("/state", "POST", {
      mode: "patch",
      revision: raw.revision,
      state: { blocks: [{ id: "note", type: "text", text: "Still here" }] },
    });
    expect(patched.status).toBe(200);
    const afterPatch = await (await call("/state")).json<any>();
    expect(afterPatch.blocks[0].text).toBe("Still here");
    expect(afterPatch.widgets.chart).toBeUndefined();
    expect(afterPatch.widgets.botCard.title).toBe("Kept title");
    const saved = await call("/widget", "POST", {
      kind: "chart",
      data: {
        title: "Billable hours",
        unit: "h",
        target: 8,
        points: [
          { label: "Mon", value: 6 },
          { label: "Tue", value: 7.5 },
        ],
      },
    });
    expect(saved.status).toBe(202);
    const shown = await (await call("/state")).json<any>();
    expect(shown.widgets.chart).toMatchObject({
      title: "Billable hours",
      unit: "h",
      target: 8,
      color: "#72E4B4",
    });
    expect(shown.widgets.chart.points).toEqual([
      { label: "Mon", value: 6 },
      { label: "Tue", value: 7.5 },
    ]);
    expect(shown.widgets.metric.value).toBe("Ready");
    expect(shown.widgets.botCard.title).toBe("Kept title");
    expect(
      (
        await call("/widget", "POST", {
          kind: "chart",
          data: {
            title: "Too many",
            unit: "%",
            points: Array.from({ length: 31 }, (_, i) => ({
              label: `D${i}`,
              value: i,
            })),
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/widget", "POST", {
          kind: "chart",
          data: { title: "Bad", unit: "h", color: "green", points: [] },
        })
      ).status,
    ).toBe(400);
    const unchanged = await (await call("/state")).json<any>();
    expect(unchanged.widgets.chart.title).toBe("Billable hours");
    const current = await (await call("/state")).json<any>();
    const replaced = await call("/state", "POST", {
      mode: "replace",
      revision: current.revision,
      state: {
        ...initialContent,
        widgets: {
          ...initialContent.widgets,
          chart: {
            title: "Utilization",
            unit: "%",
            points: [{ label: "W1", value: 64 }],
          },
        },
      },
    });
    expect(replaced.status).toBe(200);
    expect((await replaced.json<any>()).state.widgets.chart.points).toEqual([
      { label: "W1", value: 64 },
    ]);
  });
  it("accepts an optional decision prompt and button styles", async () => {
    const current = await (await call("/state")).json<any>();
    const legacy = await call("/widget", "POST", {
      kind: "buttonGrid",
      data: { buttons: [{ id: "check-in", label: "Check in" }] },
    });
    expect(legacy.status).toBe(202);
    const plain = await (await call("/state")).json<any>();
    expect(plain.widgets.buttonGrid.prompt).toBeUndefined();
    expect(plain.widgets.buttonGrid.buttons[0].style).toBeUndefined();
    const decision = await call("/state", "POST", {
      mode: "patch",
      revision: plain.revision,
      state: {
        widgets: {
          buttonGrid: {
            prompt: "Approve the example order?",
            buttons: [
              { id: "approve", label: "Approve", style: "primary" },
              { id: "reject", label: "Reject", style: "destructive" },
              { id: "later", label: "Later", style: "default" },
            ],
          },
        },
      },
    });
    expect(decision.status).toBe(200);
    const shown = await (await call("/state")).json<any>();
    expect(shown.widgets.buttonGrid.prompt).toBe("Approve the example order?");
    expect(shown.widgets.buttonGrid.buttons.map((b: any) => b.style)).toEqual([
      "primary",
      "destructive",
      "default",
    ]);
    expect(shown.widgets.botCard.title).toBe(current.widgets.botCard.title);
    expect(
      (
        await call("/widget", "POST", {
          kind: "buttonGrid",
          data: {
            prompt: "Ship it?",
            buttons: [{ id: "no", label: "No", style: "danger" }],
          },
        })
      ).status,
    ).toBe(400);
    const kept = await (await call("/state")).json<any>();
    expect(kept.widgets.buttonGrid.prompt).toBe("Approve the example order?");
    const cleared = await call("/state", "POST", {
      mode: "replace",
      revision: kept.revision,
      state: initialContent,
    });
    expect(cleared.status).toBe(200);
    const restored = await (await call("/state")).json<any>();
    expect(restored.widgets.chart).toBeUndefined();
    expect(restored.widgets.buttonGrid).toEqual({
      buttons: [{ id: "check-in", label: "Check in" }],
    });
  });
  it("defaults an alert title to Agent Noticeboard", async () => {
    const pair = await (await call("/pairings", "POST", {})).json<any>();
    const d = await (
      await call("/register", "POST", { pairingCode: pair.code }, {})
    ).json<any>();
    const headers = {
      authorization: `Bearer ${d.secret}`,
      "x-device-id": d.deviceId,
    };
    await call(
      "/register",
      "POST",
      { tokens: { device: "d".repeat(64) } },
      headers,
    );
    expect(
      (await call("/notify", "POST", { deviceId: d.deviceId, body: "Hello" }))
        .status,
    ).toBe(202);
    const row = await e.DB.prepare(
      "SELECT payload FROM outbox WHERE device_id=? AND kind='apns' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(d.deviceId)
      .first<{ payload: string }>();
    expect(JSON.parse(row!.payload).body.aps.alert.title).toBe(
      "Agent Noticeboard",
    );
  });
  it("upserts pages for a bot and lets a paired device read them", async () => {
    expect((await call("/pages", "GET", undefined, {})).status).toBe(401);
    const pair = await (await call("/pairings", "POST", {})).json<any>();
    const enrolled = await (
      await call("/register", "POST", { pairingCode: pair.code }, {})
    ).json<any>();
    const headers = {
      authorization: `Bearer ${enrolled.secret}`,
      "x-device-id": enrolled.deviceId,
    };
    expect(
      (
        await call(
          "/pages",
          "POST",
          { id: "briefing", title: "Morning", markdown: "Hello" },
          headers,
        )
      ).status,
    ).toBe(401);
    expect((await call("/pages/briefing", "DELETE", undefined, headers)).status).toBe(
      401,
    );
    const created = await call("/pages", "POST", {
      id: "plan/1",
      title: "Morning briefing",
      markdown: "## Today\n\nReview the queue.",
      keepUntil: "2026-12-01T00:00:00Z",
    });
    expect(created.status).toBe(200);
    const page = Page.parse(await created.json());
    expect(page.title).toBe("Morning briefing");
    expect(Date.parse(page.keepUntil!)).toBe(Date.parse("2026-12-01T00:00:00Z"));
    const listed = PageList.parse(
      await (await call("/pages", "GET", undefined, headers)).json(),
    );
    expect(listed.pages.some((item) => item.id === "plan/1")).toBe(true);
    const fetched = Page.parse(
      await (await call("/pages/plan%2F1", "GET", undefined, headers)).json(),
    );
    expect(fetched.markdown).toBe("## Today\n\nReview the queue.");
    const replaced = await call("/pages", "POST", {
      id: "plan/1",
      title: "Updated briefing",
      markdown: "Still here",
    });
    expect(replaced.status).toBe(200);
    expect(Page.parse(await replaced.json()).keepUntil).toBeUndefined();
    expect((await call("/pages/missing-page")).status).toBe(404);
    expect((await call(`/pages/${"a".repeat(129)}`)).status).toBe(404);
    expect((await call("/pages/plan%2F1", "DELETE")).status).toBe(200);
    expect((await call("/pages/plan%2F1", "GET", undefined, headers)).status).toBe(
      404,
    );
    expect((await call("/pages/plan%2F1", "DELETE")).status).toBe(404);
  });
  it("rejects invalid pages and does not notify for a missing page", async () => {
    expect(
      (await call("/pages", "POST", { id: "x", title: "", markdown: "a" })).status,
    ).toBe(400);
    expect(
      (
        await call("/pages", "POST", {
          id: "x",
          title: "t".repeat(201),
          markdown: "a",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/pages", "POST", {
          id: "x",
          title: "Ok",
          markdown: "m".repeat(10001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/pages", "POST", {
          id: "x",
          title: "Ok",
          markdown: "a",
          keepUntil: "tomorrow",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/pages", "POST", {
          id: "x",
          title: "Ok",
          markdown: "a",
          extra: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/pages", "POST", {
          id: "kept-page",
          title: "Kept",
          markdown: "m".repeat(10000),
          keepUntil: new Date(Date.now() + 86400000).toISOString(),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/pages", "POST", {
          id: "expired-page",
          title: "Expired",
          markdown: "old",
          keepUntil: new Date(Date.now() - 1000).toISOString(),
        })
      ).status,
    ).toBe(200);
    const list = PageList.parse(await (await call("/pages")).json());
    expect(list.pages.some((item) => item.id === "kept-page")).toBe(true);
    expect(list.pages.some((item) => item.id === "expired-page")).toBe(false);
    expect((await call("/pages/expired-page")).status).toBe(404);
    const before = await e.DB.prepare("SELECT count(*) AS n FROM outbox").first<{
      n: number;
    }>();
    expect(
      (await call("/notify", "POST", { pageId: "expired-page", body: "nope" }))
        .status,
    ).toBe(404);
    expect(
      (await call("/notify", "POST", { pageId: "missing-page", body: "nope" }))
        .status,
    ).toBe(404);
    expect((await call("/notify", "POST", { pageId: "" })).status).toBe(400);
    const after = await e.DB.prepare("SELECT count(*) AS n FROM outbox").first<{
      n: number;
    }>();
    expect(after!.n).toBe(before!.n);
    const pair = await (await call("/pairings", "POST", {})).json<any>();
    const enrolled = await (
      await call("/register", "POST", { pairingCode: pair.code }, {})
    ).json<any>();
    const headers = {
      authorization: `Bearer ${enrolled.secret}`,
      "x-device-id": enrolled.deviceId,
    };
    await call(
      "/register",
      "POST",
      { tokens: { device: "e".repeat(64) } },
      headers,
    );
    const sent = await call("/notify", "POST", {
      deviceId: enrolled.deviceId,
      title: "Open",
      body: "Read this",
      pageId: "kept-page",
    });
    expect(sent.status).toBe(202);
    const row = await e.DB.prepare(
      "SELECT payload FROM outbox WHERE device_id=? AND kind='apns' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(enrolled.deviceId)
      .first<{ payload: string }>();
    const payload = JSON.parse(row!.payload);
    expect(payload.body.pageId).toBe("kept-page");
    expect(payload.body.aps.alert.title).toBe("Open");
  });
  it("removes expired pages during the scheduled cleanup", async () => {
    await call("/pages", "POST", {
      id: "schedule-keep",
      title: "Stay",
      markdown: "yes",
    });
    await call("/pages", "POST", {
      id: "schedule-drop",
      title: "Drop",
      markdown: "no",
      keepUntil: new Date(Date.now() - 5000).toISOString(),
    });
    const ctx = createExecutionContext();
    await worker.scheduled(
      {
        cron: "* * * * *",
        scheduledTime: Date.now(),
        type: "scheduled",
        noRetry() {},
      },
      e,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(
      (await e.DB.prepare("SELECT id FROM pages WHERE id=?").bind("schedule-keep").first<{ id: string }>())
        ?.id,
    ).toBe("schedule-keep");
    expect(
      await e.DB.prepare("SELECT id FROM pages WHERE id=?").bind("schedule-drop").first(),
    ).toBeNull();
  });
  it("requires activity token before accepting a remote start", async () => {
    const pair = await (await call("/pairings", "POST", {})).json<any>();
    const d = await (
      await call("/register", "POST", { pairingCode: pair.code }, {})
    ).json<any>();
    expect(
      (
        await call("/activity", "POST", {
          deviceId: d.deviceId,
          event: "start",
          activityId: "test",
          content: { title: "Test", status: "Working", progress: 0 },
        })
      ).status,
    ).toBe(409);
  });
});
describe("contract and signing", () => {
  it("defaults a missing chart and accepts decision buttons without storing the placeholder", () => {
    const parsed = Content.parse(initialContent);
    expect(parsed.widgets.chart).toMatchObject({
      title: "Chart",
      unit: "",
      color: "#72E4B4",
      points: [],
    });
    expect(contentForStorage(parsed).widgets).not.toHaveProperty("chart");
    const named = Content.parse({
      ...initialContent,
      widgets: {
        ...initialContent.widgets,
        chart: { title: "Utilization", unit: "%", points: [] },
      },
    });
    expect(named.widgets.chart.color).toBe("#72E4B4");
    expect(contentForStorage(named).widgets).toHaveProperty("chart");
    const decision = Content.parse({
      ...initialContent,
      widgets: {
        ...initialContent.widgets,
        buttonGrid: {
          prompt: "Approve the example order?",
          buttons: [
            { id: "approve", label: "Approve", style: "primary" },
            { id: "reject", label: "Reject", style: "destructive" },
            { id: "later", label: "Later" },
          ],
        },
      },
    });
    expect(decision.widgets.buttonGrid.prompt).toBe("Approve the example order?");
    expect(decision.widgets.buttonGrid.buttons[2].style).toBeUndefined();
    expect(
      Content.safeParse({
        ...initialContent,
        widgets: {
          ...initialContent.widgets,
          buttonGrid: {
            buttons: [{ id: "nope", label: "No", style: "danger" }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      Content.safeParse({
        ...initialContent,
        widgets: {
          ...initialContent.widgets,
          chart: {
            title: "Hours",
            unit: "h",
            points: Array.from({ length: 31 }, (_, i) => ({
              label: `D${i}`,
              value: i,
            })),
          },
        },
      }).success,
    ).toBe(false);
  });
  it("validates reminder pages and an optional notify page id", () => {
    const page = Page.parse({
      id: "briefing",
      title: "Morning briefing",
      markdown: "Hello",
      updatedAt: "2026-11-04T00:00:00Z",
    });
    expect(page.keepUntil).toBeUndefined();
    expect(PageList.parse({ pages: [page] }).pages).toHaveLength(1);
    expect(PageWrite.safeParse({ id: "a", title: "", markdown: "x" }).success).toBe(
      false,
    );
    expect(
      PageWrite.safeParse({ id: "a", title: "Ok", markdown: "x".repeat(10001) })
        .success,
    ).toBe(false);
    expect(
      PageWrite.safeParse({ id: "a", title: "T".repeat(200), markdown: "" }).success,
    ).toBe(true);
    expect(NotifyRequest.parse({ pageId: "briefing" }).silent).toBe(false);
    expect(NotifyRequest.safeParse({ pageId: "briefing", extra: 1 }).success).toBe(
      false,
    );
    expect(NotifyRequest.safeParse({ pageId: "" }).success).toBe(false);
  });
  it("rejects duplicate block IDs and insecure images", () => {
    expect(
      Content.safeParse({
        ...initialContent,
        blocks: [
          { id: "a", type: "text", text: "1" },
          { id: "a", type: "text", text: "2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      Content.safeParse({
        ...initialContent,
        blocks: [
          { id: "a", type: "image", url: "http://example.com/a", alt: "a" },
        ],
      }).success,
    ).toBe(false);
  });
  it("uses merge patch array replacement and blocks prototype keys", () => {
    expect(mergePatch({ a: [1, 2], b: 2 }, { a: [3], b: null })).toEqual({
      a: [3],
    });
    expect(() =>
      mergePatch({}, JSON.parse('{"__proto__":{"admin":true}}')),
    ).toThrow();
  });
  it("binds HMAC to timestamp and exact payload", async () => {
    const s = await signature("secret", "1", '{"a":1}');
    expect(s).toHaveLength(64);
    expect(s).not.toBe(await signature("secret", "2", '{"a":1}'));
    expect(s).not.toBe(await signature("secret", "1", '{ "a":1}'));
  });
});

describe("APNs delivery with a mocked Apple endpoint", () => {
  it("signs requests, separates push types, and throttles widget refreshes", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const der = await crypto.subtle.exportKey("pkcs8", key.privateKey);
    e.APNS_KEY_P8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----`;
    e.APNS_TEAM_ID = "TESTTEAM";
    e.APNS_KEY_ID = "TESTKEY";
    const received: any[] = [];
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (!String(input).startsWith("https://api.push.apple.com/3/device/"))
          throw new Error("Unexpected outbound request");
        received.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
          headers: init?.headers,
        });
        return new Response(null, { status: 200 });
      });
    try {
      const pair = await (await call("/pairings", "POST", {})).json<any>();
      const d = await (
        await call("/register", "POST", { pairingCode: pair.code }, {})
      ).json<any>();
      const token = "a".repeat(64),
        widget = "b".repeat(64),
        start = "c".repeat(64);
      const headers = {
        authorization: `Bearer ${d.secret}`,
        "x-device-id": d.deviceId,
      };
      await call(
        "/register",
        "POST",
        { tokens: { device: token, widget, pushToStart: start } },
        headers,
      );
      const alert = await (
        await call("/notify", "POST", {
          deviceId: d.deviceId,
          title: "Hello",
          body: "World",
        })
      ).json<any>();
      expect(alert.jobs).toHaveLength(1);
      await call("/widget", "POST", {
        kind: "botCard",
        data: {
          title: "Remote",
          body: "Update",
          timestamp: new Date().toISOString(),
        },
      });
      await call("/widget", "POST", {
        kind: "botCard",
        data: {
          title: "Coalesced",
          body: "Latest",
          timestamp: new Date().toISOString(),
        },
      });
      await call("/activity", "POST", {
        deviceId: d.deviceId,
        event: "start",
        activityId: "job-1",
        content: { title: "Work", status: "Starting", progress: 0 },
      });
      expect(received).toHaveLength(3);
      expect(received[0].url).toBe(`https://api.push.apple.com/3/device/${token}`);
      expect(received[0].headers["apns-topic"]).toBe("com.example.agentnoticeboard");
      expect(received[0].headers["apns-push-type"]).toBe("alert");
      expect(received[0].body.aps.alert.title).toBe("Hello");
      // WidgetKit's token is distinct, but its topic uses the containing app ID.
      expect(received[1].url).toBe(`https://api.push.apple.com/3/device/${widget}`);
      expect(received[1].headers["apns-topic"]).toBe(
        "com.example.agentnoticeboard.push-type.widgets",
      );
      expect(received[1].headers["apns-push-type"]).toBe("widgets");
      expect(received[1].headers["apns-priority"]).toBe("5");
      expect(received[1].body).toEqual({ aps: { "content-changed": true } });
      expect(received[2].body.aps["attributes-type"]).toBe(
        "AgentActivityAttributes",
      );
      expect(received[2].body.aps.attributes.activityId).toBe("job-1");
      const pending = await e.DB.prepare(
        "SELECT count(*) AS n FROM outbox WHERE device_id=? AND status='pending'",
      )
        .bind(d.deviceId)
        .first();
      expect(pending.n).toBe(1);
      expect(received[0].headers["authorization"]).toMatch(
        /^bearer [^.]+\.[^.]+\.[^.]+$/,
      );
      await call(`/devices/${d.deviceId}`, "DELETE");
    } finally {
      mock.mockRestore();
    }
  });
});
