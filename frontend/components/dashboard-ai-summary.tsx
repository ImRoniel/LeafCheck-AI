import { Action, Notice, ui } from "@/components/screen";
import { StyleSheet, Text, View } from "react-native";

type DashboardAiSummaryProps = {
  collectionStatus: { message: string; canRetry: boolean } | null;
  onRetry: () => void;
};

export function DashboardAiSummary({
  collectionStatus,
  onRetry,
}: DashboardAiSummaryProps) {
  return (
    <View style={[ui.card, styles.container]}>
      <Text accessibilityRole="header" style={styles.title}>
        AI Summary
      </Text>
      <Text style={ui.heading}>Coming soon</Text>
      <Text style={ui.text}>
        This is a placeholder. No AI-generated garden summary is available yet.
      </Text>
      {collectionStatus && (
        <>
          <Notice>{collectionStatus.message}</Notice>
          {collectionStatus.canRetry && (
            <Action label="Retry loading plants" onPress={onRetry} />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderColor: "#25B853" },
  title: { color: "#193E27", fontSize: 18, fontWeight: "700" },
});
