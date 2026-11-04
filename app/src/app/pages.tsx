import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { type PageRecord } from "../../../shared/schema";
import { loadPages } from "../relay";
import { styles as s, colors } from "../theme";
export default function Pages() {
  const [pages, setPages] = useState<PageRecord[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setPages(await loadPages());
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      setReady(true);
    }
  }, []);
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
      {message !== "" && (
        <Text accessibilityRole="alert" style={s.error}>
          {message}
        </Text>
      )}
      {ready && pages.length === 0 && message === "" && (
        <View style={s.card}>
          <Text style={s.title}>No pages yet</Text>
          <Text style={s.text}>
            When an agent publishes a page, it shows up here. A notification can open one directly.
          </Text>
        </View>
      )}
      {pages.map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          style={s.card}
          onPress={() => router.push({ pathname: "/page", params: { id: item.id } })}
        >
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.muted}>Updated {new Date(item.updatedAt).toLocaleString()}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
