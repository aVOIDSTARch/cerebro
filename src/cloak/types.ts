/** Cloak registration request — sent to POST /cloak/services/register. */
export interface RegistrationRequest {
  service_id: string;
  service_type: string;
  version: string;
  capabilities: string[];
}

/** Cloak registration response — session credentials + halt stream URL. */
export interface RegistrationResponse {
  session_id: string;
  signing_key: string; // base64-encoded
  halt_stream_url: string;
}

/** SSE event from the halt stream. */
export interface HaltEvent {
  type: "halt" | "key_rotation";
  service_id?: string;
  reason?: string;
  new_key?: string; // base64-encoded, for key_rotation
}

/** Decoded token claims — matches cloak-core TokenClaims. */
export interface TokenClaims {
  job_id: string;
  agent_class: string;
  issued_at: string; // ISO 8601
  expires_at: string; // ISO 8601
  services: ServiceScope[];
}

/** Per-service permission scope within a token. */
export interface ServiceScope {
  service: string;
  operation_class: "read" | "write" | "admin";
  resources: string[];
}

/** Runtime state for the Cloak connection. */
export interface CloakState {
  sessionId: string | null;
  signingKey: Buffer | null;
  halted: boolean;
  haltReason: string | null;
  registered: boolean;
  startTime: number;
}

/** Create a fresh CloakState. */
export function createCloakState(): CloakState {
  return {
    sessionId: null,
    signingKey: null,
    halted: false,
    haltReason: null,
    registered: false,
    startTime: Date.now(),
  };
}
