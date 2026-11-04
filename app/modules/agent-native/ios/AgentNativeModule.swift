import ExpoModulesCore
import WidgetKit
import ActivityKit
import UIKit

public class AgentNativeModule: Module {
 public func definition() -> ModuleDefinition {
  Name("AgentNative")
  AsyncFunction("configure") { (value:[String:String]) in
   guard let relay=value["relay"],let deviceId=value["deviceId"],let secret=value["secret"] else { throw AgentError.unpaired }
   try AgentShared.configure(AgentCredential(relay:relay,deviceId:deviceId,secret:secret))
   await AgentActivityObserver.shared.start()
   try? await AgentShared.registerCachedWidgetToken()
  }
  AsyncFunction("clear") { AgentShared.clear() }
  AsyncFunction("saveState") { (json:String) in try AgentShared.save(Data(json.utf8));WidgetCenter.shared.reloadAllTimelines();await AgentShared.noteActionsChanged() }
  AsyncFunction("startObserving") { await AgentActivityObserver.shared.start() }
 }
}
actor AgentActivityObserver {
 static let shared=AgentActivityObserver()
 var started=false
 var observed=Set<String>()
 func start() {
  guard !started else { Task { await self.reconcile() };return };started=true
  Task { for await token in Activity<AgentActivityAttributes>.pushToStartTokenUpdates { try? await AgentShared.register(["pushToStart":AgentShared.hex(token)]) } }
  Task { for await activity in Activity<AgentActivityAttributes>.activityUpdates { await self.observe(activity) } }
  Task { await self.reconcile() }
 }
 func reconcile() async {
  if let token=Activity<AgentActivityAttributes>.pushToStartToken { try? await AgentShared.register(["pushToStart":AgentShared.hex(token)]) }
  for activity in Activity<AgentActivityAttributes>.activities { await observe(activity);if let token=activity.pushToken{try? await register(activity,token)} }
 }
 func observe(_ activity:Activity<AgentActivityAttributes>) async {
  guard observed.insert(activity.id).inserted else{return}
  Task { for await token in activity.pushTokenUpdates { try? await self.register(activity,token) } }
 }
 func register(_ activity:Activity<AgentActivityAttributes>,_ token:Data) async throws { try await AgentShared.register(["activities":[["id":activity.attributes.activityId,"token":AgentShared.hex(token)]]]) }
}
public class AgentAppDelegateSubscriber: ExpoAppDelegateSubscriber {
 public func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool { Task { await AgentActivityObserver.shared.start() };return true }
 public func applicationDidBecomeActive(_ application:UIApplication) { Task { await AgentActivityObserver.shared.start();try? await AgentShared.registerCachedWidgetToken();try? await AgentShared.flushActions();await AgentShared.noteActionsChanged() } }
 public func application(_ application:UIApplication,didReceiveRemoteNotification userInfo:[AnyHashable:Any],fetchCompletionHandler completionHandler:@escaping(UIBackgroundFetchResult)->Void) {
  Task { do {try await AgentShared.refresh();WidgetCenter.shared.reloadAllTimelines();await AgentShared.noteActionsChanged();completionHandler(.newData)}catch{completionHandler(.failed)} }
 }
}
