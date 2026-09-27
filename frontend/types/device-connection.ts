export type DeviceTarget = {
  kind: "space" | "plant";
  id: string;
  name: string;
};

/** A UI demonstration only; never feed this identifier into telemetry APIs. */
export interface MockDeviceConnection {
  source: "mock";
  deviceId: string;
  target: DeviceTarget;
  connectedAt: string;
}
