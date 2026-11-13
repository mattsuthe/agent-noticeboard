import ReportFeedback from "../ReportFeedback";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import Markdown from "../Markdown";
import { type PageRecord } from "../../../shared/schema";
import { loadPage } from "../relay";
import { colors, styles as s } from "../theme";

export { default as ErrorBoundary } from "../ScreenError";

function unavailable(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "ZodError")
    return "Could not read these details.";
  if (text === "Page not found" || text === "Page expired")
    return "These details are no longer available.";
  return text || "Could not load these details.";
}

export default function DetailsPage() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const raw = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const id = raw.length > 0 && raw.length <= 128 ? raw : "";
  return <PageDetails key={id} id={id} />;
}

function PageDetails({ id }: { id: string }) {
  const [item, setItem] = useState<PageRecord | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    if (!id) {
      setItem(null);
      setMessage("These details are no longer available.");
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const page = await loadPage(id);
      if (current !== request.current) return;
      setItem(page.page);
      setMessage(page.cachedAt ? `Offline copy saved ${new Date(page.cachedAt).toLocaleString()}. Pull to refresh.` : "");
    } catch (error) {
      if (current !== request.current) return;
      setItem(null);
      setMessage(unavailable(error));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }, [id]);
  useEffect(() => {
    const current = ++request.current;
    const pending = id
      ? loadPage(id)
      : Promise.reject(new Error("Page not found"));
    pending.then(
      (page) => {
        if (current !== request.current) return;
        setItem(page.page);
        setMessage(page.cachedAt ? `Offline copy saved ${new Date(page.cachedAt).toLocaleString()}. Pull to refresh.` : "");
        setBusy(false);
      },
      (error: unknown) => {
        if (current !== request.current) return;
        setItem(null);
        setMessage(
          id ? unavailable(error) : "These details are no longer available.",
        );
        setBusy(false);
      },
    );
    return () => {
      request.current += 1;
    };
  }, [id]);
  return (
    <>
      <Stack.Screen
        options={{ title: item?.title ?? "Details", headerLargeTitle: true }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        style={s.page}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={load}
            tintColor={colors.accent}
          />
        }
      >
        {busy && !item && message === "" && (
          <Text style={s.muted}>Loading details…</Text>
        )}
        {message !== "" && (
          <View style={s.card}>
            <Text accessibilityRole="alert" style={s.text}>
              {message}
            </Text>
            {message.startsWith("Pair") && (
              <Link href="/settings" style={{ color: colors.accent }}>
                Settings
              </Link>
            )}
          </View>
        )}
        {item && (
          <View style={s.card}>
            <Markdown>{item.markdown}</Markdown>
          </View>
        )}
        {item && (
          <Text style={s.muted}>
            Updated {new Date(item.updatedAt).toLocaleString()}
          </Text>
        )}
        {item && <ReportFeedback key={item.id} page={item} />}
      </ScrollView>
    </>
  );
}
