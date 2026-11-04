import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, router } from "expo-router";
import { pair, sync } from "../relay";
import { styles as s } from "../theme";
export default function Pair() {
  const params = useLocalSearchParams<{ relay?: string; code?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [candidate, setCandidate] = useState<{
    relay: string;
    code: string;
  } | null>(
    params.relay && params.code
      ? { relay: params.relay, code: params.code }
      : null,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function scan(value: string) {
    try {
      const url = new URL(value);
      if (url.protocol !== "agentnoticeboard:" || url.hostname !== "pair")
        throw new Error("This is not an Agent Noticeboard pairing code.");
      const relay = url.searchParams.get("relay"),
        code = url.searchParams.get("code");
      if (!relay || !code) throw new Error("Incomplete pairing code.");
      setCandidate({ relay, code });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirm() {
    if (!candidate) return;
    setBusy(true);
    try {
      await pair(candidate.relay, candidate.code);
      await sync();
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.page, s.content]}>
      <Text style={s.title}>Connect your agent</Text>
      {candidate ? (
        <>
          <Text style={s.text}>Connect to this relay?</Text>
          <Text selectable style={s.muted}>
            {candidate.relay}
          </Text>
          <Pressable disabled={busy} onPress={confirm} style={s.button}>
            <Text style={s.buttonText}>{busy ? "Connecting…" : "Connect"}</Text>
          </Pressable>
          <Pressable onPress={() => setCandidate(null)}>
            <Text style={s.text}>Scan another code</Text>
          </Pressable>
        </>
      ) : permission?.granted ? (
        <CameraView
          style={{ height: 350, borderRadius: 20 }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(r) => scan(r.data)}
        />
      ) : (
        <Pressable onPress={requestPermission} style={s.button}>
          <Text style={s.buttonText}>Enable camera to scan</Text>
        </Pressable>
      )}
      {error !== "" && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
