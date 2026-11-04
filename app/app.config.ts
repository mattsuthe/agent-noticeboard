import type { ExpoConfig } from "expo/config";
export default (): ExpoConfig => ({
  name: "Agent Noticeboard",
  slug: "agent-noticeboard",
  owner: "YOUR_EXPO_OWNER",
  scheme: "agentnoticeboard",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  runtimeVersion: { policy: "fingerprint" },
  ios: {
    bundleIdentifier: "com.example.agentnoticeboard",
    appleTeamId: "YOUR_TEAM_ID",
    supportsTablet: false,
    infoPlist: {
      NSSupportsLiveActivities: true,
      UIBackgroundModes: ["remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      "com.apple.security.application-groups": [
        "group.com.example.agentnoticeboard",
      ],
      "keychain-access-groups": [
        "$(AppIdentifierPrefix)com.example.agentnoticeboard.shared",
      ],
    },
  },
  plugins: [
    "expo-router",
    "expo-dev-client",
    "expo-secure-store",
    ["expo-notifications", { enableBackgroundRemoteNotifications: true }],
    [
      "expo-camera",
      { cameraPermission: "Scan a pairing code from your agent." },
    ],
    ["expo-build-properties", { ios: { deploymentTarget: "26.0" } }],
    "./plugins/withAgentWidgets.cjs",
  ],
  updates: { url: "https://u.expo.dev/00000000-0000-0000-0000-000000000002" },
  extra: { eas: { projectId: "00000000-0000-0000-0000-000000000002" } },
});
