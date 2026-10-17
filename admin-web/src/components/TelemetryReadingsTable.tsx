import { formatTimestamp } from '../lib/format'
import type { TelemetryReading } from '../lib/operations'
import { TableMessage } from './AdminTable'

const measurement = (value: number | null, unit = '') => value === null ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`

export function TelemetryReadingsTable({ readings, loading = false }: { readings: TelemetryReading[] | null; loading?: boolean }) {
  return <div className="overflow-x-auto rounded-xl border border-edge">
    <table className="w-full min-w-xl" aria-busy={loading}>
      <caption className="sr-only">Last five stored telemetry readings</caption>
      <thead className="border-b border-edge bg-panel-muted"><tr>{['Measured at', 'Temp °C', 'Humidity %', 'Soil ADC', 'Lux'].map(label => <th key={label} className="table-head" scope="col">{label}</th>)}</tr></thead>
      <tbody>{loading ? <TableMessage columns={5}>Loading stored readings...</TableMessage> : !readings?.length ? <TableMessage columns={5}>No stored readings available.</TableMessage> : readings.map(reading => <tr key={reading.id} className="table-row">
        <td className="table-cell whitespace-nowrap text-xs"><time dateTime={reading.timestamp}>{formatTimestamp(reading.timestamp)}</time>{reading.simulated && <span className="mt-1 block text-info-fg">Simulated</span>}</td>
        <td className="table-cell">{measurement(reading.temperatureCelsius, '°C')}</td>
        <td className="table-cell">{measurement(reading.humidityPercentage, '%')}</td>
        <td className="table-cell">{measurement(reading.soilMoistureRaw)}</td>
        <td className="table-cell">{measurement(reading.lightLux)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}
