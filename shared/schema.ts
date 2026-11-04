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
export const BotCard = z
  .object({
    title: z.string().max(200),
    body: text,
    timestamp: z.iso.datetime(),
  })
  .strict();
export const Metric = z
  .object({
    label: z.string().max(100),
    value: z.string().max(100),
    delta: z.string().max(100).optional(),
    color: color.default("#72E4B4"),
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
  })
  .strict();
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
    timestamp: z.iso.datetime(),
  })
  .strict();
export type UIBlock = z.infer<typeof Block>;
export type AppState = z.infer<typeof State>;
export type ActivityData = z.infer<typeof ActivityContent>;
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
