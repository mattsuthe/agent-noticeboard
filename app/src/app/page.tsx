import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Markdown from "../Markdown";
import { type PageRecord } from "../../../shared/schema";
import { loadPage } from "../relay";
import { styles as s, colors } from "../theme";
export default function PageScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const pageId = typeof params.id === "string" ? params.id : "";
  const [page, setPage] = useState<PageRecord | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!pageId) {
      setPage(null);
      setMessage("This page is missing.");
      return;
    }
    setBusy(true);
    try {
      setPage(await loadPage(pageId));
      setMessage("");
    } catch (e) {
      setPage(null);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [pageId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={busy} onRefresh={refresh} tintColor={colors.accent} />
      }
    >
      <Stack.Screen options={{ title: page?.title ?? "Page" }} />
      {message !== "" && (
        <Text accessibilityRole="alert" style={s.error}>
          {message}
        </Text>
      )}
      {page && (
        <View style={s.card}>
          <Markdown>{page.markdown}</Markdown>
        </View>
      )}
    </ScrollView>
  );
}
