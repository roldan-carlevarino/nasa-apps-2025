import { useState } from "react";
import MapView from "./MapView";

export default function HistoricMap({ data }) {
  // Suponiendo que cada objeto en data tiene una propiedad 'fecha' (YYYY-MM-DD)
  const fechas = Array.from(new Set(data.map(d => d.fecha))).sort();
  const [selectedDate, setSelectedDate] = useState(fechas[0] || "");

  const filteredData = data.filter(d => d.fecha === selectedDate);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <label className="font-semibold text-blue-800">Selecciona fecha:</label>
        <select
          className="p-2 border rounded bg-blue-50 text-blue-900"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
        >
          {fechas.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      <MapView data={filteredData} />
    </div>
  );
}
