import React, { useState, useEffect } from 'react';

// Leyenda plegable (colapsada por defecto). Guarda preferencia en localStorage.
const PM25Legend = ({ visible = true, storageKey = 'legendCollapsed' }) => {
  const grades = [0, 12, 35, 55, 150, 250];
  const emojis = ['😊', '😐', '😷', '😰', '🤧', '☠️'];
  const [collapsed, setCollapsed] = useState(true);

  // Restaurar preferencia
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === '0') setCollapsed(false);
    } catch(_) {}
  }, [storageKey]);

  const toggle = () => {
    setCollapsed(c => {
      const next = !c;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch(_) {}
      return next;
    });
  };

  if (!visible) return null;

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border-2 border-black/10 overflow-hidden w-[215px]">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-800 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
        aria-expanded={!collapsed}
        aria-controls="pm25-legend-body"
      >
        <span className="flex items-center gap-1">🌬️ PM2.5 Legend</span>
        <span className="text-[10px]">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div id="pm25-legend-body" className="p-3 pt-2 animate-fade-in">
          {grades.map((grade, i) => (
            <div key={i} className="flex items-center mb-1">
              <div
                className="w-4 h-4 rounded-full mr-2 shadow-sm border border-blue-700 bg-blue-500"
                title={`Range ${grade}${grades[i + 1] ? '–'+grades[i+1] : '+'}`}
              ></div>
              <span className="text-[11px] text-gray-700">
                {emojis[i]} {grade}{grades[i + 1] ? `–${grades[i + 1]}` : '+'} μg/m³
              </span>
            </div>
          ))}
          <div className="text-[10px] text-gray-500 mt-2 italic border-t pt-2 leading-tight">
            💨 Intensidad = concentración<br/>
            🎯 Dirección = tendencia temporal
          </div>
        </div>
      )}
    </div>
  );
};

export default PM25Legend;