export class RelayError extends Error {
  constructor(message: string, public status = 0) { super(message); }
  get retryable() { return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500; }
}

// Keep the deadline active through body decoding. Never automatically replay writes.
export async function fetchJSON(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let result;
    try { result = await response.json(); }
    catch {
      if (controller.signal.aborted) throw new RelayError("Relay timed out. Try again when your connection returns.");
      throw new RelayError(`Relay returned an unreadable response (${response.status}).`, response.ok ? 502 : response.status);
    }
    if (!response.ok) throw new RelayError(
      response.status === 401 ? "Pair your iPhone again in Settings." :
      response.status === 429 ? "Relay is busy. Wait a minute and try again." :
      typeof result?.error === "string" ? result.error : `Relay returned ${response.status}`,
      response.status,
    );
    return result;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError(controller.signal.aborted
      ? "Relay timed out. Try again when your connection returns."
      : "Could not reach the relay. Check your connection and try again.");
  } finally { clearTimeout(timer); }
}
