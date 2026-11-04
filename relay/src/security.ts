const encoder = new TextEncoder();
export async function hash(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
export function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function secret() {
  return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
export async function equal(a: string, b: string) {
  return (await hash(a)) === (await hash(b));
}
export async function signature(key: string, timestamp: string, body: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", k, encoder.encode(`${timestamp}.${body}`)),
  );
}
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch))
    return patch;
  const result: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...target }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(k))
      throw new Error("Unsafe patch key");
    if (v === null) delete result[k];
    else result[k] = mergePatch(result[k], v);
  }
  return result;
}
