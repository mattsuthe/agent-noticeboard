import type { Env, Push } from "./types";
function b64(value: Uint8Array | string) {
  return btoa(typeof value === "string" ? value : String.fromCharCode(...value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
let cached: { identity: string; value: string; expires: number } | undefined;
export async function jwt(env: Env) {
  const identity = `${env.APNS_TEAM_ID}:${env.APNS_KEY_ID}:${env.APNS_KEY_P8}`;
  if (cached?.identity === identity && cached.expires > Date.now())
    return cached.value;
  const raw = env.APNS_KEY_P8.replace(/-----[^-]+-----/g, "").replace(
    /\s/g,
    "",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const message = `${b64(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }))}.${b64(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }))}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(message),
  );
  const value = `${message}.${b64(new Uint8Array(sig))}`;
  cached = { identity, value, expires: Date.now() + 45 * 60 * 1000 };
  return value;
}
export async function sendPush(env: Env, push: Push) {
  const host =
    env.APNS_ENVIRONMENT === "sandbox"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";
  return fetch(`https://${host}/3/device/${push.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await jwt(env)}`,
      "apns-push-type": push.type,
      "apns-topic": push.topic,
      "apns-priority":
        push.type === "background" || push.type === "widgets" ? "5" : "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
      ...(push.collapseId ? { "apns-collapse-id": push.collapseId } : {}),
    },
    body: JSON.stringify(push.body),
  });
}
