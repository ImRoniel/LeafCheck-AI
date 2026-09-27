export type DeviceTarget = {
  kind: "space" | "plant";
  id: string;
  name: string;
};

export type PreselectedTarget = { type: "plant" | "space"; id: string };

/** Logical flow contract; Expo Router transports the target as two URL parameters. */
export type DeviceConnectionStackParamList = {
  DeviceScanner: { preselectedTarget?: PreselectedTarget };
  DeviceSelection: undefined;
  DeviceAssignment: { deviceId: string; preselectedTarget?: PreselectedTarget };
  DeviceSuccess: { deviceId: string; targetName: string };
};

export type DeviceConnectionRouteParams = {
  targetType?: string;
  targetId?: string;
  deviceId?: string;
  targetName?: string;
};

/** Local demo assignments are not physical links or evidence of live telemetry. */
export interface ConnectedDevice {
  id: string;
  name: string;
  assignedType: "plant" | "space";
  assignedId: string;
  targetName: string;
  source: "mock";
  connectedAt: string;
  telemetry: {
    soilMoisture?: number;
    temperature?: number;
    humidity?: number;
  };
}

/** A UI demonstration only; never feed this identifier into telemetry APIs. */
export interface MockDeviceConnection {
  source: "mock";
  deviceId: string;
  target: DeviceTarget;
  connectedAt: string;
}
