import { DashboardSensorStatusSheet } from "@/components/DashboardSensorStatusSheet";
import { Screen } from "@/components/screen";
import { SettingsSection } from "@/components/SettingsSection";
import { SettingsRow } from "@/components/SettingsRow";
import { useAuth } from "@/context/auth";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";

export default function Settings() {
  const auth = useAuth();
  const router = useRouter();
  const [sensorSheet, setSensorSheet] = useState(false);
  const authenticated = auth.status === "authenticated";
  return <>
    <Screen title="Settings" back backgroundColor="#F4F9F4">
      {authenticated && <SettingsSection title="SENSORS">
        <SettingsRow label="Connected sensors" icon="hardware-chip-outline" onPress={() => setSensorSheet(true)} />
        <SettingsRow label="Pair a new sensor" icon="add-circle-outline" onPress={() => router.push("/device-connection/scanner")} />
      </SettingsSection>}
      <SettingsSection title="LEGAL">
        <SettingsRow label="AI & sensor limitations" icon="document-text-outline" onPress={() => router.push("/terms")} />
      </SettingsSection>
      <SettingsSection title="ABOUT">
        <SettingsRow label="About LeafCheck AI" detail={`Version ${Constants.expoConfig?.version ?? "1.0.0"}`} icon="leaf-outline" />
      </SettingsSection>
      {authenticated && <SettingsSection title="Coming soon">
        <SettingsRow label="Notifications" icon="notifications-outline" muted />
        <SettingsRow label="Appearance" icon="color-palette-outline" muted />
        <SettingsRow label="Temperature units" icon="thermometer-outline" muted />
        <SettingsRow label="Help & Support" icon="help-circle-outline" muted />
        <SettingsRow label="Privacy policy" icon="shield-checkmark-outline" muted />
      </SettingsSection>}
    </Screen>
    {authenticated && sensorSheet && <DashboardSensorStatusSheet onClose={() => setSensorSheet(false)}
      onOpenPlant={id => { setSensorSheet(false); router.push({ pathname: "/plant-profile", params: { id } }); }}
      onManageDevices={() => { setSensorSheet(false); router.push("/device-connection/manage"); }} />}
  </>;
}
