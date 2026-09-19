import { useTelemetryHistory } from '@/hooks/use-telemetry-history';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Action, Notice, ui } from './screen';
export const measurement = (value: number | null | undefined, unit: string) => value == null ? 'Not measured' : `${value} ${unit}`;
export function TelemetryHistory({ deviceId }: { deviceId: string }) {
  const [offset, setOffset] = useState(0); const limit = 10;
  const { readings, pagination, loading, error, refreshData } = useTelemetryHistory(deviceId, { limit, offset });
  return <View style={{ gap: 12 }}><Text style={ui.heading}>Reading history</Text><Text style={ui.text}>Device {deviceId} · unverified local mapping</Text>{loading && <Notice>Loading readings…</Notice>}{error && <Notice>{error.message} Existing readings may be stale.</Notice>}<Action label="Refresh history" onPress={() => { void refreshData().catch(() => {}); }} disabled={loading} />{!loading && !error && !readings.length && <Notice>No readings on this page.</Notice>}{readings.map(reading => <View key={reading.id} style={ui.card}><Text style={ui.heading}>{new Date(reading.timestamp).toLocaleString()}</Text><Text style={ui.text}>Temperature: {measurement(reading.temperature, '°C')}{'\n'}Humidity: {measurement(reading.humidity, '%')}{'\n'}Soil moisture: {measurement(reading.soilMoisture, '%')}{'\n'}Light: {measurement(reading.lightLevel, 'lux')}{'\n'}Soil raw ADC: {measurement(reading.soilMoistureRaw, 'ADC')}</Text></View>)}{pagination && <Text style={ui.text}>{pagination.total} recorded readings · page {Math.floor(offset / limit) + 1}</Text>}<View style={ui.row}><Action label="Previous" disabled={!offset || loading} onPress={() => setOffset(n => Math.max(0, n - limit))} /><Action label="Next" disabled={!pagination?.hasMore || loading} onPress={() => setOffset(n => n + limit)} /></View></View>;
}
