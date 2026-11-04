import { useColorScheme } from "react-native";
import { colors } from "../theme";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { registerPush } from "../relay";
function pageIdFromNotification(
  response: Notifications.NotificationResponse | null | undefined,
) {
  const value = response?.notification.request.content.data?.pageId;
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}
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
  const response = Notifications.useLastNotificationResponse();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    registerPush().catch(() => {});
  }, []);
  useEffect(() => {
    if (!response) return;
    const pageId = pageIdFromNotification(response);
    const key = response.notification.request.identifier;
    if (
      !pageId ||
      !key ||
      opened.current === key ||
      response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    )
      return;
    opened.current = key;
    router.push({ pathname: "/page", params: { id: pageId } });
    Notifications.clearLastNotificationResponse();
  }, [response]);
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
        <Stack.Screen name="pages" options={{ title: "Pages" }} />
        <Stack.Screen name="page" options={{ title: "Page" }} />
      </Stack>
    </>
  );
}
