import type { ArchiveEntry, ScanResponse } from "@/types";
import { diagnosisBadgePresentation, diagnosisPresentation, hasNewerTelemetry, identificationConfidenceLabel, telemetryIsFresh } from "@/services/plant-profile-guidance";
import { Text, View } from "react-native";
import { DiagnosticReport } from "./DiagnosticReport";
import { Action, ui } from "./screen";

export function PlantDiagnosisCard({ latest, loading, error, identification, identificationReused = false, identificationMessage, hasSensor = false, canReuseImage = false, telemetryTimestamp, reevaluating = false, reevaluationError, onReevaluate, onRetry, onReload, onScan, onHistory }: {
  latest: ArchiveEntry | null; loading: boolean; error: boolean;
  hasSensor?: boolean;
  canReuseImage?: boolean; telemetryTimestamp?: string; reevaluating?: boolean;
  reevaluationError?: string | null; onReevaluate?: () => void;
  onRetry: () => void; onScan: () => void; onHistory: () => void;
  onReload?: () => void;
  identification?: ScanResponse["identification"];
  identificationReused?: boolean; identificationMessage?: string;
}) {
  const report = diagnosisPresentation(latest?.rawAnalysisText ?? "");
  const needsDiagnosis = Boolean(latest?.diagnosisError) || (!report.text && !error && !loading && canReuseImage);
  const snapshot = latest?.telemetrySnapshot;
  const readingSnapshot = snapshot && snapshot.source !== "none" ? snapshot : null;
  const canReevaluate = !needsDiagnosis && hasSensor && Boolean(latest) && telemetryIsFresh(telemetryTimestamp)
    && hasNewerTelemetry(telemetryTimestamp, readingSnapshot?.timestamp);
  const presentation = diagnosisBadgePresentation(snapshot);
  const badge = <Text style={{ alignSelf: "flex-start", backgroundColor: presentation.backgroundColor, color: presentation.color, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12 }}>
    {presentation.label}
  </Text>;
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>AI Diagnosis</Text>
    {!needsDiagnosis && badge}
    {needsDiagnosis ? <Text accessibilityLiveRegion="polite" style={ui.text}>Scan saved. AI diagnosis failed. Retry to generate the diagnosis.</Text> : latest ? <>
      <Text style={ui.text}>Latest scan · {new Date(latest.createdAt).toLocaleString()}</Text>
      {readingSnapshot && <Text style={ui.text}>Readings used · {new Date(readingSnapshot.timestamp).toLocaleString()}</Text>}
      {readingSnapshot?.simulated && <Text style={ui.text}>Simulated demo readings</Text>}
      {identification && <Text style={ui.text}>
        Confidence: {identificationConfidenceLabel(identification.confidence, identificationReused)}
        {identificationReused && <Text style={{ fontSize: 12, color: "#707770" }}> (reused from original scan)</Text>}
      </Text>}
      {identificationMessage && <Text style={ui.text}>{identificationMessage}</Text>}
      <DiagnosticReport key={latest.id} text={report.text || "No diagnostic text was saved."} readMoreLabel="Read Full Diagnosis" />
      {report.recommendations.length > 0 && <>
        <Text style={ui.text}>Recommended care</Text>
        {report.recommendations.slice(0, 3).map((item, index) => <Text key={`${index}:${item}`} numberOfLines={2} style={ui.text}>• {item}</Text>)}
      </>}
    </> : <Text style={ui.text}>{loading ? "Loading saved diagnosis…" : error ? "Saved diagnosis could not be loaded. Please retry loading it." : "No diagnosis yet. Scan a leaf to check for visible problems."}</Text>}
    {error && <>
      {report.text && <Text style={ui.text}>Could not refresh this saved diagnosis.</Text>}
      {onReload && <Action label="Reload saved diagnosis" variant="secondary" onPress={onReload} disabled={loading || reevaluating} />}
    </>}
    {needsDiagnosis && <View style={[ui.row, { flexWrap: "wrap", alignItems: "center" }]}>
      <Action label={reevaluating ? "Retrying..." : "Retry AI Diagnosis"} onPress={onRetry} disabled={reevaluating || !canReuseImage} />
      {badge}
    </View>}
    {reevaluationError && <Text accessibilityLiveRegion="polite" style={ui.text}>{reevaluationError}</Text>}
    <View style={[ui.row, { flexWrap: "wrap" }]}>
      <Action label="Scan Plant" onPress={onScan} disabled={reevaluating} />
      {!needsDiagnosis && (canReevaluate || reevaluating) && <Action label={reevaluating ? "Re-evaluating..." : "Re-evaluate with Sensor Data"} variant="secondary" onPress={onReevaluate} disabled={reevaluating || !onReevaluate || !canReuseImage} />}
    </View>
    {(canReevaluate || needsDiagnosis) && !canReuseImage && <Text style={ui.text}>No saved photo is available. Scan Plant to save a photo for re-evaluation.</Text>}
    <Action label="Scan history" variant="secondary" onPress={onHistory} />
  </View>;
}
