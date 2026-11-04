export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  APNS_KEY_P8: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  BUNDLE_ID: string;
  WIDGET_BUNDLE_ID: string;
  APNS_ENVIRONMENT: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
}
export interface Device {
  id: string;
  secret_hash: string;
  name: string;
  tokens: string;
}
export interface Job {
  id: string;
  kind: "apns" | "webhook";
  device_id: string | null;
  payload: string;
  attempts: number;
}
export interface Push {
  token: string;
  type: "alert" | "background" | "widgets" | "liveactivity";
  topic: string;
  body: Record<string, unknown>;
  collapseId?: string;
}
