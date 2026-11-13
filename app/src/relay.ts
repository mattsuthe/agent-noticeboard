import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Page, PageList, State, type AppState, type PageRecord } from "../../shared/schema";
import { AgentNative, type Pairing } from "./native";
import * as Crypto from "expo-crypto";
import { fetchJSON, RelayError } from "./http";
import { readPages, savePage } from "./page-cache";
const key = "agent-pairing";
const cacheKey = (auth: Pairing, kind: string) => `noticeboard-${kind}:${auth.relay}:${auth.deviceId}`;
export async function credentials(): Promise<Pairing | null> {
  const value = await SecureStore.getItemAsync(key);
  return value ? JSON.parse(value) : null;
}
export async function request(path: string, method = "GET", body?: unknown) {
  const auth = await credentials();
  if (!auth) throw new Error("Pair your iPhone in Settings.");
  return requestWith(auth, path, method, body);
}
function requestWith(auth: Pairing, path: string, method = "GET", body?: unknown) {
  return fetchJSON(`${auth.relay}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.secret}`,
      "x-device-id": auth.deviceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
      "Use an HTTPS relay origin, such as https://your-relay.workers.dev",
    );
  return url.origin;
}
export async function pair(relay: string, code: string) {
  const origin = validateRelay(relay);
  const result = await fetchJSON(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: code.trim(), name: "My iPhone" }),
  });
  const value = {
    relay: origin,
    deviceId: result.deviceId,
    secret: result.secret,
  };
  await AsyncStorage.multiRemove(["agent-state", "agent-last-sync"]);
  await AgentNative.configure(value);
  await SecureStore.setItemAsync(key, JSON.stringify(value));
  await registerPush();
  return value;
}
export async function unpair() {
  const auth = await credentials();
  await AgentNative.clear();
  await SecureStore.deleteItemAsync(key);
  await AsyncStorage.multiRemove(["agent-state", "agent-last-sync", ...(auth ?
    [cacheKey(auth, "state"), cacheKey(auth, "pages")] : [])]);
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
let syncing: Promise<AppState> | undefined;
export function sync(): Promise<AppState> {
  if (!syncing) syncing = syncOnce().finally(() => { syncing = undefined; });
  return syncing;
}
async function syncOnce(): Promise<AppState> {
  const auth = await credentials();
  if (!auth) throw new Error("Pair your iPhone in Settings.");
  const state = State.parse(await requestWith(auth, "/state?widgets=1"));
  const current = await credentials();
  if (!current || cacheKey(current, "state") !== cacheKey(auth, "state")) throw new Error("Pairing changed. Refresh again.");
  await AgentNative.saveState(JSON.stringify(state));
  await AsyncStorage.setItem(cacheKey(auth, "state"), JSON.stringify(state));
  await AsyncStorage.setItem("agent-last-sync", new Date().toISOString());
  return state;
}
export async function cached(): Promise<AppState | null> {
  try {
    const auth = await credentials();
    if (!auth) return null;
    const scoped = cacheKey(auth, "state");
    const raw = await AsyncStorage.getItem(scoped) ?? await AsyncStorage.getItem("agent-state");
    const parsed = State.safeParse(JSON.parse(raw ?? "null"));
    if (!parsed.success) return null;
    await AsyncStorage.setItem(scoped, JSON.stringify(parsed.data));
    await AsyncStorage.removeItem("agent-state");
    return parsed.data;
  } catch { return null; }
}
let cacheWrite = Promise.resolve();
function updatePages(key: string, update: (entries: ReturnType<typeof readPages>) => ReturnType<typeof readPages>) {
  cacheWrite = cacheWrite.catch(() => {}).then(async () => {
    const entries = readPages(await AsyncStorage.getItem(key));
    await AsyncStorage.setItem(key, JSON.stringify(update(entries)));
  });
  return cacheWrite;
}
export async function loadPage(id: string): Promise<{ page: PageRecord; cachedAt?: string }> {
  const auth = await credentials();
  if (!auth) throw new Error("Pair your iPhone in Settings.");
  const key = cacheKey(auth, "pages");
  try {
    const result = await requestWith(auth, `/pages/${encodeURIComponent(id)}?feedback=1`);
    const page = Page.parse(result);
    // A full disk must not turn a successful fetch into a network failure.
    await updatePages(key, entries => savePage(entries, page)).catch(() => {});
    return { page };
  } catch (error) {
    if (error instanceof RelayError && error.status === 404)
      await updatePages(key, entries => entries.filter(entry => entry.page.id !== id)).catch(() => {});
    if (error instanceof RelayError && error.retryable) {
      const entries = readPages(await AsyncStorage.getItem(key).catch(() => null));
      const entry = entries.find(entry => entry.page.id === id);
      if (entry) return { page: entry.page, cachedAt: entry.savedAt };
    }
    throw error;
  }
}
export async function action(actionId: string, widgetId?: string) {
  return request("/action", "POST", {
    id: Crypto.randomUUID(),
    actionId,
    ...(widgetId ? { widgetId } : {}),
    source: "app",
    timestamp: new Date().toISOString(),
  });
}

export async function sendReportFeedback(id: string, pageId: string, pageUpdatedAt: string, text: string) {
  return request("/feedback", "POST", { id, pageId, pageUpdatedAt, text });
}

export async function loadPages(): Promise<PageRecord[]> {
  return PageList.parse(await request("/pages")).pages;
}
