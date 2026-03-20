import { useState, useEffect, useRef } from "react";
import MapView from "./components/MapView";

export default function App() {
  const [data, setData] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selectedMunicipio, setSelectedMunicipio] = useState("");
  const [municipiosListado, setMunicipiosListado] = useState([]);
  const [alertHealth, setAlertHealth] = useState({ status: 'unknown', subscriptions: 0, lastError: null });
  const healthTimerRef = useRef(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subMunicipio, setSubMunicipio] = useState(() => window.localStorage.getItem('subscription_municipio') || '');
  const [subEmail, setSubEmail] = useState('');
  const [subLoading, setSubLoading] = useState(false);
  const [subMunicipioQuery, setSubMunicipioQuery] = useState('');
  const [subMunicipioOpen, setSubMunicipioOpen] = useState(false);
  const municipiosForSelect = municipiosListado.length ? municipiosListado : Array.from(new Set(data.map(d=>d.municipio).filter(Boolean))).sort();

  // Cargar datos: primero intenta JSON estático, luego llama a la API con capitales de provincia
  useEffect(() => {
    let cancelled = false;

    // Capitales de provincia (una por provincia, la más poblada)
    const DEFAULT_KEYS = [
      "Andalucía|Almería|Almería","Andalucía|Cádiz|Jerez de la Frontera",
      "Andalucía|Córdoba|Córdoba","Andalucía|Granada|Granada",
      "Andalucía|Huelva|Huelva","Andalucía|Jaén|Jaén",
      "Andalucía|Málaga|Málaga","Andalucía|Sevilla|Sevilla",
      "Aragón|Huesca|Huesca","Aragón|Teruel|Teruel","Aragón|Zaragoza|Zaragoza",
      "Asturias|Asturias|Gijón",
      "Canarias|Las Palmas|Palmas de Gran Canaria (Las)",
      "Canarias|Santa Cruz de Tenerife|Santa Cruz de Tenerife",
      "Cantabria|Cantabria|Santander",
      "Castilla La Mancha|Albacete|Albacete","Castilla La Mancha|Ciudad Real|Ciudad Real",
      "Castilla La Mancha|Cuenca|Cuenca","Castilla La Mancha|Guadalajara|Guadalajara",
      "Castilla La Mancha|Toledo|Talavera de la Reina",
      "Castilla León|Ávila|Ávila","Castilla León|Burgos|Burgos",
      "Castilla León|León|León","Castilla León|Palencia|Palencia",
      "Castilla León|Salamanca|Salamanca","Castilla León|Segovia|Segovia",
      "Castilla León|Soria|Soria","Castilla León|Valladolid|Valladolid",
      "Castilla León|Zamora|Zamora",
      "Catalunya|Barcelona|Barcelona","Catalunya|Girona|Girona",
      "Catalunya|Lleida|Lleida","Catalunya|Tarragona|Tarragona",
      "Ceuta y Melilla|Ceuta|Ceuta","Ceuta y Melilla|Melilla|Melilla",
      "Extremadura|Badajoz|Badajoz","Extremadura|Cáceres|Cáceres",
      "Galicia|A Coruña|Coruña (A)","Galicia|Lugo|Lugo",
      "Galicia|Ourense|Ourense","Galicia|Pontevedra|Vigo",
      "Islas Baleares|Illes Balears|Palma",
      "La Rioja|La Rioja|Logroño",
      "Madrid|Madrid|Madrid",
      "Murcia|Murcia|Murcia",
      "Navarra|Navarra|Pamplona/Iruña",
      "País Vasco|Álava|Vitoria-Gasteiz",
      "País Vasco|Guipúzcoa|Donostia-San Sebastián",
      "País Vasco|Vizcaya|Bilbao",
      "Valencia|Alicante/Alacant|Alicante/Alacant",
      "Valencia|Castellón/Castelló|Castellón de la Plana/Castelló de la Plana",
      "Valencia|Valencia/València|Valencia",
    ];

    // Transforma la respuesta de la API al formato que espera MapView
    const transformStation = (s) => ({
      ...s,
      coords: { lat: s.lat, lon: s.lon },
      open_meteo: s.air_quality,
    });

    const load = async () => {
      // 1. Intentar JSON estático pre-generado
      try {
        const big = await fetch('/data/spain.json');
        if (big.ok) {
          const bigJson = await big.json();
          if (!cancelled && Array.isArray(bigJson) && bigJson.length) {
            setData(bigJson);
            setFiltered(bigJson);
            return;
          }
        }
      } catch(_) { /* caer a API */ }

      // 2. Llamar a la API con las capitales de provincia
      try {
        const base = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
        const resp = await fetch(`${base}/air-quality/stations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: DEFAULT_KEYS, aq_past_days: 3, aq_forecast_days: 1, wx_past_days: 3 }),
        });
        if (!resp.ok) throw new Error(`API ${resp.status}`);
        const json = await resp.json();
        if (!cancelled && Array.isArray(json) && json.length) {
          const stations = json.filter(s => !s.error).map(transformStation);
          setData(stations);
          setFiltered(stations);
          return;
        }
      } catch(e) {
        console.warn('[App] Error cargando desde API:', e);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  // Poll alert server health every 20s
  useEffect(() => {
    const base = (process.env.REACT_APP_ALERT_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(base + '/health', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        const j = await res.json();
        if (!cancelled) setAlertHealth({ status: 'ok', subscriptions: j.subscriptions ?? 0, lastError: null });
      } catch (e) {
        if (!cancelled) setAlertHealth(h => ({ ...h, status: 'down', lastError: e.message }));
      } finally {
        if (!cancelled) healthTimerRef.current = setTimeout(poll, 20000);
      }
    }
    poll();
    return () => { cancelled = true; if (healthTimerRef.current) clearTimeout(healthTimerRef.current); };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      <MapView
        fullScreen={true}
        data={filtered}
        focusMunicipio={selectedMunicipio}
        onMunicipioSelect={(name) => {
          setSelectedMunicipio(name);
          if (!name) {
            setFiltered(data);
          } else {
            setFiltered(data.filter(d => d.municipio === name));
          }
        }}
        onMunicipiosList={(names) => {
          if (Array.isArray(names) && names.length) {
            setMunicipiosListado(names);
          }
        }}
      />
      
      {/* Overlay de alertas */}
      <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] backdrop-blur-sm ${alertHealth.status==='ok' ? 'bg-green-100/90 border-green-400 text-green-700' : alertHealth.status==='down' ? 'bg-red-100/90 border-red-400 text-red-700' : 'bg-gray-100/90 border-gray-300 text-gray-600'}`}> 
          <span className={`w-2 h-2 rounded-full ${alertHealth.status==='ok' ? 'bg-green-500 animate-pulse' : alertHealth.status==='down' ? 'bg-red-500' : 'bg-gray-400'}`}></span>
          {alertHealth.status==='ok' ? `AlertSrv OK (${alertHealth.subscriptions})` : alertHealth.status==='down' ? 'AlertSrv DOWN' : 'AlertSrv ...'}
        </span>
        {alertHealth.lastError && (
          <button
            onClick={() => alert('Último error health: ' + alertHealth.lastError)}
            className="text-red-600 underline text-xs bg-white/80 px-1 rounded"
          >info</button>
        )}
        <button
          onClick={() => setShowSubscribe(s => !s)}
          className="bg-red-500 hover:bg-red-600 text-white font-semibold py-1.5 px-3 rounded-full shadow-md text-sm"
        >
          {showSubscribe ? 'Close' : 'Set Alerts'}
        </button>
      </div>

      {/* Panel de suscripción */}
      {showSubscribe && (
        <div className="absolute top-16 right-4 z-[1001] w-80 bg-white border border-red-300 rounded-lg shadow-xl p-4 text-sm animate-fade-in">
          <h3 className="font-semibold text-red-600 mb-2">Subscribe to Calima Alerts</h3>
          <div className="mb-2">
            <span className="text-gray-700 text-xs font-medium">Municipality (focus area)</span>
            <div className="mt-1 relative">
              <input
                type="text"
                value={subMunicipioQuery || subMunicipio}
                placeholder={subMunicipio ? subMunicipio : 'Type to search...'}
                onChange={e => { setSubMunicipioQuery(e.target.value); setSubMunicipioOpen(true); }}
                onFocus={() => setSubMunicipioOpen(true)}
                className="w-full border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-400 pr-7"
              />
              { (subMunicipio || subMunicipioQuery) && (
                <button
                  type="button"
                  onClick={() => { setSubMunicipio(''); setSubMunicipioQuery(''); window.localStorage.removeItem('subscription_municipio'); }}
                  className="absolute right-1 top-1 text-gray-400 hover:text-gray-600 text-xs px-1"
                >✕</button>
              )}
              {subMunicipioOpen && (
                <ul className="absolute z-[10000] left-0 right-0 max-h-56 overflow-auto bg-white border border-red-300 rounded-md shadow-lg mt-1 text-xs divide-y divide-gray-100">
                  {(() => {
                    const q = (subMunicipioQuery || '').toLowerCase();
                    const list = municipiosForSelect.filter(m => !q || m.toLowerCase().includes(q)).slice(0,300);
                    if (!list.length) return <li className="px-2 py-1 text-gray-400">No matches</li>;
                    return list.map(m => (
                      <li
                        key={m}
                        onMouseDown={e => { e.preventDefault(); setSubMunicipio(m); setSubMunicipioQuery(''); window.localStorage.setItem('subscription_municipio', m); setSubMunicipioOpen(false); }}
                        className={`px-2 py-1 cursor-pointer hover:bg-red-50 ${m===subMunicipio ? 'bg-red-100 font-semibold' : ''}`}
                      >{m}</li>
                    ));
                  })()}
                </ul>
              )}
            </div>
            {subMunicipio && <p className="mt-1 text-[10px] text-green-700">Selected: {subMunicipio}</p>}
          </div>
          <label className="block mb-3">
            <span className="text-gray-700 text-xs font-medium">Email</span>
            <input
              type="email"
              value={subEmail}
              onChange={e => setSubEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <button
              disabled={!subEmail || subLoading}
              onClick={async () => {
                if (!subEmail) return;
                if (alertHealth.status !== 'ok') {
                  const proceed = window.confirm('Alert server not healthy ('+alertHealth.status+'). Attempt anyway?');
                  if (!proceed) return;
                }
                setSubLoading(true);
                try {
                  const base = process.env.REACT_APP_ALERT_BASE_URL || 'http://localhost:8000';
                  const url = base.replace(/\/$/, '') + '/subscribe';
                  const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: subEmail, municipio: subMunicipio || null })
                  });
                  const json = await res.json().catch(()=>({}));
                  if (!res.ok) {
                    alert('Failed to subscribe: ' + (json.detail || res.status + ' ' + res.statusText));
                  } else {
                    alert('Subscribed! Calima alerts will target '+ (subMunicipio || 'your region') +'.');
                    setShowSubscribe(false);
                    setSubEmail('');
                  }
                } catch (e) {
                  console.error('[Alert Subscribe] error', e);
                  alert('Network error: ' + e.message);
                } finally {
                  setSubLoading(false);
                }
              }}
              className={`flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-1.5 px-3 rounded ${(!subEmail || subLoading) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {subLoading ? 'Saving...' : 'Subscribe'}
            </button>
            <button
              onClick={() => setShowSubscribe(false)}
              className="px-3 py-1.5 rounded border text-gray-600 hover:bg-gray-100"
            >Cancel</button>
          </div>
          <p className="mt-2 text-[10px] text-gray-500 leading-snug">We will email you if a forecasted PM2.5 calima &gt; 50 μg/m³ is detected in the next 24h for the selected municipality.</p>
        </div>
      )}
    </div>
  );
}

