import { useColorScheme } from "react-native";
import { colors } from "../theme";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { registerPush } from "../relay";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
export default function Layout() {
  const dark = useColorScheme() === "dark";
  useEffect(() => {
    registerPush().catch(() => {});
  }, []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: dark ? "#000000" : "#F2F2F7" },
          headerShadowVisible: false,
          headerTitleStyle: { color: dark ? "#F2F2F7" : "#1C1C1E" },
          headerUserInterfaceStyle: dark ? "dark" : "light",
          headerTintColor: dark ? "#0A84FF" : "#007AFF",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Noticeboard", headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="pair" options={{ title: "Pair iPhone" }} />
      </Stack>
    </>
  );
}
