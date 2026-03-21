import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import * as topojson from 'topojson-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import PM25VectorLayer from './PM25VectorLayer';
import PM25Legend from './PM25Legend';

// Custom icon styling
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// PM2.5 Color function
function getPM25Color(pm25) {
  if (pm25 <= 12) return '#1e88e5';    // Blue - Good
  if (pm25 <= 35) return '#ffff00';    // Yellow - Moderate  
  if (pm25 <= 55) return '#ff7e00';    // Orange - Unhealthy for Sensitive Groups
  if (pm25 <= 150) return '#ff0000';   // Red - Unhealthy
  if (pm25 <= 250) return '#8f3f97';   // Purple - Very Unhealthy
  return '#7e0023';                    // Maroon - Hazardous
}

const MapView = ({ data: externalData, selectedRegion, focusMunicipio, onMunicipioSelect, onMunicipiosList, opacity = 0.9, fullScreen = false }) => {
  const [pm25Data, setPm25Data] = useState(null); // array de estaciones
  const [showVectors, setShowVectors] = useState(true);
  const [zoom, setZoom] = useState(6);
  const [lastError, setLastError] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(fullScreen);
  const [selectedHour, setSelectedHour] = useState(0);
  const [maxHours, setMaxHours] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);
  const [flowMode, setFlowMode] = useState(false); // ahora se forza a partir de las visualizaciones
  const [showFlowArrows, setShowFlowArrows] = useState(true); // nuevo toggle para flechas
  const [flowArrowDensity, setFlowArrowDensity] = useState('med'); // 'low' | 'med' | 'high'
  const [showMunicipios, setShowMunicipios] = useState(true);
  const [focusedMunicipio, setFocusedMunicipio] = useState(null);
  const [municipiosData, setMunicipiosData] = useState(null);
  const municipiosUpgradeTriedRef = useRef(false);
  const containerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const municipioLayersRef = useRef({}); // nombre -> layer para abrir popup programáticamente
  const municipioNearestStationRef = useRef({}); // nombre normalizado -> nearest station object (cached)
  const municipioPmValuesRef = useRef(null); // ref copy of municipioPmValues for stable style callback
  const [predictionsMap, setPredictionsMap] = useState(null); // nombre normalizado -> objeto predicción
  const [municipioPmValues, setMunicipioPmValues] = useState(null); // nombre normalizado -> pm25 actual
  // Removed manual reload button; auto-load & upgrade logic makes manual reload unnecessary
  const [controlsOpen, setControlsOpen] = useState(false); // inicial cerrado
  const [debugOpen, setDebugOpen] = useState(false); // inicial cerrado

  // Utilidad: limpiar y validar estaciones
  const sanitizeStations = useCallback((stations) => {
    if (!Array.isArray(stations)) return { cleaned: [], report: { total:0, removed:0 } };
    const report = {
      total: stations.length,
      removed: 0,
      coord_out_of_bounds: 0,
      coord_swapped: 0,
      duplicates: 0,
      no_series: 0,
      pm25_negatives: 0,
      pm25_nan: 0,
      truncated_hours: 0
    };
    const seenKeys = new Set();
    const cleaned = [];
    for (const st of stations) {
      const c = st.coords || (st.lat!=null && st.lon!=null ? { lat: st.lat, lon: st.lon } : null);
      if (!c || !isFinite(c.lat) || !isFinite(c.lon)) { report.coord_out_of_bounds++; report.removed++; continue; }
      let lat = c.lat, lon = c.lon;
      // Detectar swap improbable (lon en rango lat y lat en rango lon)
      if ((lat < -25 || lat > 65) && (lon >= 27 && lon <= 44)) {
        // swap
        const tmp = lat; lat = lon; lon = tmp; report.coord_swapped++; 
      }
      const inSpain = (lat >= 27 && lat <= 44 && lon >= -18.8 && lon <= 5.5);
      if (!inSpain) { report.coord_out_of_bounds++; report.removed++; continue; }
      const key = st.key || `${lat.toFixed(4)}|${lon.toFixed(4)}`;
      if (seenKeys.has(key)) { report.duplicates++; report.removed++; continue; }
      seenKeys.add(key);
      const series = st.open_meteo?.hourly?.pm2_5;
      if (!Array.isArray(series) || !series.length) { report.no_series++; /* allow simple pm25 fallback */ }
      let validSeries = series;
      if (Array.isArray(series)) {
        // Sanitizar valores
        validSeries = series.map(v => {
          if (v == null || Number.isNaN(v)) { report.pm25_nan++; return null; }
          if (v < 0) { report.pm25_negatives++; return 0; }
          if (v > 500) return 500; // cap extremo
          return v;
        });
        // Truncar si tiene longitud anómala (> 200 horas por ejemplo)
        if (validSeries.length > 192) { validSeries = validSeries.slice(0,192); report.truncated_hours++; }
      }
      cleaned.push({ ...st, coords: { lat, lon, alt: c.alt ?? null }, open_meteo: st.open_meteo ? { ...st.open_meteo, hourly: { ...(st.open_meteo.hourly||{}), pm2_5: validSeries } } : st.open_meteo });
    }
    return { cleaned, report };
  }, []);

  // Intentar actualizar a dataset completo si inicialmente solo había fallback pequeño
  useEffect(() => {
    if (!municipiosData) return;
    const count = municipiosData.features?.length || 0;
    // Heurística: un full España debería tener > 5000 features (≈8000)
    if (count > 5000 || municipiosUpgradeTriedRef.current) return;
    // Programar un re-intento único tras 4s para ver si apareció municipalities.geojson
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`${process.env.PUBLIC_URL}/data/municipalities.geojson`, { cache: 'no-store' });
        if (!resp.ok) return;
        const full = await resp.json();
        if (full?.type === 'FeatureCollection' && Array.isArray(full.features) && full.features.length > count) {
          console.log('[MapView] Upgrade municipios: cargado dataset completo con', full.features.length, 'features');
          setMunicipiosData(full);
        }
      } catch (_) { /* ignorar */ }
      finally { municipiosUpgradeTriedRef.current = true; }
    }, 4000);
    return () => clearTimeout(t);
  }, [municipiosData]);

  // Guardar instancia de mapa cuando esté lista
  const handleMapReady = useCallback((mapEvt) => {
    const mapInstance = mapEvt.target;
    leafletMapRef.current = mapInstance;
    mapInstance.on('zoomend', handleZoomEnd);
  }, []);

  // Key bindings (F para toggle, ESC para salir)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullScreen();
      } else if (e.key === 'Escape' && isFullScreen) {
        exitFullScreenNative();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreen]);

  // Bloquear scroll de fondo en fullscreen
  useEffect(() => {
    if (isFullScreen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
  }, [isFullScreen]);

  // Sincronizar con Fullscreen API si el usuario sale con ESC / UI del navegador
  useEffect(() => {
    const handler = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl && isFullScreen) {
        // Se salió del modo nativo externamente
        setIsFullScreen(false);
        requestAnimationFrame(() => {
          if (leafletMapRef.current) leafletMapRef.current.invalidateSize();
        });
      }
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, [isFullScreen]);

  const requestFullScreenNative = () => {
    const el = containerRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  };

  const exitFullScreenNative = () => {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    setIsFullScreen(false);
    setTimeout(() => {
      if (leafletMapRef.current) leafletMapRef.current.invalidateSize();
    }, 60);
  };

  const toggleFullScreen = () => {
    setIsFullScreen(prev => {
      const next = !prev;
      if (next) {
        // Entrando
        requestFullScreenNative();
        setTimeout(() => {
          if (leafletMapRef.current) leafletMapRef.current.invalidateSize();
        }, 80);
      } else {
        exitFullScreenNative();
      }
      return next;
    });
  };

  // Cargar GeoJSON de municipios: primero intenta full `municipalities.geojson` luego fallback `municipios.geojson`
  useEffect(() => {
    let cancelled = false;
    const loadMunicipios = async () => {
      try {
        const tryUrls = [
          `${process.env.PUBLIC_URL}/data/municipalities.geojson`,
          `${process.env.PUBLIC_URL}/data/municipalities.json`,
          `${process.env.PUBLIC_URL}/data/municipios-simplified.geojson`,
          `${process.env.PUBLIC_URL}/data/municipios.geojson`
        ];
        let loaded = null; let firstErr = null;
        for (const u of tryUrls) {
          try {
            const r = await fetch(u, { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP '+r.status);
            const text = await r.text();
            if (!text.trim()) { console.warn('[MapView] Archivo vacío', u); continue; }
            let gjParsed;
            try { gjParsed = JSON.parse(text); } catch(parseErr) { console.warn('[MapView] JSON inválido en', u); continue; }
            // Si es Topology convertir el objeto 'municipalities' (u otro primero disponible)
            if (gjParsed && gjParsed.type === 'Topology') {
              const objName = gjParsed.objects.municipalities ? 'municipalities' : Object.keys(gjParsed.objects||{})[0];
              if (objName) {
                try {
                  const fc = topojson.feature(gjParsed, gjParsed.objects[objName]);
                  if (fc && fc.type === 'FeatureCollection' && Array.isArray(fc.features) && fc.features.length) {
                    loaded = fc;
                    console.log('[MapView] Municipios (TopoJSON) cargados desde', u, 'features:', fc.features.length);
                    break;
                  }
                } catch (convErr) {
                  console.warn('[MapView] Error convirtiendo Topology', convErr);
                }
              }
            } else if (gjParsed && gjParsed.type === 'FeatureCollection' && Array.isArray(gjParsed.features) && gjParsed.features.length) {
              loaded = gjParsed;
              console.log('[MapView] Municipios cargados desde', u, 'features:', gjParsed.features.length);
              break;
            } else {
              console.warn('[MapView] Formato no utilizable en', u);
            }
          } catch (e) {
            if (!firstErr) firstErr = e;
          }
        }
        if (!loaded && firstErr) throw firstErr;
        if (!cancelled && loaded) {
          setMunicipiosData(loaded);
          try {
            if (onMunicipiosList && loaded.features) {
              const names = Array.from(new Set(loaded.features.map(f => f.properties?.name).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'es'));
              onMunicipiosList(names);
            }
          } catch(eList) { console.warn('[MapView] No se pudo derivar lista de municipios', eList); }
        }
      } catch (e) {
        console.warn('[MapView] No se pudo cargar ningún GeoJSON de municipios', e);
      }
    };
    loadMunicipios();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit bounds cuando llegan municipios (solo primera vez)
  useEffect(() => {
    if (municipiosData && leafletMapRef.current) {
      try {
        const boundsLayer = L.geoJSON(municipiosData);
        const b = boundsLayer.getBounds();
        if (b.isValid()) {
          leafletMapRef.current.fitBounds(b, { padding: [20, 20] });
        }
      } catch (e) {
        console.warn('No se pudo calcular bounds municipios', e);
      }
    }
  }, [municipiosData]);

  // Utilidad: normalizar nombre (sin tildes, minúsculas) para matching robusto
  const normalizeName = useCallback((n) => (n||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim(), []);

  // Stable style callback — ref never changes so react-leaflet won't reset colors on every zoom re-render
  const municipioStyleFn = useCallback((feature) => {
    const nombre = feature.properties?.name || feature.properties?.shape3 || '';
    const norm = normalizeName(nombre);
    const pm = municipioPmValuesRef.current?.[norm];
    const baseColor = pm == null ? '#c8d1d9' : getPM25Color(pm);
    return {
      color: pm == null ? '#7a8691' : '#1f2933',
      weight: 0.8,
      fillColor: baseColor,
      fillOpacity: 0.22,
      className: 'municipio-boundary'
    };
  }, [normalizeName]);

  // Cargar predicciones desde archivo externo (usuario debe colocar /data/aq_Madrid_with_predictions.json)
  useEffect(() => {
    let cancelled = false;
    const loadPreds = async () => {
      const url = `${process.env.PUBLIC_URL}/data/aq_Madrid_with_predictions.json`;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return;
        const json = await r.json();
        if (cancelled) return;
        // Aceptar formatos: array de objetos o objeto con propiedad data
        const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        const map = {};
        arr.forEach(entry => {
          // Heurísticas de nombre
          const rawName = entry.municipio || entry.name || entry.city || entry.town;
          if (!rawName) return;
            map[normalizeName(rawName)] = entry;
        });
        if (Object.keys(map).length) setPredictionsMap(map);
      } catch(e) {
        console.warn('[Predictions] No se pudo cargar predicciones', e);
      }
    };
    loadPreds();
    return () => { cancelled = true; };
  }, [normalizeName]);

  // Obtener estación representativa para municipio (nearest station to centroid) y valor actual/siguiente
  const getMunicipioCurrentPm25 = useCallback((feature) => {
    if (!feature || !pm25Data || !pm25Data.length) return { current: null, next: null };
    try {
      const layerTmp = L.geoJSON(feature);
      const b = layerTmp.getBounds();
      if (!b.isValid()) return { current: null, next: null };
      const centroid = b.getCenter();
      let best = null; let bestDist2 = Infinity;
      for (const st of pm25Data) {
        const c = st.coords; if (!c) continue;
        const dLat = c.lat - centroid.lat;
        const dLon = c.lon - centroid.lng;
        const dist2 = dLat*dLat + dLon*dLon;
        if (dist2 < bestDist2) { bestDist2 = dist2; best = st; }
      }
      if (!best) return { current: null, next: null };
      const series = best.open_meteo?.hourly?.pm2_5;
      if (Array.isArray(series) && series.length) {
        const cur = series[Math.min(selectedHour, series.length-1)];
        const next = series[Math.min(selectedHour+1, series.length-1)];
        return { current: cur, next };
      }
      if (typeof best.pm25 === 'number') return { current: best.pm25, next: best.pm25 };
      return { current: null, next: null };
    } catch(e) { return { current: null, next: null }; }
  }, [pm25Data, selectedHour]);

  // Construir HTML popup dinámico
  const buildPopupHtml = useCallback((nombre, prov, feature) => {
    const norm = normalizeName(nombre);
    const pred = predictionsMap ? predictionsMap[norm] : null;
    const { current, next } = getMunicipioCurrentPm25(feature);
    // Use cached nearest-station lookup instead of recomputing per popup
    const nearestStation = municipioNearestStationRef.current[norm] || null;
    let stationSeries = nearestStation?.open_meteo?.hourly?.pm2_5 || null;
    let avg24 = null, max24 = null;
    if (Array.isArray(stationSeries) && stationSeries.length) {
      const slice = stationSeries.slice(0, 24).filter(v=>v!=null);
      if (slice.length) {
        const sum = slice.reduce((a,b)=>a+b,0);
        avg24 = sum / slice.length;
        max24 = slice.reduce((m,v)=>v>m?v:m, -Infinity);
      }
    }
    // Use ML model prediction when available, otherwise fall back to PM2.5 heuristic
    const basis = max24 ?? current;
    let riskPct = null; let riskLabel = null; let riskColor = '#999';
    const calimaPred = nearestStation?.calima_prediction || null;
    if (calimaPred) {
      riskPct = Math.round(calimaPred.probability * 100);
      riskLabel = calimaPred.calima ? 'Calima' : 'Clear';
      riskColor = calimaPred.calima ? '#e53935' : '#1e88e5';
    } else if (basis != null) {
      // Fallback: map PM2.5 to pseudo calima risk %
      if (basis <= 12) { riskPct = 5; riskLabel = 'Low'; riskColor = '#1e88e5'; }
      else if (basis <= 35) { riskPct = 20 + (basis-12)/(35-12)*10; riskLabel = 'Moderate'; riskColor = '#f1c40f'; }
      else if (basis <= 55) { riskPct = 30 + (basis-35)/(55-35)*25; riskLabel = 'Elevated'; riskColor = '#ff9800'; }
      else if (basis <= 150) { riskPct = 55 + (basis-55)/(150-55)*30; riskLabel = 'High'; riskColor = '#e53935'; }
      else { riskPct = 90; riskLabel = 'Extreme'; riskColor = '#7e0023'; }
      riskPct = Math.min(100, Math.max(0, Math.round(riskPct)));
    }
    // HTML escape helper — prevents XSS from untrusted field values
    const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    // Predicciones multi-horizonte
    let predLine = '';
    const cityRaw = pred?.city || pred?.municipio || pred?.name || pred?.town;
    const showCity = cityRaw && cityRaw.toLowerCase().trim() !== nombre.toLowerCase().trim();
    if (pred) {
      const p1h = pred.pm25_1h || pred.pred_1h || (pred.forecast?.[1]) || null;
      const p3h = pred.pm25_3h || pred.pred_3h || (pred.forecast?.[3]) || null;
      const p24h = pred.pm25_24h || pred.pred_24h || (pred.forecast?.[24]) || null;
      const parts = [];
      if (p1h != null) parts.push(`<span><strong>+1h:</strong> ${esc(p1h.toFixed ? p1h.toFixed(1) : p1h)}</span>`);
      if (p3h != null) parts.push(`<span><strong>+3h:</strong> ${esc(p3h.toFixed ? p3h.toFixed(1) : p3h)}</span>`);
      if (p24h != null) parts.push(`<span><strong>+24h:</strong> ${esc(p24h.toFixed ? p24h.toFixed(1) : p24h)}</span>`);
      predLine = parts.length ? `<div style="margin-top:4px;font-size:11px;display:flex;flex-direction:column;gap:2px;">${parts.join('<br/>')}</div>` : '';
    }
    const trend = (current != null && next != null) ? (next > current ? '↑' : next < current ? '↓' : '→') : '';
    return `
      <div style="font-family:Inter,Arial,sans-serif;">
        <strong style="font-size:13px;">${esc(nombre)}</strong>${prov?'<br/><span style="font-size:11px;color:#555">'+esc(prov)+'</span>':''}
        ${showCity?'<div style="font-size:11px;color:#333;margin-top:2px;">City: <span style="font-weight:600;">'+esc(cityRaw)+'</span></div>':''}
        <div style="margin-top:4px;font-size:12px;">
          <span style="color:#444;">PM2.5:</span>
          ${current!=null ? `<strong>${current.toFixed ? current.toFixed(1) : current}</strong> μg/m³ ${trend}` : '<em>n/d</em>'}
        </div>
        ${(avg24!=null||max24!=null)?`<div style="margin-top:2px;font-size:11px;color:#555;">${avg24!=null?`24h avg: <strong>${avg24.toFixed(1)}</strong>`:''}${avg24!=null&&max24!=null?' · ':''}${max24!=null?`24h max: <strong>${max24.toFixed(1)}</strong>`:''}</div>`:''}
        ${riskPct!=null?`<div style="margin-top:4px;font-size:11px;"><span style="color:#444;">Calima risk:</span> <strong style="color:${riskColor}">${riskPct}%</strong> <span style="color:${riskColor}">(${esc(riskLabel)})</span>${calimaPred?'<span style="color:#888;font-size:10px;"> · ML</span>':''}</div>`:''}
        ${predLine}
        ${pred && pred.model ? `<div style="margin-top:4px;font-size:10px;color:#666;">Model: ${esc(pred.model)}</div>`:''}
      </div>`;
  }, [predictionsMap, getMunicipioCurrentPm25, normalizeName]);

  // Precalcular nearest station por municipio (una sola vez cuando cambian municipios o estaciones)
  useEffect(() => {
    if (!municipiosData || !pm25Data || !pm25Data.length) { municipioNearestStationRef.current = {}; return; }
    const cache = {};
    try {
      for (const f of municipiosData.features) {
        const nombre = f.properties?.name || f.properties?.shape3; if (!nombre) continue;
        const norm = normalizeName(nombre);
        try {
          const layerTmp = L.geoJSON(f);
          const b = layerTmp.getBounds();
          if (!b.isValid()) continue;
          const centroid = b.getCenter();
          let best = null; let bestDist2 = Infinity;
          for (const st of pm25Data) {
            const c = st.coords; if (!c) continue;
            const dLat = c.lat - centroid.lat;
            const dLon = c.lon - centroid.lng;
            const d2 = dLat*dLat + dLon*dLon;
            if (d2 < bestDist2) { bestDist2 = d2; best = st; }
          }
          if (best) cache[norm] = best;
        } catch(_) {}
      }
    } catch(e) { console.warn('[NearestStation] error', e); }
    municipioNearestStationRef.current = cache;
  }, [municipiosData, pm25Data, normalizeName]);

  // Precalcular valor PM2.5 representativo por municipio (para colorear polígonos)
  useEffect(() => {
    if (!municipiosData || !pm25Data || !pm25Data.length) { setMunicipioPmValues(null); return; }
    const mapping = {};
    const cache = municipioNearestStationRef.current;
    try {
      for (const f of municipiosData.features) {
        const nombre = f.properties?.name || f.properties?.shape3; if (!nombre) continue;
        const norm = normalizeName(nombre);
        const st = cache[norm];
        if (!st) continue;
        const series = st.open_meteo?.hourly?.pm2_5;
        let current = null;
        if (Array.isArray(series) && series.length) {
          current = series[Math.min(selectedHour, series.length - 1)];
        } else if (typeof st.pm25 === 'number') {
          current = st.pm25;
        }
        if (current != null && isFinite(current)) mapping[norm] = current;
      }
    } catch(e) { console.warn('[MunicipioColor] error computing municipio PM2.5', e); }
    setMunicipioPmValues(mapping);
    municipioPmValuesRef.current = mapping;
  }, [municipiosData, pm25Data, selectedHour, normalizeName]);

  // Popups are lazy (built on popupopen), so no bulk refresh needed here.
  // When selectedHour or predictionsMap changes, open popups will refresh on next open.

  // Usar datos externos si se proporcionan (re-sanitizar en cambios)
  useEffect(() => {
    if (Array.isArray(externalData)) {
      const { cleaned, report } = sanitizeStations(externalData);
      console.log('[Sanitize] datos externos', report);
      setPm25Data(cleaned);
    }
  }, [externalData, sanitizeStations]);
  // Focar municipio cuando cambia focusMunicipio
  useEffect(() => {
    if (!focusMunicipio || !municipiosData || !leafletMapRef.current) {
      setFocusedMunicipio(null);
      return;
    }
    try {
      const feat = municipiosData.features.find(f => {
        const n = f.properties?.name;
        return n && n.toLowerCase() === focusMunicipio.toLowerCase();
      });
      if (feat) {
        const layer = L.geoJSON(feat);
        const b = layer.getBounds();
        if (b.isValid()) {
          const map = leafletMapRef.current;
            // Calcular un padding dinámico menor para evitar zoom excesivo
          const target = b.pad(0.15); // antes 0.4
          const currentZoom = map.getZoom();
          map.flyToBounds(target, { padding: [25,25], maxZoom: Math.min(9, currentZoom + 2), duration: 0.7 });
          setFocusedMunicipio(feat);
        }
      }
    } catch(e) { console.warn('[MapView] focusMunicipio error', e); }
  }, [focusMunicipio, municipiosData]);

  // Abrir popup automáticamente cuando se selecciona un municipio desde el buscador
  useEffect(() => {
    if (!focusMunicipio) return;
    let attempts = 0;
    const targetKey = focusMunicipio.toLowerCase();
    const tryOpen = () => {
      const layer = municipioLayersRef.current[targetKey];
      if (layer) {
        try { layer.openPopup(); } catch(_) {}
        return;
      }
      if (attempts < 6) { attempts++; setTimeout(tryOpen, 120); }
    };
    const id = setTimeout(tryOpen, 0);
    return () => clearTimeout(id);
  }, [focusMunicipio]);

  // Apply focus/color styles imperatively so we don't need to re-mount GeoJSON (avoids 8200-polygon remount)
  useEffect(() => {
    const layers = municipioLayersRef.current;
    if (!Object.keys(layers).length) return;
    Object.entries(layers).forEach(([norm, layer]) => {
      const feature = layer.feature;
      if (!feature) return;
      const isFocused = focusedMunicipio && feature === focusedMunicipio;
      const pm = municipioPmValues ? municipioPmValues[norm] : null;
      const baseColor = pm == null ? '#c8d1d9' : getPM25Color(pm);
      const stroke = isFocused ? '#ff6600' : (pm == null ? '#7a8691' : '#1f2933');
      layer.setStyle({
        color: stroke,
        weight: isFocused ? 2.2 : 0.8,
        fillColor: baseColor,
        fillOpacity: isFocused ? 0.40 : 0.22,
      });
    });
  }, [municipioPmValues, focusedMunicipio]);

  // Cargar datos (array de estaciones)
  useEffect(() => {
    if (externalData && externalData.length) return; // ya tenemos datos externos
    let cancelled = false;
    const loadSpainData = async () => {
      console.log('[MapView] Fetching spain.json ...');
      try {
        const resp = await fetch(`${process.env.PUBLIC_URL}/data/spain.json`);
        const data = await resp.json();
        if (!cancelled) {
          if (Array.isArray(data) && data.length) {
            const { cleaned, report } = sanitizeStations(data);
            console.log(`[MapView] Cargadas ${data.length} estaciones de spain.json | Limpias: ${cleaned.length}`, report);
            setPm25Data(cleaned);
          } else {
            console.warn('[MapView] spain.json vacío o formato inesperado, intentando madrid.json');
            const resp2 = await fetch(`${process.env.PUBLIC_URL}/data/madrid.json`);
            const data2 = await resp2.json();
            if (Array.isArray(data2) && data2.length) {
              const { cleaned, report } = sanitizeStations(data2);
              console.log(`[MapView] Fallback madrid.json OK (${data2.length}) | Limpias: ${cleaned.length}`, report);
              setPm25Data(cleaned);
            } else {
              setLastError('No se pudieron cargar estaciones (spain.json ni madrid.json)');
            }
          }
        }
      } catch (e) {
        console.error('[MapView] Error cargando spain.json:', e);
        try {
          console.log('[MapView] Intentando fallback madrid.json ...');
          const resp2 = await fetch(`${process.env.PUBLIC_URL}/data/madrid.json`);
          const data2 = await resp2.json();
          if (!cancelled) {
            if (Array.isArray(data2) && data2.length) {
              const { cleaned, report } = sanitizeStations(data2);
              console.log(`[MapView] Fallback madrid.json OK (${data2.length}) | Limpias: ${cleaned.length}`, report);
              setPm25Data(cleaned);
            } else {
              setLastError('Fallback madrid.json vacío o inválido');
            }
          }
        } catch (e2) {
          if (!cancelled) setLastError('Error total cargando datos PM2.5');
        }
      }
    };
    loadSpainData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalData]);

  // Derivar max horas cuando llegan datos
  useEffect(() => {
    if (pm25Data && pm25Data.length) {
      const firstWithSeries = pm25Data.find(st => st.open_meteo?.hourly?.pm2_5?.length);
      if (firstWithSeries) {
        const len = firstWithSeries.open_meteo.hourly.pm2_5.length;
        setMaxHours(len - 1);
        if (selectedHour > len - 1) setSelectedHour(0);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm25Data]);

  // Reproducir animación de horas
  useEffect(() => {
    if (playing && maxHours > 0) {
      playRef.current = setInterval(() => {
        setSelectedHour(h => (h >= maxHours ? 0 : h + 1));
      }, 1500);
    } else if (playRef.current) {
      clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, maxHours]);

  // Optimize particle count based on zoom level
  const optimizedPm25Data = useMemo(() => {
    if (!Array.isArray(pm25Data)) return null;
    // En lugar de slice(0,N) (que sesga si el archivo está ordenado por latitud), hacemos muestreo estratificado espacial.
    const particleReduction = zoom < 7 ? 0.25 : zoom < 9 ? 0.55 : 1.0;
    const target = Math.max(30, Math.floor(pm25Data.length * particleReduction));
    if (target >= pm25Data.length) return pm25Data;
    // Crear celdas de grilla (lat bands y lon bands) y tomar muestras dentro
    const LAT_MIN=27, LAT_MAX=44, LON_MIN=-18.8, LON_MAX=5.5;
    const latBands = 8; // configurable
    const lonBands = 8;
    const cells = Array.from({length:latBands},()=>Array.from({length:lonBands},()=>[]));
    for (const st of pm25Data) {
      const c = st.coords; if (!c) continue;
      const li = Math.min(latBands-1, Math.max(0, Math.floor(((c.lat - LAT_MIN)/(LAT_MAX-LAT_MIN))*latBands)));
      const lj = Math.min(lonBands-1, Math.max(0, Math.floor(((c.lon - LON_MIN)/(LON_MAX-LON_MIN))*lonBands)));
      cells[li][lj].push(st);
    }
    const result = [];
    // Repartir cupo proporcional al tamaño de cada celda pero garantizando al menos 1 si la celda tiene algo
    const total = pm25Data.length;
    for (let i=0;i<latBands;i++) {
      for (let j=0;j<lonBands;j++) {
        const arr = cells[i][j];
        if (!arr.length) continue;
        const quota = Math.max(1, Math.round(arr.length/total * target));
        if (arr.length <= quota) {
          result.push(...arr);
        } else {
          // sample aleatorio sin reemplazo
          for (let k=0; k<quota; k++) {
            const idx = Math.floor(Math.random()*arr.length);
            result.push(arr[idx]);
            arr.splice(idx,1);
          }
        }
      }
    }
    // Si por redondeos no llegamos al target, completar con aleatorios globales faltantes
    if (result.length < target) {
      const remaining = pm25Data.filter(st => !result.includes(st));
      while (result.length < target && remaining.length) {
        const idx = Math.floor(Math.random()*remaining.length);
        result.push(remaining[idx]);
        remaining.splice(idx,1);
      }
    }
    return result;
  }, [pm25Data, zoom]);

  // Derivar métricas básicas para debug
  const currentStationsWithData = useMemo(() => {
    if (!Array.isArray(optimizedPm25Data)) return 0;
    return optimizedPm25Data.filter(st => st.open_meteo?.hourly?.pm2_5?.[selectedHour] != null).length;
  }, [optimizedPm25Data, selectedHour]);

  // Handle map zoom changes for performance optimization
  const handleZoomEnd = (e) => {
    setZoom(e.target.getZoom());
  };

  return (
    <div ref={containerRef} className={`relative ${isFullScreen ? 'fixed inset-0 z-[2000] w-screen h-screen bg-white' : 'w-full h-full min-h-[400px] bg-white'} transition-[width,height] duration-200 ease-in-out`}>

      {/* Performance / Debug Info (collapsible) */}
      <div className="absolute top-4 left-20 z-[1000] text-[10px] w-[165px] select-none">
        <div className="bg-black/75 backdrop-blur rounded shadow overflow-hidden">
          <button
            onClick={()=>setDebugOpen(o=>!o)}
            aria-expanded={debugOpen}
            className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-semibold tracking-wide text-white hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <span className="flex items-center gap-1">Debug</span>
            <span>{debugOpen ? '▾' : '▸'}</span>
          </button>
          {debugOpen && (
            <div className="px-2 pb-2 pt-1 text-white/90 leading-tight space-y-[2px]">
              <div><span className="text-gray-300">Zoom:</span> {zoom}</div>
              <div><span className="text-gray-300">Stations:</span> {pm25Data?.length || 0}</div>
              <div><span className="text-gray-300">Used:</span> {optimizedPm25Data?.length || 0}</div>
              <div><span className="text-gray-300">Hour:</span> {selectedHour}/{maxHours}</div>
              <div><span className="text-gray-300">With data:</span> {currentStationsWithData}</div>
              <div><span className="text-gray-300">Anim:</span> {playing ? '▶️' : '⏸️'}</div>
              <div><span className="text-gray-300">Dataset:</span> spain.json</div>
              <div><span className="text-gray-300">Municipios:</span> {municipiosData?.features?.length || 0}</div>
              <div><span className="text-gray-300">Flow:</span> {flowMode ? 'On' : 'Off'}</div>
              <div><span className="text-gray-300">Viewport:</span> {typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : ''}</div>
            </div>
          )}
        </div>
      </div>

      <MapContainer
        center={[40.4168, -3.7038]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        whenReady={handleMapReady}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        
        {showMunicipios && municipiosData && (
          <GeoJSON
            key="municipios-layer"
            data={municipiosData}
            style={municipioStyleFn}
            onEachFeature={(feature, layer) => {
              const nombre = feature.properties?.name || feature.properties?.shape3 || 'Municipio';
              const prov = feature.properties?.shape2 || '';
              const norm = normalizeName(nombre);
              if (nombre) {
                municipioLayersRef.current[norm] = layer;
              }
              // Lazy popup: bind empty popup, build HTML only when opened (avoids 8200 buildPopupHtml calls on mount)
              layer.bindPopup('');
              layer.on('popupopen', () => {
                layer.setPopupContent(buildPopupHtml(nombre, prov, feature));
              });
              layer.on('mouseover', () => {
                layer.setStyle({ weight: 1.2, fillOpacity: 0.32 });
              });
              layer.on('mouseout', () => {
                const isFocused = focusedMunicipio && feature === focusedMunicipio;
                layer.setStyle({ weight: isFocused?2.0:0.7, fillOpacity: isFocused?0.35:0.18 });
              });
              layer.on('click', () => {
                if (onMunicipioSelect) onMunicipioSelect(nombre);
              });
            }}
          />
        )}
        {(showVectors || showFlowArrows) && optimizedPm25Data && (
          <PM25VectorLayer
            data={optimizedPm25Data}
            selectedHour={selectedHour}
            isPlaying={playing}
            opacity={opacity}
            zoom={zoom}
            flowMode={flowMode}
            showFlowArrows={showFlowArrows}
            flowArrowDensity={flowArrowDensity}
            showVectors={showVectors}
          />
        )}
      </MapContainer>
      {!pm25Data && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm z-[1200]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <p className="text-gray-700 text-sm">Cargando estaciones PM2.5...</p>
          </div>
        </div>
      )}
      {lastError && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1300] bg-red-600 text-white px-4 py-2 rounded shadow text-xs font-semibold">
          {lastError}
        </div>
      )}
      {/* Removed stations count badge (was bottom-right) per user request */}

      {/* Controls Hour Slider: only show if there's temporal data AND at least one visualization active */}
      {maxHours > 0 && (showVectors || showFlowArrows) && (
        <div className="absolute bottom-4 right-1/2 translate-x-1/2 md:right-auto md:left-1/2 md:-translate-x-1/2 z-[1050] bg-white/90 backdrop-blur rounded-lg px-4 py-3 shadow flex flex-col gap-2 w-[260px]">
          <div className="flex items-center justify-between text-[11px] text-gray-600 font-medium">
            <span>Hours</span>
            <span>{selectedHour} / {maxHours}</span>
          </div>
          <input
            type="range"
            min={0}
            max={maxHours}
            value={selectedHour}
            onChange={e => setSelectedHour(parseInt(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
          <div className="flex justify-between items-center text-xs">
            <button
              onClick={() => setPlaying(p => !p)}
              className="px-2 py-[2px] bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
            >
              {playing ? 'Pausar' : 'Play'}
            </button>
            <button
              onClick={() => setSelectedHour(h => h > 0 ? h - 1 : maxHours)}
              className="px-2 py-[2px] bg-gray-200 hover:bg-gray-300 rounded"
            >◀</button>
            <button
              onClick={() => setSelectedHour(h => h >= maxHours ? 0 : h + 1)}
              className="px-2 py-[2px] bg-gray-200 hover:bg-gray-300 rounded"
            >▶</button>
            <button
              onClick={() => setSelectedHour(0)}
              className="px-2 py-[2px] bg-gray-100 hover:bg-gray-200 rounded"
            >Reset</button>
          </div>
        </div>
      )}
      
      {/* Controls (collapsible) */}
      <div className="absolute top-4 right-4 z-[1000] w-[230px]">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={() => setControlsOpen(o=>!o)}
            aria-expanded={controlsOpen}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wide bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <span className="flex items-center gap-1">⚙️ Controls</span>
            <span className="text-xs">{controlsOpen ? '▾' : '▸'}</span>
          </button>
          {controlsOpen && (
            <div className="p-3 pt-2 space-y-2 text-[11px]">
              <button
                onClick={toggleFullScreen}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 rounded px-2 py-1 font-medium"
                aria-label={isFullScreen ? 'Exit full screen (Esc)' : 'Enter full screen (press F)'}
              >
                {isFullScreen ? '↙️ Exit (Esc)' : '⤢ Full screen (F)'}
              </button>
              {/* Removed 'Reload Municipalities' button (was redundant after auto dataset upgrade). */}
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMunicipios}
                  onChange={(e) => setShowMunicipios(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
                <span className="text-xs font-medium text-gray-700">Municipalities</span>
              </label>
              <div className="border-t pt-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVectors}
                    onChange={(e) => setShowVectors(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-gray-700">Particles</span>
                </label>
                <label className="mt-2 flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showFlowArrows}
                    onChange={(e) => setShowFlowArrows(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <span className="text-xs font-medium text-gray-700">Flow arrows & packets</span>
                </label>
                <label className="mt-2 flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flowMode}
                    onChange={(e) => setFlowMode(e.target.checked)}
                    className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                  />
                  <span className="text-xs font-medium text-gray-700" title="Enable source→sink flow calculation">Flow mode (source→sink)</span>
                </label>
                {showFlowArrows && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 mr-1">Density:</span>
                    {['low','med','high'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => setFlowArrowDensity(opt)}
                        className={`px-1.5 py-0.5 rounded text-[10px] border ${flowArrowDensity===opt ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-purple-50'}`}
                      >{opt}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend component (kept separate so it remains visible independently) */}
      <div className="absolute bottom-4 left-4 z-[900]">
        <PM25Legend />
      </div>

    </div>
  );
};

export default MapView;