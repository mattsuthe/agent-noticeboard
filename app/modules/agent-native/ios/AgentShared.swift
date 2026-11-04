import Foundation
import Security
import ActivityKit
import WidgetKit

struct AgentActivityAttributes: ActivityAttributes {
 struct ContentState: Codable, Hashable {
  var title: String
  var status: String
  var progress: Double
  var endTime: Double?
 }
 var activityId: String
}
struct AgentCredential: Codable { var relay: String; var deviceId: String; var secret: String }
struct AgentCard: Codable { var title: String; var body: String; var timestamp: String }
struct AgentMetric: Codable { var label: String; var value: String; var delta: String?; var color: String }
struct AgentChartPoint: Codable, Hashable { var label: String; var value: Double }
struct AgentChart: Codable {
 var title: String
 var unit: String
 var target: Double?
 var color: String
 var points: [AgentChartPoint]
 static let placeholder=AgentChart(title:"Chart",unit:"",target:nil,color:"#72E4B4",points:[])
}
struct AgentButton: Codable, Identifiable { var id: String; var label: String; var style: String? }
struct AgentGrid: Codable { var prompt: String?; var buttons: [AgentButton] }
struct AgentWidgets: Codable { var botCard: AgentCard; var metric: AgentMetric; var buttonGrid: AgentGrid; var chart: AgentChart? }
struct AgentSnapshot: Codable { var schemaVersion: Int; var revision: Int; var updatedAt: String; var widgets: AgentWidgets }
enum AgentError: Error { case unpaired, invalidURL, invalidResponse, sharedStorageUnavailable, keychain(OSStatus) }
public struct AgentActionChoice: Sendable, Hashable { public var id:String; public var label:String; public init(id:String,label:String){self.id=id;self.label=label} }
public enum AgentActionError: Error, Sendable { case unpaired, missingAction }
public enum AgentShared {
 public static var onActionsChanged:(() -> Void)?
 static let group = "group.com.example.agentnoticeboard"
 static var directory: URL {
  get throws {
   guard let directory=FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:group) else { throw AgentError.sharedStorageUnavailable }
   return directory
  }
 }
 static var defaults: UserDefaults { UserDefaults(suiteName: group)! }
 static var keychainGroup: String { Bundle.main.object(forInfoDictionaryKey: "AgentKeychainGroup") as? String ?? "" }
 static func keychainQuery() -> [String: Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"AgentNoticeboard",kSecAttrAccount as String:"relay",kSecAttrAccessGroup as String:keychainGroup] }
 static func configure(_ credential: AgentCredential) throws {
  guard let url=URL(string:credential.relay),url.scheme=="https",url.host != nil else { throw AgentError.invalidURL }
  let data=try JSONEncoder().encode(credential)
  let query=keychainQuery()
  var status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
  if status==errSecItemNotFound { var add=query;add[kSecValueData as String]=data;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;status=SecItemAdd(add as CFDictionary,nil) }
  guard status==errSecSuccess else { throw AgentError.keychain(status) }
 }
 static func credential() throws -> AgentCredential {
  var query=keychainQuery();query[kSecReturnData as String]=true;query[kSecMatchLimit as String]=kSecMatchLimitOne
  var result:CFTypeRef?;let status=SecItemCopyMatching(query as CFDictionary,&result)
  guard status==errSecSuccess,let data=result as? Data else { throw AgentError.unpaired }
  return try JSONDecoder().decode(AgentCredential.self,from:data)
 }
 static func clear() { try? FileManager.default.removeItem(at:directory.appendingPathComponent("actions"));SecItemDelete(keychainQuery() as CFDictionary);try? FileManager.default.removeItem(at:directory.appendingPathComponent("state.json"));WidgetCenter.shared.reloadAllTimelines() }
 static func request(_ path:String,body:[String:Any]?=nil) async throws -> Data {
  let c=try credential();guard let url=URL(string:c.relay+path) else { throw AgentError.invalidURL }
  var request=URLRequest(url:url);request.timeoutInterval=15;request.httpMethod=body==nil ? "GET":"POST"
  request.setValue("Bearer \(c.secret)",forHTTPHeaderField:"Authorization");request.setValue(c.deviceId,forHTTPHeaderField:"X-Device-ID");request.setValue("application/json",forHTTPHeaderField:"Content-Type")
  if let body { request.httpBody=try JSONSerialization.data(withJSONObject:body) }
  let (data,response)=try await URLSession.shared.data(for:request)
  guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else { throw AgentError.invalidResponse }
  return data
 }
 static func save(_ data:Data) throws {
  let snapshot=try JSONDecoder().decode(AgentSnapshot.self,from:data);guard snapshot.schemaVersion==1 else { throw AgentError.invalidResponse }
  try data.write(to:directory.appendingPathComponent("state.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
 }
 static func snapshot() -> AgentSnapshot? { guard let data=try? Data(contentsOf:directory.appendingPathComponent("state.json")) else{return nil};return try? JSONDecoder().decode(AgentSnapshot.self,from:data) }
 public static func currentButtons() -> [AgentActionChoice] {
  var seen=Set<String>()
  return (snapshot()?.widgets.buttonGrid.buttons ?? []).compactMap { button in
   guard seen.insert(button.id).inserted else { return nil }
   return AgentActionChoice(id:button.id,label:button.label)
  }
 }
 static func refresh() async throws { let data=try await request("/state");try save(data);try await flushActions();try await registerCachedWidgetToken() }
 static func register(_ tokens:[String:Any]) async throws { _=try await request("/register",body:["tokens":tokens]) }
 static func registerCachedWidgetToken() async throws { if let token=defaults.string(forKey:"widgetPushToken") { try await register(["widget":token]) } }
 static func sendAction(_ id:String) async throws {
  let event:[String:Any] = ["id":UUID().uuidString.lowercased(),"actionId":id,"source":"widget","timestamp":ISO8601DateFormatter().string(from:Date())]
  let data=try JSONSerialization.data(withJSONObject:event)
  let pending=try directory.appendingPathComponent("actions",isDirectory:true);try FileManager.default.createDirectory(at:pending,withIntermediateDirectories:true)
  let file=pending.appendingPathComponent("\(event["id"]!).json");try data.write(to:file,options:.atomic)
  _=try await request("/action",body:event);try? FileManager.default.removeItem(at:file)
 }
 public static func performAction(_ id:String) async throws {
  let trimmed=id.trimmingCharacters(in:.whitespacesAndNewlines)
  if trimmed.isEmpty { throw AgentActionError.missingAction }
  do { try await sendAction(trimmed) } catch AgentError.unpaired { throw AgentActionError.unpaired }
  try? await refresh()
  WidgetCenter.shared.reloadAllTimelines()
  await noteActionsChanged()
 }
 public static func noteActionsChanged() async { let notify=onActionsChanged; await MainActor.run { notify?() } }
 static func flushActions() async throws {
  let pending=try directory.appendingPathComponent("actions",isDirectory:true)
  for file in (try? FileManager.default.contentsOfDirectory(at:pending,includingPropertiesForKeys:nil)) ?? [] {
   guard let data=try? Data(contentsOf:file),let event=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else{continue}
   _=try await request("/action",body:event);try? FileManager.default.removeItem(at:file)
  }
 }
 static func hex(_ data:Data)->String { data.map{String(format:"%02x",$0)}.joined() }
}
