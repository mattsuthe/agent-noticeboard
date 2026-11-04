import { requireNativeModule } from "expo";
export interface Pairing {
  relay: string;
  deviceId: string;
  secret: string;
}
interface NativeAPI {
  configure(value: Pairing): Promise<void>;
  clear(): Promise<void>;
  saveState(json: string): Promise<void>;
  startObserving(): Promise<void>;
}
export const AgentNative = requireNativeModule<NativeAPI>("AgentNative");
