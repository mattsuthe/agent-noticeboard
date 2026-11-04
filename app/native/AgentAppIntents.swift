import AppIntents
internal import AgentNative

struct AgentButtonEntity: AppEntity, Identifiable, Hashable, Sendable {
 static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Agent Action")
 static var defaultQuery = AgentButtonQuery()
 var id: String
 var label: String
 var displayRepresentation: DisplayRepresentation {
  DisplayRepresentation(title: LocalizedStringResource(stringLiteral: label))
 }
}
struct AgentButtonQuery: EntityQuery, EnumerableEntityQuery {
 func entities(for identifiers: [AgentButtonEntity.ID]) async throws -> [AgentButtonEntity] {
  agentButtons().filter { identifiers.contains($0.id) }
 }
 func suggestedEntities() async throws -> [AgentButtonEntity] { agentButtons() }
 func allEntities() async throws -> [AgentButtonEntity] { agentButtons() }
}
private func agentButtons() -> [AgentButtonEntity] {
 AgentShared.currentButtons().map { AgentButtonEntity(id: $0.id, label: $0.label) }
}
struct SendToAgentIntent: AppIntent {
 static var title: LocalizedStringResource = "Send to Agent"
 static var description = IntentDescription("Sends an action to your agent relay using this device's credentials.")
 static var openAppWhenRun: Bool = false
 @Parameter(title: "Action ID") var actionId: String
 static var parameterSummary: some ParameterSummary { Summary("Send \(\.$actionId) to Agent") }
 init() {}
 init(actionId: String) { self.actionId = actionId }
 func perform() async throws -> some IntentResult & ProvidesDialog {
  try await agentPerform(actionId)
  return .result(dialog: "Action sent.")
 }
}
struct RunAgentButtonIntent: AppIntent {
 static var title: LocalizedStringResource = "Run Agent Button"
 static var description = IntentDescription("Runs one of the current Button Grid actions.")
 static var openAppWhenRun: Bool = false
 @Parameter(title: "Button") var button: AgentButtonEntity
 static var parameterSummary: some ParameterSummary { Summary("Run \(\.$button)") }
 init() {}
 init(button: AgentButtonEntity) { self.button = button }
 func perform() async throws -> some IntentResult & ProvidesDialog {
  try await agentPerform(button.id)
  return .result(dialog: "Action sent.")
 }
}
private func agentPerform(_ actionId: String) async throws {
 do { try await AgentShared.performAction(actionId) }
 catch AgentActionError.unpaired { throw AgentSpokenError.unpaired }
 catch AgentActionError.missingAction { throw AgentSpokenError.missingAction }
}
enum AgentSpokenError: Error, CustomLocalizedStringResourceConvertible {
 case missingAction, unpaired
 var localizedStringResource: LocalizedStringResource {
  switch self {
  case .missingAction: return "Name an action to send to your agent."
  case .unpaired: return "Pair Agent Noticeboard before sending an action."
  }
 }
}
struct AgentShortcuts: AppShortcutsProvider {
 static var appShortcuts: [AppShortcut] {
  AppShortcut(
   intent: RunAgentButtonIntent(),
   phrases: [
    "Run \(\.$button) with \(.applicationName)",
    "Ask \(.applicationName) to \(\.$button)",
   ],
   shortTitle: "Run Button",
   systemImageName: "square.grid.2x2"
  )
  AppShortcut(
   intent: SendToAgentIntent(),
   phrases: [
    "Send to Agent with \(.applicationName)",
    "Send an action with \(.applicationName)",
   ],
   shortTitle: "Send to Agent",
   systemImageName: "sparkle"
  )
 }
 static func install() {
  AgentShared.onActionsChanged = {
   Task { @MainActor in AgentShortcuts.updateAppShortcutParameters() }
  }
 }
}
