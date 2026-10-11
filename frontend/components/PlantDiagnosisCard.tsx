import type { ArchiveEntry } from "@/types";
import { diagnosisPresentation } from "@/services/plant-profile-guidance";
import { Text, View } from "react-native";
import { DiagnosticReport } from "./DiagnosticReport";
import { Action, ui } from "./screen";

export function PlantDiagnosisCard({ latest, loading, error, onRetry, onScan, onHistory }: {
  latest: ArchiveEntry | null; loading: boolean; error: boolean;
  onRetry: () => void; onScan: () => void; onHistory: () => void;
}) {
  const report = diagnosisPresentation(latest?.rawAnalysisText ?? "");
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>AI Diagnosis</Text>
    {latest ? <>
      <Text style={ui.text}>Latest scan · {new Date(latest.createdAt).toLocaleDateString()}</Text>
      <DiagnosticReport key={latest.id} text={report.text || "No diagnostic text was saved."} readMoreLabel="Read Full Diagnosis" />
      {report.recommendations.length > 0 && <>
        <Text style={ui.text}>Recommended care</Text>
        {report.recommendations.slice(0, 3).map((item, index) => <Text key={`${index}:${item}`} numberOfLines={2} style={ui.text}>• {item}</Text>)}
      </>}
    </> : <Text style={ui.text}>{loading ? "Loading saved diagnosis…" : error ? "Saved diagnosis is unavailable." : "No diagnosis yet. Scan a leaf to check for visible problems."}</Text>}
    {error && <><Text style={ui.text}>{latest ? "Could not refresh this saved diagnosis." : "Try loading your saved diagnosis again."}</Text><Action label="Retry saved guidance" variant="secondary" onPress={onRetry} /></>}
    <Action label="Scan Plant" onPress={onScan} />
    <Action label="Scan history" variant="secondary" onPress={onHistory} />
  </View>;
}
