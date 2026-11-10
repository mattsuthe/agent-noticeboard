import { z } from "zod";
const id = z.string().min(1).max(128);
const text = z.string().max(10000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const ActionButton = z
  .object({
    id,
    label: z.string().min(1).max(80),
    style: z.enum(["primary", "destructive", "default"]).optional(),
  })
  .strict();
export const Block = z.discriminatedUnion("type", [
  z
    .object({
      id,
      type: z.literal("text"),
      text,
      title: z.string().max(200).optional(),
    })
    .strict(),
  z.object({ id, type: z.literal("markdown"), markdown: text }).strict(),
  z
    .object({
      id,
      type: z.literal("metric"),
      label: text,
      value: z.string().max(100),
      delta: z.string().max(100).optional(),
      color: color.optional(),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal("list"),
      title: z.string().max(200).optional(),
      items: z.array(z.string().max(1000)).max(100),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal("image"),
      url: z.url().startsWith("https://"),
      alt: z.string().max(500),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal("button"),
      label: z.string().max(80),
      actionId: id,
    })
    .strict(),
]);
// Stable page id used in URLs, notification payloads, and read-only widgets.
export const PageId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const BotCard = z
  .object({
    title: z.string().max(200),
    body: text,
    timestamp: z.iso.datetime(),
    pageId: PageId.optional(),
  })
  .strict();
export const Metric = z
  .object({
    label: z.string().max(100),
    value: z.string().max(100),
    delta: z.string().max(100).optional(),
    color: color.default("#72E4B4"),
    pageId: PageId.optional(),
  })
  .strict();
export const ButtonGrid = z
  .object({
    prompt: z.string().min(1).max(120).optional(),
    buttons: z.array(ActionButton).min(1).max(4),
  })
  .strict();
export const ChartPoint = z
  .object({
    label: z.string().min(1).max(24),
    value: z.number().finite(),
  })
  .strict();
export const Chart = z
  .object({
    title: z.string().min(1).max(80),
    unit: z.string().max(16).default(""),
    target: z.number().finite().optional(),
    color: color.default("#72E4B4"),
    points: z.array(ChartPoint).max(30),
    pageId: PageId.optional(),
  })
  .strict();
// Named widget content is separate from the four backwards-compatible defaults.
export const WidgetKind = z.enum(["botCard", "metric", "chart", "buttonGrid"]);
export const WidgetInstanceWrite = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("botCard"), data: BotCard }).strict(),
  z.object({ kind: z.literal("metric"), data: Metric }).strict(),
  z.object({ kind: z.literal("chart"), data: Chart }).strict(),
  z.object({ kind: z.literal("buttonGrid"), data: ButtonGrid }).strict(),
]);
export const WidgetInstance = z.object({
  id: PageId,
  name: z.string().trim().min(1).max(80),
  agentId: PageId.optional(),
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
}).and(WidgetInstanceWrite);
export const WidgetCatalog = z.array(WidgetInstance).max(100);
export type NamedWidget = z.infer<typeof WidgetInstance>;
// Parsed when `chart` is omitted. This exact placeholder is not written to D1,
// so documents saved before charts still match clients that reject unknown keys.
export const emptyChart = {
  title: "Chart",
  unit: "",
  color: "#72E4B4",
  points: [] as { label: string; value: number }[],
};
export const Widgets = z
  .object({
    botCard: BotCard,
    metric: Metric,
    buttonGrid: ButtonGrid,
    chart: Chart.default(emptyChart),
  })
  .strict();
export const Content = z
  .object({
    schemaVersion: z.literal(1),
    blocks: z.array(Block).max(100),
    widgets: Widgets,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.blocks.map((b) => b.id)).size !== v.blocks.length)
      ctx.addIssue({ code: "custom", message: "Block IDs must be unique" });
  });
export function contentForStorage(content: z.infer<typeof Content>) {
  const chart = content.widgets.chart;
  const unused =
    chart.title === emptyChart.title &&
    chart.unit === "" &&
    chart.color.toLowerCase() === "#72e4b4" &&
    chart.target == null &&
    chart.points.length === 0;
  if (!unused) return content;
  const { chart: _chart, ...widgets } = content.widgets;
  return {
    schemaVersion: content.schemaVersion,
    blocks: content.blocks,
    widgets,
  };
}
export const State = Content.safeExtend({
  widgetInstances: WidgetCatalog.optional(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export const ActivityContent = z
  .object({
    title: z.string().max(120),
    status: z.string().max(200),
    progress: z.number().min(0).max(1),
    endTime: z.number().positive().nullable().optional(),
  })
  .strict();
export const Tokens = z
  .object({
    device: z
      .string()
      .regex(/^[a-fA-F0-9]{32,512}$/)
      .optional(),
    widget: z
      .string()
      .regex(/^[a-fA-F0-9]{32,512}$/)
      .optional(),
    pushToStart: z
      .string()
      .regex(/^[a-fA-F0-9]{32,512}$/)
      .optional(),
    activities: z
      .array(
        z
          .object({ id, token: z.string().regex(/^[a-fA-F0-9]{32,512}$/) })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
export const Action = z
  .object({
    id: z.uuid(),
    actionId: id,
    source: z.enum(["app", "widget"]),
    widgetId: PageId.optional(),
    timestamp: z.iso.datetime(),
  })
  .strict();
// A reminder page is shared by every paired device. keepUntil is an absolute
// expiry; omitting it keeps the page until an agent deletes it.
export const FeedbackContext = z.object({
  sourcePageId: z.string().min(1).max(128).optional(),
  agentId: PageId.optional(),
  widgetId: PageId.optional(),
  widgetKind: WidgetKind.optional(),
  widgetRevision: z.number().int().positive().optional(),
}).strict();
export const FeedbackRequest = z.object({
  id: z.uuid(),
  pageId: z.string().min(1).max(128),
  pageUpdatedAt: z.iso.datetime(),
  text: z.string().trim().min(1).max(4000),
}).strict();
export const PageWrite = z
  .object({
    id,
    agentId: PageId.optional(),
    title: z.string().min(1).max(200),
    markdown: text,
    keepUntil: z.iso.datetime().optional(),
  })
  .strict();
export const Page = PageWrite.safeExtend({
  feedbackContext: FeedbackContext.optional(),
  updatedAt: z.iso.datetime(),
});
export const PageList = z
  .object({
    pages: z.array(Page),
  })
  .strict();
export const NotifyRequest = z
  .object({
    deviceId: z.string().optional(),
    silent: z.boolean().default(false),
    title: z.string().max(200).optional(),
    body: z.string().max(2000).optional(),
    pageId: id.optional(),
  })
  .strict();
/** Page id from a read-only widget tap. Accepts the widget URL or a bare `/page/<id>` path. */
export function pageIdFromWidgetURL(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return null;
  let path = trimmed;
  if (trimmed.includes("://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== "agentnoticeboard:") return null;
    if (url.username || url.password) return null;
    path = `${url.hostname}${url.pathname}`;
  }
  const match = /^\/?page\/([^/]+)$/.exec(path);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const parsed = PageId.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
export type UIBlock = z.infer<typeof Block>;
export type AppState = z.infer<typeof State>;
export type ActivityData = z.infer<typeof ActivityContent>;
export type PageRecord = z.infer<typeof Page>;
export const initialContent: z.input<typeof Content> = {
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
      title: "Agent is ready",
      body: "Pair your phone to get started.",
      timestamp: "2026-11-01T00:00:00Z",
    },
    metric: { label: "Status", value: "Ready", color: "#72E4B4" },
    buttonGrid: { buttons: [{ id: "check-in", label: "Check in" }] },
  },
};
