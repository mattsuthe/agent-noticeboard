import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { credentials, pair, registerPush, sync, unpair } from "../relay";
import { styles as s, colors } from "../theme";
export default function Settings() {
  const [relay, setRelay] = useState(""),
    [code, setCode] = useState(""),
    [device, setDevice] = useState(""),
    [last, setLast] = useState("Never"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const c = await credentials();
    setRelay(c?.relay ?? "");
    setDevice(c?.deviceId ?? "");
    setLast((await AsyncStorage.getItem("agent-last-sync")) ?? "Never");
  }
  useEffect(() => {
    let active = true;
    Promise.all([credentials(), AsyncStorage.getItem("agent-last-sync")]).then(
      ([c, lastSync]) => {
        if (active) {
          setRelay(c?.relay ?? "");
          setDevice(c?.deviceId ?? "");
          setLast(lastSync ?? "Never");
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);
  async function connect() {
    setBusy(true);
    try {
      await pair(relay, code);
      setCode("");
      await sync();
      setMessage("Paired and synchronized.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      await load();
      setBusy(false);
    }
  }
  async function retry() {
    try {
      await registerPush();
      setMessage("Push tokens registered.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={s.page} contentContainerStyle={s.content}>
      <Text style={s.section}>CONNECTION</Text>
      <Text style={s.text}>
        Use the HTTPS relay address and one-time code from any agent connected to your relay.
      </Text>
      <Text style={s.muted}>Relay address</Text>
      <TextInput
        accessibilityLabel="Relay URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://your-relay.workers.dev"
        placeholderTextColor={colors.secondary}
        value={relay}
        onChangeText={setRelay}
        style={s.input}
      />
      <Text style={s.muted}>One-time pairing code</Text>
      <TextInput
        accessibilityLabel="Pairing code"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="One-time pairing code"
        placeholderTextColor={colors.secondary}
        value={code}
        onChangeText={setCode}
        style={s.input}
      />
      <Pressable disabled={busy} style={s.button} onPress={connect}>
        <Text style={s.buttonText}>{busy ? "Connecting…" : "Pair iPhone"}</Text>
      </Pressable>
      <Link href="/pair" style={{ color: colors.accent }}>
        Scan QR code  ›
      </Link>
      {message !== "" && <Text style={s.text}>{message}</Text>}
      <View style={s.card}>
        <Text style={s.muted}>DEVICE REGISTRATION</Text>
        <Text selectable style={s.text}>
          {device || "Not paired"}
        </Text>
        <Text style={s.muted}>LAST SYNC</Text>
        <Text style={s.text}>{last}</Text>
        <Text style={s.muted}>APP VERSION</Text>
        <Text style={s.text}>{Constants.expoConfig?.version ?? "Unknown"}</Text>
        <Text style={s.muted}>INSTALLED BUILD</Text>
        <Text selectable style={s.text}>{Constants.platform?.ios?.buildNumber ?? "Development build"}</Text>
        <Text style={s.muted}>UPDATE</Text>
        <Text selectable style={s.text}>{Updates.updateId ?? "Embedded bundle"}</Text>
        <Text style={s.text}>{Updates.isEmbeddedLaunch ? "Bundled with this build" : "Downloaded update"} · {Updates.channel ?? "Development"}</Text>
        <Text style={s.muted}>TESTFLIGHT</Text>
        <Text style={s.text}>Builds expire after 90 days. Updates do not renew the installed build. TestFlight shows its exact expiry; the operator monitors renewal at 80 days.</Text>
        <Text style={s.muted}>RUNTIME VERSION</Text>
        <Text selectable style={s.text}>
          {Updates.runtimeVersion ?? "Development build"}
        </Text>
      </View>
      {!!device && (
        <>
          <Pressable onPress={retry}>
            <Text style={s.text}>Register push notifications again</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert(
                "Disconnect this iPhone?",
                "Your agent can revoke this device at the relay.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Disconnect",
                    style: "destructive",
                    onPress: () => {
                      void unpair().then(load);
                    },
                  },
                ],
              )
            }
          >
            <Text style={s.error}>Disconnect</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
