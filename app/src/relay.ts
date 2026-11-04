import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { State, type AppState } from "../../shared/schema";
import { AgentNative, type Pairing } from "./native";
import * as Crypto from "expo-crypto";
const key = "agent-pairing";
export async function credentials(): Promise<Pairing | null> {
  const value = await SecureStore.getItemAsync(key);
  return value ? JSON.parse(value) : null;
}
export async function request(path: string, method = "GET", body?: unknown) {
  const auth = await credentials();
  if (!auth) throw new Error("Pair your iPhone in Settings.");
  const response = await fetch(`${auth.relay}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.secret}`,
      "x-device-id": auth.deviceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? `Relay returned ${response.status}`);
  return result;
}
export function validateRelay(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Use an HTTPS relay origin, such as https://agent.example.workers.dev",
    );
  return url.origin;
}
export async function pair(relay: string, code: string) {
  const origin = validateRelay(relay);
  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: code.trim(), name: "My iPhone" }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Pairing failed");
  const value = {
    relay: origin,
    deviceId: result.deviceId,
    secret: result.secret,
  };
  await AgentNative.configure(value);
  await SecureStore.setItemAsync(key, JSON.stringify(value));
  await registerPush();
  return value;
}
export async function unpair() {
  await AgentNative.clear();
  await SecureStore.deleteItemAsync(key);
  await AsyncStorage.multiRemove(["agent-state", "agent-last-sync"]);
}
export async function registerPush() {
  if (!(await credentials())) return;
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Paired. Enable notifications in iPhone Settings to receive alerts.",
    );
  const token = await Notifications.getDevicePushTokenAsync();
  await request("/register", "POST", {
    tokens: { device: String(token.data) },
  });
  await AgentNative.startObserving();
}
export async function sync(): Promise<AppState> {
  const state = State.parse(await request("/state"));
  await AgentNative.saveState(JSON.stringify(state));
  await AsyncStorage.setItem("agent-state", JSON.stringify(state));
  await AsyncStorage.setItem("agent-last-sync", new Date().toISOString());
  return state;
}
export async function cached(): Promise<AppState | null> {
  const raw = await AsyncStorage.getItem("agent-state");
  if (!raw) return null;
  const parsed = State.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}
export async function action(actionId: string) {
  return request("/action", "POST", {
    id: Crypto.randomUUID(),
    actionId,
    source: "app",
    timestamp: new Date().toISOString(),
  });
}
