const {
  withInfoPlist,
  withXcodeProject,
  withEntitlementsPlist,
  withAppDelegate,
} = require("expo/config-plugins");
const fs = require("node:fs"),
  path = require("node:path"),
  plist = require("@expo/plist").default;
const targetName = "AgentWidgets",
  group = "group.com.example.agentcompanion",
  keychain = "$(AppIdentifierPrefix)com.example.agentcompanion.shared",
  intentFile = "AgentAppIntents.swift";
function ensureAppIntentSource(project, projectRoot, iosRoot) {
  fs.copyFileSync(
    path.join(projectRoot, "native", intentFile),
    path.join(iosRoot, intentFile),
  );
  const linked = Object.values(project.pbxFileReferenceSection()).some(
    (file) =>
      file &&
      typeof file === "object" &&
      String(file.path || "")
        .replaceAll('"', "")
        .endsWith(intentFile),
  );
  if (linked) return;
  let appUuid;
  for (const [key, value] of Object.entries(project.pbxNativeTargetSection())) {
    if (key.endsWith("_comment") || !value || typeof value !== "object")
      continue;
    const type = String(value.productType || "").replaceAll('"', "");
    if (type === "com.apple.product-type.application") {
      appUuid = key;
      break;
    }
  }
  if (!appUuid) throw new Error("Agent Companion app target was not found");
  project.addSourceFile(
    intentFile,
    { target: appUuid },
    project.getFirstProject().firstProject.mainGroup,
  );
}
module.exports = function withAgentWidgets(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.AgentKeychainGroup = keychain;
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    c.modResults["aps-environment"] = "production";
    return c;
  });
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        experimental: {
          ios: {
            appExtensions: [
              {
                targetName,
                bundleIdentifier: "com.example.agentcompanion.widgets",
                entitlements: {
                  "com.apple.security.application-groups": [group],
                  "keychain-access-groups": [keychain],
                  "aps-environment": "production",
                },
              },
            ],
          },
        },
      },
    },
  };
  config = withAppDelegate(config, (c) => {
    const marker =
      "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
    if (!c.modResults.contents.includes("AgentShortcuts.install()")) {
      if (!c.modResults.contents.includes(marker))
        throw new Error(
          "Could not install Agent shortcut bootstrap in AppDelegate",
        );
      c.modResults.contents = c.modResults.contents.replace(
        marker,
        `AgentShortcuts.install()\n    ${marker}`,
      );
    }
    return c;
  });
  return withXcodeProject(config, (c) => {
    const root = c.modRequest.projectRoot,
      ios = c.modRequest.platformProjectRoot,
      dir = path.join(ios, targetName);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(root, "native/AgentWidgets.swift"),
      path.join(dir, "AgentWidgets.swift"),
    );
    fs.copyFileSync(
      path.join(root, "modules/agent-native/ios/AgentShared.swift"),
      path.join(dir, "AgentShared.swift"),
    );
    const p = c.modResults;
    ensureAppIntentSource(p, root, ios);
    fs.writeFileSync(
      path.join(dir, "Info.plist"),
      plist.build({
        CFBundleDisplayName: "Agent Companion",
        CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
        CFBundleExecutable: "$(EXECUTABLE_NAME)",
        CFBundleName: "$(PRODUCT_NAME)",
        CFBundlePackageType: "XPC!",
        CFBundleShortVersionString: c.version ?? "1.0.0",
        CFBundleVersion: c.ios?.buildNumber ?? "1",
        AgentKeychainGroup: keychain,
        NSExtension: {
          NSExtensionPointIdentifier: "com.apple.widgetkit-extension",
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "AgentWidgets.entitlements"),
      plist.build({
        "com.apple.security.application-groups": [group],
        "keychain-access-groups": [keychain],
        "aps-environment": "production",
      }),
    );
    if (
      Object.values(p.pbxNativeTargetSection()).some(
        (t) =>
          typeof t === "object" && t.name?.replaceAll('"', "") === targetName,
      )
    )
      return c;
    p.hash.project.objects.PBXTargetDependency ??= {};
    p.hash.project.objects.PBXContainerItemProxy ??= {};
    const target = p.addTarget(
      targetName,
      "app_extension",
      targetName,
      "com.example.agentcompanion.widgets",
    );
    p.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    p.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    p.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    const files = p.addPbxGroup([], targetName, targetName);
    p.addToPbxGroup(files.uuid, p.getFirstProject().firstProject.mainGroup);
    for (const file of ["AgentWidgets.swift", "AgentShared.swift"])
      p.addSourceFile(file, { target: target.uuid }, files.uuid);
    const list =
      p.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    for (const ref of list.buildConfigurations) {
      const settings =
        p.pbxXCBuildConfigurationSection()[ref.value].buildSettings;
      Object.assign(settings, {
        INFOPLIST_FILE: '"AgentWidgets/Info.plist"',
        CODE_SIGN_ENTITLEMENTS: '"AgentWidgets/AgentWidgets.entitlements"',
        IPHONEOS_DEPLOYMENT_TARGET: "26.0",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: "1",
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CODE_SIGN_STYLE: "Automatic",
        GENERATE_INFOPLIST_FILE: "NO",
        CURRENT_PROJECT_VERSION: c.ios?.buildNumber ?? "1",
        MARKETING_VERSION: c.version ?? "1.0.0",
        CLANG_ENABLE_MODULES: "YES",
        SWIFT_EMIT_LOC_STRINGS: "YES",
      });
    }
    p.addTargetAttribute(
      "SystemCapabilities",
      {
        "com.apple.ApplicationGroups.iOS": { enabled: 1 },
        "com.apple.Push": { enabled: 1 },
      },
      target,
    );
    return c;
  });
};
