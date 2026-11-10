import { useCallback, useEffect, useState } from "react";
import {
  AppState as Lifecycle,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, useFocusEffect } from "expo-router";
import Markdown from "../Markdown";
import * as Notifications from "expo-notifications";
import { type AppState, type UIBlock } from "../../../shared/schema";
import { action, cached, credentials, sync } from "../relay";
import { styles as s, colors } from "../theme";
function BlockView({
  block,
  onAction,
}: {
  block: UIBlock;
  onAction: (id: string) => void;
}) {
  switch (block.type) {
    case "text":
      return (
        <View style={s.card}>
          {block.title && <Text style={s.title}>{block.title}</Text>}
          <Text style={s.text}>{block.text}</Text>
        </View>
      );
    case "markdown":
      return (
        <View style={s.card}>
          <Markdown>{block.markdown}</Markdown>
        </View>
      );
    case "metric":
      return (
        <View style={s.card}>
          <Text style={s.muted}>{block.label}</Text>
          <Text
            style={[s.title, { fontSize: 44, fontWeight: "600", fontVariant: ["tabular-nums"], color: block.color ?? colors.accent }]}
          >
            {block.value}
          </Text>
          {block.delta && <Text style={s.text}>{block.delta}</Text>}
        </View>
      );
    case "list":
      return (
        <View style={s.card}>
          {block.title && <Text style={s.title}>{block.title}</Text>}
          {block.items.map((item, i) => (
            <Text key={i} style={s.text}>
              • {item}
            </Text>
          ))}
        </View>
      );
    case "image":
      return (
        <View style={s.card}>
          <Image
            source={{ uri: block.url }}
            accessibilityLabel={block.alt}
            style={{ height: 220, borderRadius: 12 }}
            resizeMode="cover"
          />
          <Text style={s.muted}>{block.alt}</Text>
        </View>
      );
    case "button":
      return (
        <Pressable
          accessibilityRole="button"
          style={s.button}
          onPress={() => onAction(block.actionId)}
        >
          <Text style={s.buttonText}>{block.label}</Text>
        </Pressable>
      );
  }
}
export default function Home() {
  const [state, setState] = useState<AppState | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      if (!(await credentials())) {
        setState(null);
        setMessage("");
        return;
      }
      setState(await sync());
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void cached().then(setState).then(refresh);
  }, [refresh]));
  useEffect(() => {
    const subscription = Lifecycle.addEventListener("change", (v) => {
      if (v === "active") void refresh();
    });
    const notifications = Notifications.addNotificationReceivedListener(
      () => void refresh(),
    );
    return () => {
      subscription.remove();
      notifications.remove();
    };
  }, [refresh]);
  async function tap(id: string, widgetId?: string) {
    try {
      await action(id, widgetId);
      setMessage("Action sent.");
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          onRefresh={refresh}
          tintColor={colors.accent}
        />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={s.largeTitle}>Noticeboard</Text>
        <Link href="/settings" style={{ color: colors.accent }}>
          Settings
        </Link>
      </View>
      <Text style={s.muted}>YOUR AGENTS, AT A GLANCE</Text>
      {state && (
        <Link href="/pages" style={{ color: colors.accent }}>
          Pages  ›
        </Link>
      )}
      {message !== "" && (
        <Text accessibilityRole="alert" style={s.error}>
          {message}
        </Text>
      )}
      {!state && (
        <View style={s.card}>
          <Text style={s.title}>A little closer to your agents.</Text>
          <Text style={s.text}>
            Pair this iPhone with your relay to bring your agents’ updates, metrics,
            and actions to your home screen.
          </Text>
          <Link href="/settings" style={{ color: colors.accent }}>
            Connect an agent  ›
          </Link>
        </View>
      )}
      {state?.blocks.map((block) => (
        <BlockView key={block.id} block={block} onAction={tap} />
      ))}
      {!!state?.widgetInstances?.length && (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={s.title}>Widget library</Text>
          <Text style={s.muted}>
            Add a Noticeboard widget to your Home Screen, then press and hold it,
            choose Edit Widget, and select its Content. Each copy can show something different.
          </Text>
          {state.widgetInstances.map((widget) => (
            <View key={widget.id} style={s.card}>
              <Text style={s.title}>{widget.name}</Text>
              <Text style={s.muted}>
                {({ botCard: "Text card", metric: "Metric", chart: "Chart", buttonGrid: "Button grid" })[widget.kind]}
              </Text>
              {widget.kind === "botCard" && <Text style={s.text} numberOfLines={3}>{widget.data.body}</Text>}
              {widget.kind === "metric" && <Text style={s.text}>{widget.data.label}: {widget.data.value} {widget.data.delta ?? ""}</Text>}
              {widget.kind === "chart" && <Text style={s.text}>
                {widget.data.title}{widget.data.points.length ? `: ${widget.data.points[widget.data.points.length - 1].value} ${widget.data.unit}` : ": Waiting for data"}
              </Text>}
              {widget.kind === "buttonGrid" ? <>
                {widget.data.prompt && <Text style={s.text}>{widget.data.prompt}</Text>}
                {widget.data.buttons.map(button => <Pressable key={button.id} accessibilityRole="button" style={s.button} onPress={() => void tap(button.id, widget.id)}>
                  <Text style={s.buttonText}>{button.label}</Text>
                </Pressable>)}
              </> : widget.data.pageId && (
                <Link href={{ pathname: "/page", params: { id: widget.data.pageId } }} style={{ color: colors.accent }}>View details ›</Link>
              )}
            </View>
          ))}
        </View>
      )}
      {state && (
        <Text style={s.muted}>
          Updated {new Date(state.updatedAt).toLocaleString()}
        </Text>
      )}
    </ScrollView>
  );
}
