import type {
  CloakState,
  HaltEvent,
  RegistrationRequest,
  RegistrationResponse,
} from "./types.js";

const DEFAULT_SSE_MAX_ATTEMPTS = 10;
const DEFAULT_SSE_BASE_DELAY_MS = 2000;
const DEFAULT_SSE_MAX_DELAY_MS = 60000;

export interface CloakClientConfig {
  cloakUrl: string;
  manifestToken: string;
  serviceId: string;
  serviceType: string;
  version: string;
  capabilities: string[];
  sseMaxAttempts?: number;
  sseBaseDelayMs?: number;
  sseMaxDelayMs?: number;
}

/**
 * Register this service with Cloak.
 *
 * Populates the state with session_id and signing_key.
 * Returns the halt_stream_url for SSE listening.
 */
export async function registerWithCloak(
  config: CloakClientConfig,
  state: CloakState,
): Promise<string> {
  const payload: RegistrationRequest = {
    service_id: config.serviceId,
    service_type: config.serviceType,
    version: config.version,
    capabilities: config.capabilities,
  };

  const url = `${config.cloakUrl}/cloak/services/register`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.manifestToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Cloak registration rejected (HTTP ${resp.status}): ${body}`,
    );
  }

  const data: RegistrationResponse = await resp.json();
  state.sessionId = data.session_id;
  state.signingKey = Buffer.from(data.signing_key, "base64");
  state.registered = true;

  console.log(`[cloak] Registered with Cloak (session=${data.session_id})`);
  return data.halt_stream_url;
}

/**
 * Persistent SSE listener for halt and key_rotation signals.
 *
 * Reconnects with exponential backoff. After max consecutive failures,
 * self-halts (fail closed) — matches Episteme Python behavior.
 */
export async function listenHaltStream(
  config: CloakClientConfig,
  state: CloakState,
  haltStreamUrl: string,
): Promise<void> {
  if (!haltStreamUrl) return;

  const maxAttempts = config.sseMaxAttempts ?? DEFAULT_SSE_MAX_ATTEMPTS;
  const baseDelay = config.sseBaseDelayMs ?? DEFAULT_SSE_BASE_DELAY_MS;
  const maxDelay = config.sseMaxDelayMs ?? DEFAULT_SSE_MAX_DELAY_MS;

  let consecutiveFailures = 0;
  let delay = baseDelay;

  while (true) {
    try {
      const resp = await fetch(haltStreamUrl, {
        headers: { Authorization: `Bearer ${config.manifestToken}` },
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`SSE connect failed (HTTP ${resp.status})`);
      }

      consecutiveFailures = 0;
      delay = baseDelay;
      console.log("[cloak] SSE halt channel connected");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data: ")) {
            handleSseEvent(state, trimmed.slice(6));
          }
        }
      }
    } catch (err) {
      consecutiveFailures++;
      console.warn(
        `[cloak] SSE connection lost (attempt ${consecutiveFailures}/${maxAttempts}): ${err}`,
      );

      if (consecutiveFailures >= maxAttempts) {
        state.halted = true;
        state.haltReason = "sse_channel_lost";
        console.error(
          "[cloak] SSE reconnect limit reached — self-halting (fail closed)",
        );
        return;
      }

      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}

function handleSseEvent(state: CloakState, raw: string): void {
  let event: HaltEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    console.warn(`[cloak] Failed to parse SSE event: ${raw}`);
    return;
  }

  if (event.type === "halt") {
    state.halted = true;
    state.haltReason = event.reason ?? "operator";
    console.warn(`[cloak] HALT received: ${state.haltReason}`);
  } else if (event.type === "key_rotation") {
    if (event.new_key) {
      state.signingKey = Buffer.from(event.new_key, "base64");
      console.log("[cloak] Signing key rotated");
    } else {
      console.warn("[cloak] key_rotation event missing new_key");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
