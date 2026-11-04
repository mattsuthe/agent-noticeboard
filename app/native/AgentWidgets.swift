import SwiftUI
import WidgetKit
import AppIntents
import ActivityKit
import Charts

struct AgentEntry: TimelineEntry { var date: Date; var snapshot: AgentSnapshot? }
struct AgentProvider: TimelineProvider {
 func placeholder(in context: Context) -> AgentEntry { AgentEntry(date: Date(), snapshot: nil) }
 func getSnapshot(in context: Context, completion: @escaping (AgentEntry) -> Void) { completion(AgentEntry(date: Date(), snapshot: AgentShared.snapshot())) }
 func getTimeline(in context: Context, completion: @escaping (Timeline<AgentEntry>) -> Void) {
  Task {
   try? await AgentShared.refresh()
   completion(Timeline(entries: [AgentEntry(date: Date(), snapshot: AgentShared.snapshot())], policy: .after(Date().addingTimeInterval(1800))))
  }
 }
}
struct AgentPushHandler: WidgetPushHandler {
 func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
  AgentShared.defaults.set(AgentShared.hex(pushInfo.token), forKey: "widgetPushToken")
  Task { try? await AgentShared.registerCachedWidgetToken() }
 }
}
struct SendAgentAction: AppIntent {
 static var title: LocalizedStringResource = "Send action to agent"
 static var description = IntentDescription("Sends a configured widget action to your agent relay.")
 static var openAppWhenRun: Bool = false
 static var isDiscoverable: Bool = false
 @Parameter(title: "Action ID") var actionId: String
 init() {}
 init(actionId: String) { self.actionId = actionId }
 func perform() async throws -> some IntentResult {
  do { try await AgentShared.performAction(actionId) }
  catch AgentActionError.unpaired { throw AgentWidgetIntentError.unpaired }
  catch AgentActionError.missingAction { throw AgentWidgetIntentError.missingAction }
  return .result()
 }
}
enum AgentWidgetIntentError: Error, CustomLocalizedStringResourceConvertible {
 case missingAction, unpaired
 var localizedStringResource: LocalizedStringResource {
  switch self {
  case .missingAction: return "Name an action to send to your agent."
  case .unpaired: return "Pair Agent Noticeboard before sending an action."
  }
 }
}
struct AgentWidgetView: View {
 @Environment(\.widgetFamily) private var family
 @Environment(\.widgetRenderingMode) private var renderingMode
 @Environment(\.isLuminanceReduced) private var dimmed
 let entry: AgentEntry
 let kind: String
 private var plain: Bool { dimmed || renderingMode != .fullColor }
 var body: some View {
  Group {
   if let data = entry.snapshot?.widgets {
    switch kind {
    case "botCard": botCard(data.botCard)
    case "metric": metric(data.metric)
    case "chart": AgentChartView(chart: data.chart ?? .placeholder, family: family, plain: plain)
    default: buttons(data.buttonGrid)
    }
   } else {
    placeholder
   }
  }
  .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  .containerBackground(for: .widget) {
   // StandBy night mode and Always On dim the display. A black plate stays glanceable without a glowing fill.
   dimmed ? Color.black : Color(uiColor: .secondarySystemGroupedBackground)
  }
 }
 @ViewBuilder private var placeholder: some View {
  if family == .accessoryInline {
   Text("Agent")
  } else if family == .accessoryCircular {
   Image(systemName: "sparkle")
  } else {
   VStack(alignment: .leading, spacing: 6) {
    Image(systemName: "sparkle")
    Text("Agent Noticeboard").font(.headline)
    if family != .accessoryRectangular { Text("Open the app to pair and sync.").font(.caption) }
   }
   .frame(maxWidth: .infinity, alignment: .leading)
  }
 }
 @ViewBuilder private func botCard(_ card: AgentCard) -> some View {
  switch family {
  case .accessoryInline:
   Text(card.title).lineLimit(1)
  case .accessoryCircular:
   VStack(spacing: 1) {
    Image(systemName: "sparkle")
    Text(card.title).font(.system(size: 8)).lineLimit(2).minimumScaleFactor(0.6).multilineTextAlignment(.center)
   }
   .widgetAccentable()
  case .accessoryRectangular:
   VStack(alignment: .leading, spacing: 2) {
    Text(card.title).font(.headline).lineLimit(2).minimumScaleFactor(0.7).widgetAccentable()
    Text(card.body).font(.caption2).lineLimit(2)
   }
   .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  default:
   VStack(alignment: .leading, spacing: 8) {
    Text(card.title).font(.headline).lineLimit(2)
    Text(card.body).font(.body).lineLimit(family == .systemLarge ? 12 : 3)
    Spacer(minLength: 0)
    Text(timestamp(card.timestamp), style: .relative).font(.caption2).foregroundStyle(.secondary)
   }
   .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
 }
 @ViewBuilder private func metric(_ metric: AgentMetric) -> some View {
  switch family {
  case .accessoryInline:
   Text(inlineMetric(metric)).lineLimit(1)
  case .accessoryCircular:
   VStack(spacing: 0) {
    Text(metric.value).font(.system(.body, design: .rounded).bold()).minimumScaleFactor(0.35).lineLimit(1).widgetAccentable()
    Text(metric.label).font(.system(size: 8)).lineLimit(1)
   }
  case .accessoryRectangular:
   VStack(alignment: .leading, spacing: 1) {
    Text(metric.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
    Text(metric.value).font(.title3.bold()).minimumScaleFactor(0.5).lineLimit(1).widgetAccentable()
    if let delta = metric.delta, !delta.isEmpty { Text(delta).font(.caption2).lineLimit(1) }
   }
   .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  default:
   VStack(alignment: .leading, spacing: 4) {
    Text(metric.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    Text(metric.value)
     .font(.system(size: plain ? 40 : 36, weight: .bold, design: .rounded))
     .minimumScaleFactor(0.4)
     .lineLimit(1)
     .foregroundStyle(plain ? Color.white : Color(hex: metric.color))
     .widgetAccentable()
     .invalidatableContent()
    if let delta = metric.delta, !delta.isEmpty { Text(delta).font(.caption).lineLimit(1) }
   }
   .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
 }
 private func inlineMetric(_ metric: AgentMetric) -> String {
  if let delta = metric.delta, !delta.isEmpty { return "\(metric.label) \(metric.value) \(delta)" }
  return "\(metric.label) \(metric.value)"
 }
 @ViewBuilder private func buttons(_ grid: AgentGrid) -> some View {
  let columns = grid.buttons.count == 1 ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())]
  VStack(alignment: .leading, spacing: 8) {
   if let prompt = grid.prompt, !prompt.isEmpty {
    Text(prompt).font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8).frame(maxWidth: .infinity, alignment: .leading)
   }
   LazyVGrid(columns: columns, spacing: 8) {
    ForEach(Array(grid.buttons.prefix(4).enumerated()), id: \.offset) { _, button in
     let ink = agentButtonColors(button.style)
     Button(intent: SendAgentAction(actionId: button.id)) {
      Text(button.label)
       .font(.caption.bold())
       .lineLimit(2)
       .multilineTextAlignment(.center)
       .foregroundStyle(ink.foreground)
       .frame(maxWidth: .infinity, minHeight: grid.prompt == nil ? 44 : 34)
       .padding(.horizontal, 4)
       .background(ink.background, in: RoundedRectangle(cornerRadius: 10))
     }
     .buttonStyle(.plain)
     .accessibilityLabel(button.label)
    }
   }
  }
  .frame(maxWidth: .infinity, alignment: .leading)
 }
 private func timestamp(_ value: String) -> Date {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: value) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: value) ?? entry.date
 }
}
struct AgentChartView: View {
 var chart: AgentChart
 var family: WidgetFamily
 var plain: Bool
 private var points: [AgentChartPoint] { Array(chart.points.prefix(30)) }
 private var stroke: Color { plain ? .white : Color(hex: chart.color) }
 private var hero: CGFloat { family == .systemMedium && !plain ? 28 : 36 }
 private var showLabels: Bool { family == .systemMedium && !plain && points.count > 1 }
 private var labelIndexes: [Int] {
  let count = points.count
  if count <= 3 { return Array(0..<count) }
  return [0, count / 2, count - 1]
 }
 var body: some View {
  VStack(alignment: .leading, spacing: 4) {
   Text(chart.title).font(.caption.weight(.semibold)).lineLimit(1)
   if let last = points.last {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
     Text(agentFigure(last.value))
      .font(.system(size: hero, weight: .bold, design: .rounded))
      .minimumScaleFactor(0.45)
      .lineLimit(1)
      .foregroundStyle(stroke)
      .widgetAccentable()
      .invalidatableContent()
     if !chart.unit.isEmpty { Text(chart.unit).font(.caption).foregroundStyle(.secondary) }
    }
    axes.frame(minHeight: 44, maxHeight: .infinity)
   } else {
    Spacer(minLength: 0)
    Text("Waiting for data").font(.caption).foregroundStyle(.secondary)
    Spacer(minLength: 0)
   }
  }
  .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  .accessibilityElement(children: .ignore)
  .accessibilityLabel(accessibilityText)
 }
 private var accessibilityText: String {
  guard let last = points.last else { return "\(chart.title), no points yet" }
  let unit = chart.unit.isEmpty ? "" : " \(chart.unit)"
  return "\(chart.title), latest \(agentFigure(last.value))\(unit)"
 }
 private var plot: some View {
  Chart {
   ForEach(Array(points.enumerated()), id: \.offset) { index, point in
    if !plain {
     AreaMark(x: .value("Index", index), y: .value("Value", point.value))
      .interpolationMethod(.monotone)
      .foregroundStyle(stroke.opacity(0.22))
    }
    LineMark(x: .value("Index", index), y: .value("Value", point.value))
     .interpolationMethod(.monotone)
     .lineStyle(StrokeStyle(lineWidth: plain ? 2.5 : 2))
     .foregroundStyle(stroke)
    if points.count <= 10 {
     PointMark(x: .value("Index", index), y: .value("Value", point.value))
      .foregroundStyle(stroke)
      .symbolSize(28)
    }
   }
   if let target = chart.target {
    RuleMark(y: .value("Target", target))
     .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
     .foregroundStyle(plain ? Color.white.opacity(0.55) : Color.secondary)
   }
  }
  .chartLegend(.hidden)
  .widgetAccentable()
 }
 @ViewBuilder private var axes: some View {
  if showLabels {
   plot
    .chartYAxis {
     AxisMarks(position: .leading) { _ in
      AxisGridLine()
      AxisValueLabel().font(.system(size: 9))
     }
    }
    .chartXAxis {
     AxisMarks(values: labelIndexes) { value in
      if let index = value.as(Int.self), points.indices.contains(index) {
       AxisValueLabel { Text(points[index].label).font(.system(size: 9)) }
      }
     }
    }
  } else {
   plot.chartXAxis(.hidden).chartYAxis(.hidden)
  }
 }
}
private func agentFigure(_ value: Double) -> String {
 guard value.isFinite else { return "–" }
 let scaled = (value * 10).rounded() / 10
 if scaled == scaled.rounded() { return String(format: "%.0f", scaled) }
 return String(format: "%.1f", scaled)
}
private func agentPercent(_ value: Double) -> String {
 "\(Int((min(max(value, 0), 1) * 100).rounded()))%"
}
private func agentTimer(_ end: Double, _ font: Font) -> some View {
 Text(Date(timeIntervalSince1970: end), style: .timer).font(font).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
}
private func agentButtonColors(_ style: String?) -> (background: Color, foreground: Color) {
 switch style {
 case "primary": return (Color.accentColor, Color.white)
 case "destructive": return (Color(hex: "#C4473A"), .white)
 default: return (Color(uiColor: .tertiarySystemFill), Color.primary)
 }
}
extension Color {
 init(hex: String) {
  let n = UInt64(hex.dropFirst(), radix: 16) ?? 0x92EDB9
  self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
 }
}
struct BotCardWidget: Widget {
 var body: some WidgetConfiguration {
  StaticConfiguration(kind: "botCard", provider: AgentProvider()) { AgentWidgetView(entry: $0, kind: "botCard") }
   .configurationDisplayName("Bot Card")
   .description("A fresh note from your agent, on the Home Screen or Lock Screen.")
   .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryInline, .accessoryCircular, .accessoryRectangular])
   .pushHandler(AgentPushHandler.self)
 }
}
struct MetricWidget: Widget {
 var body: some WidgetConfiguration {
  StaticConfiguration(kind: "metric", provider: AgentProvider()) { AgentWidgetView(entry: $0, kind: "metric") }
   .configurationDisplayName("Metric")
   .description("One useful number on the Home Screen, Lock Screen, or StandBy.")
   .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
   .pushHandler(AgentPushHandler.self)
 }
}
struct ChartWidget: Widget {
 var body: some WidgetConfiguration {
  StaticConfiguration(kind: "chart", provider: AgentProvider()) { AgentWidgetView(entry: $0, kind: "chart") }
   .configurationDisplayName("Chart")
   .description("A small series, such as weekly hours, on the Home Screen or StandBy.")
   .supportedFamilies([.systemSmall, .systemMedium])
   .pushHandler(AgentPushHandler.self)
 }
}
struct ButtonGridWidget: Widget {
 var body: some WidgetConfiguration {
  StaticConfiguration(kind: "buttonGrid", provider: AgentProvider()) { AgentWidgetView(entry: $0, kind: "buttonGrid") }
   .configurationDisplayName("Button Grid")
   .description("Send actions to Agent, with an optional question above the buttons.")
   .supportedFamilies([.systemSmall, .systemMedium])
   .pushHandler(AgentPushHandler.self)
 }
}
struct AgentProgressBar: View {
 var value: Double
 var tint: Color = Color.accentColor
 private var fraction: Double { min(max(value, 0), 1) }
 var body: some View {
  Capsule()
   .fill(Color.white.opacity(0.18))
   .overlay(alignment: .leading) {
    GeometryReader { geo in
     Capsule().fill(tint).frame(width: max(fraction > 0 ? 4 : 0, geo.size.width * fraction))
    }
   }
   .frame(height: 8)
   .accessibilityLabel("Progress \(agentPercent(fraction))")
 }
}
struct AgentActivityLockScreen: View {
 @Environment(\.isLuminanceReduced) private var dimmed
 let state: AgentActivityAttributes.ContentState
 var body: some View {
  VStack(alignment: .leading, spacing: 8) {
   HStack(alignment: .firstTextBaseline, spacing: 8) {
    Image(systemName: "sparkle")
    Text(state.title).font(.headline).lineLimit(1)
    Spacer(minLength: 8)
    Text(agentPercent(state.progress)).font(.subheadline.weight(.bold).monospacedDigit())
   }
   Text(state.status).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
   AgentProgressBar(value: state.progress, tint: dimmed ? .white : Color.accentColor)
   if let end = state.endTime {
    HStack(spacing: 6) {
     Text("Remaining").font(.caption).foregroundStyle(.secondary)
     agentTimer(end, .subheadline.weight(.semibold).monospacedDigit())
    }
   }
  }
  .padding(16)
  .activityBackgroundTint(dimmed ? .black : Color(uiColor: .secondarySystemGroupedBackground))
  .activitySystemActionForegroundColor(.white)
 }
}
struct AgentLiveActivity: Widget {
 var body: some WidgetConfiguration {
  ActivityConfiguration(for: AgentActivityAttributes.self) { context in
   AgentActivityLockScreen(state: context.state)
  } dynamicIsland: { context in
   DynamicIsland {
    DynamicIslandExpandedRegion(.leading) { Image(systemName: "sparkle").font(.headline) }
    DynamicIslandExpandedRegion(.center) {
     Text(context.state.title).font(.headline).lineLimit(2).minimumScaleFactor(0.8)
    }
    DynamicIslandExpandedRegion(.trailing) {
     VStack(alignment: .trailing, spacing: 2) {
      Text(agentPercent(context.state.progress)).font(.headline.monospacedDigit().weight(.bold))
      if let end = context.state.endTime { agentTimer(end, .caption2.monospacedDigit()) }
     }
    }
    DynamicIslandExpandedRegion(.bottom) {
     VStack(alignment: .leading, spacing: 6) {
      Text(context.state.status).font(.subheadline).lineLimit(2)
      AgentProgressBar(value: context.state.progress)
     }
    }
   } compactLeading: {
    Text(context.state.title).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
   } compactTrailing: {
    if let end = context.state.endTime {
     agentTimer(end, .caption2.monospacedDigit()).frame(maxWidth: 64)
    } else {
     Text(agentPercent(context.state.progress)).font(.caption2.weight(.bold).monospacedDigit())
    }
   } minimal: {
    Gauge(value: min(max(context.state.progress, 0), 1)) { EmptyView() }
     .gaugeStyle(.accessoryCircularCapacity)
     .tint(Color.accentColor)
   }
  }
 }
}
@main struct AgentWidgetBundle: WidgetBundle {
 var body: some Widget { BotCardWidget(); MetricWidget(); ChartWidget(); ButtonGridWidget(); AgentLiveActivity() }
}
