import type { ArchiveEntry } from "@/types";
import { diagnosisPresentation, hasNewerTelemetry } from "@/services/plant-profile-guidance";
import { Text, View } from "react-native";
import { DiagnosticReport } from "./DiagnosticReport";
import { Action, ui } from "./screen";

export function PlantDiagnosisCard({ latest, loading, error, hasSensor = false, canReuseImage = false, telemetryTimestamp, reevaluating = false, reevaluationError, onReevaluate, onRetry, onScan, onHistory }: {
  latest: ArchiveEntry | null; loading: boolean; error: boolean;
  hasSensor?: boolean;
  canReuseImage?: boolean; telemetryTimestamp?: string; reevaluating?: boolean;
  reevaluationError?: string | null; onReevaluate?: () => void;
  onRetry: () => void; onScan: () => void; onHistory: () => void;
}) {
  const report = diagnosisPresentation(latest?.rawAnalysisText ?? "");
  const canReevaluate = hasSensor && Boolean(latest) && hasNewerTelemetry(telemetryTimestamp, latest?.createdAt);
  // Temporary diagnostics for the missing re-evaluation button.
  console.log("[Plant diagnosis re-evaluation]", { hasSensor, canReuseImage, telemetryTimestamp, "latest.createdAt": latest?.createdAt, canReevaluate });
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>AI Diagnosis</Text>
    <Text style={{ alignSelf: "flex-start", backgroundColor: "#E8F5E9", color: "#278448", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12 }}>
      {hasSensor ? "Sensor-Enhanced AI" : "Image-Only AI"}
    </Text>
    {latest ? <>
      <Text style={ui.text}>Latest scan · {new Date(latest.createdAt).toLocaleString()}</Text>
      <DiagnosticReport key={latest.id} text={report.text || "No diagnostic text was saved."} readMoreLabel="Read Full Diagnosis" />
      {report.recommendations.length > 0 && <>
        <Text style={ui.text}>Recommended care</Text>
        {report.recommendations.slice(0, 3).map((item, index) => <Text key={`${index}:${item}`} numberOfLines={2} style={ui.text}>• {item}</Text>)}
      </>}
    </> : <Text style={ui.text}>{loading ? "Loading saved diagnosis…" : error ? "Saved diagnosis is unavailable." : "No diagnosis yet. Scan a leaf to check for visible problems."}</Text>}
    {error && <><Text style={ui.text}>{latest ? "Could not refresh this saved diagnosis." : "Try loading your saved diagnosis again."}</Text><Action label="Retry saved guidance" variant="secondary" onPress={onRetry} /></>}
    {reevaluationError && <Text accessibilityLiveRegion="polite" style={ui.text}>{reevaluationError}</Text>}
    <View style={[ui.row, { flexWrap: "wrap" }]}>
      <Action label="Scan Plant" onPress={onScan} disabled={reevaluating} />
      {(canReevaluate || reevaluating) && <Action label={reevaluating ? "Re-evaluating..." : "Re-evaluate with Sensor Data"} variant="secondary" onPress={onReevaluate} disabled={reevaluating || !onReevaluate || !canReuseImage} />}
    </View>
    {canReevaluate && !canReuseImage && <Text style={ui.text}>No saved photo is available. Scan Plant to save a photo for re-evaluation.</Text>}
    <Action label="Scan history" variant="secondary" onPress={onHistory} />
  </View>;
}
