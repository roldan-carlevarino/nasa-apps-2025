import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// Pm25VectorLayer, main constant
const PM25VectorLayer = ({ data, selectedHour = 0, isPlaying = false, opacity = 1.0, zoom = 6, visible = true, flowMode = false, showFlowArrows = false, flowArrowDensity = 'med', showVectors = true }) => {
  const map = useMap();

  const animationRef = useRef(null);
  useEffect(() => {
    
    if (!Array.isArray(data) || !visible) return;

      const vectorLayer = L.layerGroup();

      //Zoom
      const currentZoom = zoom || map.getZoom();
      const currentBounds = map.getBounds();
      
    const stations = data;
      

    let filteredStations = stations;
      // MapView already reduces stations by density — no extra index filter needed here
      
      // Filtrar solo puntos visibles en pantalla
    filteredStations = filteredStations.filter(st => {
        const c = st.coords ? st.coords : (st.lat != null && st.lon != null ? { lat: st.lat, lon: st.lon } : null);
        return c && isFinite(c.lat) && isFinite(c.lon) && currentBounds.contains([c.lat, c.lon]);
      }); // Revisar las condiciones del operador ternario anidado, pero funciona

      // Fallback: si no hay ninguna estación visible (pantalla inicial muy alejada o dataset muy disperso) tomar primeras N sin filtrar
      if (filteredStations.length === 0) {
        const maxFallback = currentZoom < 6 ? 150 : currentZoom < 7 ? 100 : 60;
        filteredStations = stations.slice(0, maxFallback);
      }

      console.log(`Renderizando ${filteredStations.length} de ${stations.length} estaciones (zoom: ${currentZoom})`);

      // Precache coordenadas + serie PM2.5 para rendimiento
      const stationMeta = stations.map((st, idx) => {
        const c = st.coords ? st.coords : (st.lat != null && st.lon != null ? { lat: st.lat, lon: st.lon } : null);
        const series = st.open_meteo?.hourly?.pm2_5;
        return { idx, c, series, ref: st };
      }).filter(o => o.c && Array.isArray(o.series));

      // Parámetros centralizados
      const EPS = 0.05; // umbral de cambio mínimo
      const MAX_VECTOR_MAG = 0.002;
      const BASE_FLOW_SCALE = 0.0004;
      const MAX_NEIGHBOR_RADIUS2 = 4; // ~2 grados
      const K_BASE = zoom < 7 ? 3 : zoom < 9 ? 4 : 5;

      // Precompute dC (delta temporal) para estaciones con serie - solo si flowMode activo
      const deltas = new Map();
      if (flowMode) {
        stationMeta.forEach(m => {
          const cur = m.series[selectedHour];
          const next = m.series[selectedHour + 1] ?? cur;
          if (typeof cur === 'number' && typeof next === 'number') {
            deltas.set(m.idx, next - cur);
          }
        });
      }

      // Parámetros vecinos
      const K = currentZoom < 7 ? 3 : currentZoom < 9 ? 4 : 5;

      // Función para obtener color según PM2.5 con gradientes más suaves
      const getPM25Color = (value) => {
    if (value <= 12) return '#1e88e5';    // Blue - Good
        if (value <= 35) return '#ffff00';    // Yellow - Moderate  
        if (value <= 55) return '#ff7e00';    // Orange - Unhealthy for Sensitive Groups
        if (value <= 150) return '#ff0000';   // Red - Unhealthy
        if (value <= 250) return '#8f3f97';   // Purple - Very Unhealthy
        return '#7e0023';                     // Maroon - Hazardous
      };

      // Función para obtener opacidad basada en concentración
      const getPM25Opacity = (value) => {
        return Math.min(0.65 + (value / 50) * 0.35, 1.0); // Más concentración = más opaco
      };

      // Procesar ubicaciones filtradas para mejor rendimiento
      let totalParticles = 0;
      const tStart = performance.now();
    const particlesRuntime = [];
    // Si no se deben mostrar vectores (partículas de gradiente/temporal) pero sí flechas, aún necesitamos deltas y meta.
    filteredStations.forEach(station => {
        const coords = station.coords ? station.coords : { lat: station.lat, lon: station.lon };
        const hourly = station.open_meteo?.hourly;
        const hourlyPM25 = hourly?.pm2_5;
        const simplePM25 = station.pm25;
        
        // Verificar que las coordenadas son válidas antes de procesar (España + Canarias)
        if (!coords || !isFinite(coords.lat) || !isFinite(coords.lon) ||
            coords.lat < 27 || coords.lat > 44 || coords.lon < -18.5 || coords.lon > 5) {
          // console.warn(`Coordenadas inválidas para estación:`, coords);
          return; // Saltar esta ubicación
        }
        
        let currentPM25, nextPM25;
        if (Array.isArray(hourlyPM25)) {
          currentPM25 = hourlyPM25[selectedHour];
          nextPM25 = hourlyPM25[selectedHour + 1] ?? currentPM25;
        } else if (typeof simplePM25 === 'number') {
          currentPM25 = simplePM25;
          nextPM25 = simplePM25; // sin serie temporal
        } else {
          return; // no datos válidos
        }
        
        if (typeof currentPM25 !== 'number' || typeof nextPM25 !== 'number') return;
        
        const avgPM25 = (currentPM25 + nextPM25) / 2;
        const deltaPM25 = nextPM25 - currentPM25;

    // Color y propiedades visuales
    const color = getPM25Color(avgPM25);
    const opacityValue = getPM25Opacity(avgPM25);
        
        // OPTIMIZACIÓN: Reducir partículas según zoom y concentración
        let maxParticles, baseParticles, randomExtra;
        
        if (currentZoom < 7) {
          maxParticles = 20;
          baseParticles = 12;
          randomExtra = Math.floor(Math.random() * 8);
        } else if (currentZoom < 9) {
          maxParticles = 15;
          baseParticles = 8;
          randomExtra = Math.floor(Math.random() * 6);
        } else {
          maxParticles = 12;
          baseParticles = Math.floor(avgPM25 / 2);
          randomExtra = Math.floor(Math.random() * Math.max(3, avgPM25 / 4));
        }
        
    const numParticles = Math.max(5, Math.min(baseParticles + randomExtra, maxParticles));
    totalParticles += numParticles;
        
        // FLOW MODE: reemplaza cálculo de vector cuando está activo
        let flowAngle = null;
        let flowMagnitude = 0;
        if (flowMode && Array.isArray(hourlyPM25)) {
          const selfDelta = deltas.get(stationMeta.find(sm => sm.ref === station)?.idx);
          // Encontrar vecinos (K_BASE) con dC positivo (sumideros) si este es fuente (selfDelta < -EPS)
          if (selfDelta != null) {
            const neighbors = stationMeta
              .filter(m => m.c && m.c !== coords && deltas.get(m.idx) != null)
              .map(m => {
                const dLat = m.c.lat - coords.lat;
                const dLon = m.c.lon - coords.lon;
                const dist2 = dLat * dLat + dLon * dLon;
                return { m, dist2, dLat, dLon, delta: deltas.get(m.idx) };
              })
              .filter(o => o.dist2 > 0 && o.dist2 < MAX_NEIGHBOR_RADIUS2)
              .sort((a,b) => a.dist2 - b.dist2);

            if (selfDelta < -EPS) {
              // Fuente: apuntar hacia centroides de sumideros (delta > 0)
              const sinks = neighbors.filter(n => n.delta > EPS).slice(0, K_BASE);
              if (sinks.length) {
                let cx = 0, cy = 0, distW = 0;
                sinks.forEach(n => {
                  const w = n.delta / (Math.sqrt(n.dist2) + 0.15); // ponderar por cambio y proximidad
                  cx += (coords.lon + n.dLon) * w;
                  cy += (coords.lat + n.dLat) * w;
                  distW += w;
                });
                if (distW > 0) {
                  cx /= distW; cy /= distW;
                  const dLon = cx - coords.lon;
                  const dLat = cy - coords.lat;
                  flowAngle = Math.atan2(dLat, dLon);
                  const centroidDist = Math.sqrt(dLat*dLat + dLon*dLon);
                  flowMagnitude = Math.min(MAX_VECTOR_MAG, BASE_FLOW_SCALE + Math.abs(selfDelta) * 0.0003 + centroidDist * 0.0002);
                }
              }
            } else if (selfDelta > EPS) {
              // Sumidero: partícula casi estática con ligero pulso, lo tratamos más adelante (magnitude ~0)
              flowAngle = null;
              flowMagnitude = 0;
            }
          }
        }

        // VECTOR ESPACIAL: gradiente local (difusión desde mayor a menor concentración) usando K vecinos
    let gradX = 0, gradY = 0, gradCount = 0;
    if (showVectors && Array.isArray(hourlyPM25)) {
          // Encontrar vecino más cercanos por distancia euclídea en lat/lon
          const neighbors = stationMeta
            .filter(m => m.c && m.c !== coords && m.series && typeof m.series[selectedHour] === 'number')
            .map(m => {
              const dLat = m.c.lat - coords.lat;
              const dLon = m.c.lon - coords.lon;
              const dist2 = dLat * dLat + dLon * dLon;
              return { m, dist2, dLat, dLon };
            })
            .filter(o => o.dist2 > 0 && o.dist2 < 4) // limitar a ~2 grados de radio
            .sort((a,b) => a.dist2 - b.dist2)
            .slice(0, K);
          neighbors.forEach(n => {
            const neighborPM = n.m.series[selectedHour];
            if (typeof neighborPM === 'number') {
              const dPM = neighborPM - currentPM25; // positivo si vecino más alto
              const invDist = 1 / Math.sqrt(n.dist2);
              // componente desde mayor->menor: vector apunta hacia descenso de concentración (dPM negativo)
              gradX += (-dPM) * (n.dLon * invDist);
              gradY += (-dPM) * (n.dLat * invDist);
              gradCount++;
            }
          });
        }
        let gradAngle = null;
        let gradMag = 0;
        if (gradCount > 0) {
          gradAngle = Math.atan2(gradY, gradX);
          gradMag = Math.min(0.0012, 0.0002 + Math.sqrt(gradX*gradX + gradY*gradY) * 0.00015);
        }

    // Crear partículas solo si showVectors activo
    if (showVectors) {
    for (let p = 0; p < numParticles; p++) {
          // VECTOR TEMPORAL (como antes)
          let temporalAngle, temporalMag;
          if (Math.abs(deltaPM25) < 0.1) {
            temporalAngle = Math.random() * Math.PI * 2;
            temporalMag = 0.00025 + Math.random() * 0.00015;
          } else {
            const baseAngle = Math.atan2(deltaPM25, 1);
            const angleVariation = (Math.random() - 0.5) * Math.PI / 6;
            temporalAngle = baseAngle + angleVariation;
            const changeMagnitude = Math.abs(deltaPM25) / 10;
            temporalMag = Math.min(0.0007 + changeMagnitude * 0.0004, 0.0013);
          }

          // COMBINAR: prioridad flowMode > gradient > temporal
          let finalAngle, finalMagnitude;
          if (flowMode) {
            if (flowAngle != null && flowMagnitude > 0) {
              finalAngle = flowAngle;
              finalMagnitude = flowMagnitude;
            } else if (gradAngle != null) {
              // sumidero sin flujo válido: usar gradiente espacial como fallback
              finalAngle = gradAngle;
              finalMagnitude = gradMag * 0.7; // reducir para diferenciar de flujo
            } else {
              // sin flujo ni gradiente: usar temporal con magnitud reducida
              finalAngle = temporalAngle;
              finalMagnitude = temporalMag * 0.5;
            }
          } else if (gradAngle != null) {
            const wSpatial = 0.6; // peso espacial
            const wTemporal = 0.4; // peso temporal
            // Interpolación de ángulos (simplificada)
              const x = Math.cos(gradAngle) * wSpatial + Math.cos(temporalAngle) * wTemporal;
              const y = Math.sin(gradAngle) * wSpatial + Math.sin(temporalAngle) * wTemporal;
              finalAngle = Math.atan2(y, x);
              finalMagnitude = gradMag * wSpatial + temporalMag * wTemporal;
          } else {
            finalAngle = temporalAngle;
            finalMagnitude = temporalMag;
          }
          
          // Variación leve por índice para evitar rigidez
          const timeComponent = (p / numParticles) * Math.PI / 5;
          finalAngle += timeComponent;
          
          // Variación adicional por partícula
          const particleVariation = (Math.random() - 0.5) * 0.3;
    let finalMagnitudeMod = finalMagnitude * (1 + particleVariation);
          
          // Verificar que los valores son válidos
          if (!isFinite(finalMagnitudeMod) || !isFinite(finalAngle)) {
            finalMagnitudeMod = 0.0005;
          }

          // Scatter radius: spread particles over a wide area around each station
          // so 16 stations visually cover all of Spain rather than clustering at each point.
          // scatterR decreases with zoom (wide at country level, tight when zoomed in)
          const scatterR = currentZoom < 7 ? (0.4 + Math.random() * 1.0)
                         : currentZoom < 9 ? (0.1 + Math.random() * 0.4)
                         :                   (0.02 + Math.random() * 0.08);
          const scatterAngle = Math.random() * Math.PI * 2;
          
          // Calcular offsets: scatter dominates at low zoom, vector direction at high zoom
          const latOffset = Math.sin(finalAngle) * finalMagnitudeMod + Math.sin(scatterAngle) * scatterR;
          const lonOffset = Math.cos(finalAngle) * finalMagnitudeMod + Math.cos(scatterAngle) * scatterR;
          
          // Verificación de seguridad geográfica
          const particleLat = coords.lat + latOffset;
          const particleLon = coords.lon + lonOffset;
          const isInSpain = (particleLat >= 27.0 && particleLat <= 44.0 && 
                            particleLon >= -18.5 && particleLon <= 5.0);
          
    const safeLat = isInSpain ? particleLat : coords.lat;
    const safeLon = isInSpain ? particleLon : coords.lon;
          
          // Tamaños variables
          const sizeType = Math.random();
          let particleSize;
          
          if (sizeType < 0.4) {
            particleSize = 0.7 + Math.random() * 0.8;
          } else if (sizeType < 0.7) {
            particleSize = 1.2 + Math.random() * 1.5 + avgPM25 / 40;
          } else {
            particleSize = 1.8 + Math.random() * 2.2 + avgPM25 / 20;
          }
          
          // Opacidad basada en concentración PM2.5
          const baseOpacity = opacityValue; // ya calculado en línea 125
          const opacityType = Math.random();
          let particleOpacity;
          
          if (opacityType < 0.3) {
            particleOpacity = baseOpacity * 0.75; // partículas tenues
          } else if (opacityType < 0.6) {
            particleOpacity = baseOpacity * 0.9; // partículas medias
          } else {
            particleOpacity = baseOpacity; // partículas intensas
          }
          
          // Variación de color
          let particleColor = color;
          const colorVariation = Math.random();
          
          if (colorVariation < 0.15) {
            particleColor = getPM25Color(Math.max(0, avgPM25 - 5 - Math.random() * 10));
          } else if (colorVariation < 0.3) {
            particleColor = getPM25Color(avgPM25 + 3 + Math.random() * 8);
          }
          
          // Crear partícula circular
          const particle = L.circleMarker([safeLat, safeLon], {
            radius: particleSize,
            fillColor: particleColor,
            color: 'transparent',
            weight: 0,
            opacity: 0,
            fillOpacity: particleOpacity * opacity,
            className: `particle-fade particle-random-${Math.floor(Math.random() * 5) + 1}`
          });
          
          particle.addTo(vectorLayer);
          particlesRuntime.push({
            marker: particle,
            origin: { lat: coords.lat, lon: coords.lon },
            lat: safeLat,
            lon: safeLon,
            baseAngle: finalAngle,
            angle: finalAngle,
            baseMagnitude: finalMagnitudeMod,
            step: finalMagnitudeMod * (0.12 + Math.random() * 0.18),
            life: 0,
            maxLife: 40 + Math.floor(Math.random() * 40),
            jitter: (Math.random() - 0.5) * 0.00025
          });
          
          // Crear halos ocasionales
    if (Math.random() > 0.85 && avgPM25 > 10) {
            const halo = L.circleMarker([safeLat, safeLon], {
              radius: particleSize * (1.5 + Math.random()),
              fillColor: particleColor,
              color: 'transparent',
              weight: 0,
              opacity: 0,
              fillOpacity: 0.1,
              className: 'particle-halo'
            });
            halo.addTo(vectorLayer);
          }
    } // fin creación partículas
    }
        
        // Tooltip informativo
    if (showVectors) {
          const infoMarker = L.circleMarker([coords.lat, coords.lon], {
            radius: 0,
            opacity: 0
          });
          
          let trendDirection = "➡️ Estable";
          if (Math.abs(deltaPM25) >= 0.1) {
            trendDirection = deltaPM25 > 0 ? "📈 Aumentando" : "📉 Disminuyendo";
          }
          
          infoMarker.bindTooltip(`
            <div style="font-family: Arial, sans-serif; font-size: 12px;">
              <strong style="color: ${color};">${station.poblacion || station.municipio || station.key || 'Punto'}</strong><br>
              <span style="color: #666;">🌬️ Vector Temporal PM2.5</span><br>
              <span style="color: #333;">Concentración: ${avgPM25.toFixed(1)} μg/m³</span><br>
              <span style="color: #666;">Tendencia: ${trendDirection}</span><br>
              <span style="color: #888;">Cambio: Δ${deltaPM25.toFixed(1)}</span>
            </div>
          `, {
            permanent: false,
            direction: 'top',
            offset: [0, -10],
            className: 'particle-tooltip'
          });
          
          infoMarker.addTo(vectorLayer);
        }
      });

    const tElapsed = (performance.now() - tStart).toFixed(1);
    console.log(`[PM25VectorLayer] Estaciones visibles: ${filteredStations.length} | Partículas aprox: ${totalParticles} | grad(ms): ${tElapsed} | modo=${flowMode ? 'flujo' : 'mixto'}`);

    // -------------------------------------------------------------
    // FLOW MODE: elementos visuales de flujo (flechas, paquetes, halos)
    // Solo se muestran si showFlowArrows=true, pero requieren que flowMode=true para el cálculo
    // -------------------------------------------------------------
    const linkPackets = [];
    const sinkHalos = [];
    let linkLayer = null;
    let arrowsLayer = null;
    const arrowPolylines = [];
    if (showFlowArrows && flowMode) {
      try {
        linkLayer = L.layerGroup().addTo(map);

        // Mapear referencia -> meta para acceso rápido
        const metaByRef = new Map(stationMeta.map(m => [m.ref, m]));
        const visibleMeta = filteredStations.map(st => metaByRef.get(st)).filter(Boolean);
        const visibleSources = visibleMeta.filter(m => (deltas.get(m.idx) ?? 0) < -EPS);
        const visibleSinks = visibleMeta.filter(m => (deltas.get(m.idx) ?? 0) > EPS);

        // Limitar para rendimiento
        const MAX_SOURCES = zoom < 7 ? 40 : zoom < 9 ? 60 : 80;
        const MAX_SINKS = zoom < 7 ? 40 : zoom < 9 ? 60 : 80;
        const sourcesTrim = visibleSources.slice(0, MAX_SOURCES);
        const sinksTrim = visibleSinks.slice(0, MAX_SINKS);

        // Precalcular valores PM actuales para color
        const pmAt = (m) => (Array.isArray(m.series) && typeof m.series[selectedHour] === 'number') ? m.series[selectedHour] : 0;

        let packetBudget = zoom < 7 ? 120 : zoom < 9 ? 180 : 260; // límite global

        sourcesTrim.forEach(src => {
          const srcDelta = deltas.get(src.idx);
          if (srcDelta == null || srcDelta >= -EPS) return;
          // Encontrar sumideros más cercanos
          const candidateSinks = sinksTrim
            .map(sk => {
              const dLat = sk.c.lat - src.c.lat;
              const dLon = sk.c.lon - src.c.lon;
              const dist2 = dLat * dLat + dLon * dLon;
              return { sk, dLat, dLon, dist2, delta: deltas.get(sk.idx) };
            })
            .filter(o => o.delta > EPS && o.dist2 > 0 && o.dist2 < MAX_NEIGHBOR_RADIUS2)
            .sort((a,b) => a.dist2 - b.dist2)
            .slice(0, 3); // top 3 destinos

          if (!candidateSinks.length) return;
          const totalSinkDelta = candidateSinks.reduce((s,o) => s + o.delta, 0);
          candidateSinks.forEach(o => {
            if (packetBudget <= 0) return;
              const weight = o.delta / totalSinkDelta;
              // nº de paquetes para este enlace
              const packetsForLink = Math.max(1, Math.min(8, Math.round(Math.abs(srcDelta) * weight * 2)));
              const dist = Math.sqrt(o.dist2);
              for (let k = 0; k < packetsForLink && packetBudget > 0; k++) {
                packetBudget--;
                const t0 = Math.random();
                // Color transición: usamos color de sumidero más brillante
                const sinkPM = pmAt(o.sk);
                const sinkColor = getPM25Color(sinkPM);
                const packet = L.circleMarker([src.c.lat, src.c.lon], {
                  radius: 2.0 + Math.random() * 1.5,
                  color: 'transparent',
                  weight: 0,
                  fillColor: sinkColor,
                  fillOpacity: 0.55,
                  className: 'flow-packet'
                });
                packet.addTo(linkLayer);
                // Velocidad proporcional inversa a distancia (más lejos = más lento)
                const speed = (0.0022 / (dist + 0.05)) * (0.6 + Math.random() * 0.8); // incremento de t por frame (~60fps)
                linkPackets.push({
                  marker: packet,
                  source: { lat: src.c.lat, lon: src.c.lon },
                  target: { lat: o.sk.c.lat, lon: o.sk.c.lon },
                  t: t0,
                  speed,
                  dist
                });
              }
          });
        });

        // Halos en sumideros (acumulación)
        sinksTrim.forEach(sk => {
          const halo = L.circleMarker([sk.c.lat, sk.c.lon], {
            radius: 5,
            color: 'transparent',
            weight: 0,
            fillColor: '#ffffff',
            fillOpacity: 0.18,
            className: 'sink-halo'
          });
          halo.addTo(linkLayer);
          sinkHalos.push({ marker: halo, phase: Math.random() * Math.PI * 2, baseRadius: 5 });
        });

        // Flechas de redistribución
        arrowsLayer = L.layerGroup().addTo(map);
          // Ajustar densidad
          const densityFactor = flowArrowDensity === 'high' ? 1.0 : flowArrowDensity === 'med' ? 0.6 : 0.35;
          const maxArrows = Math.floor((zoom < 7 ? 120 : zoom < 9 ? 180 : 260) * densityFactor * 0.5);
          let arrowsCount = 0;
          // Para cada fuente seleccionar algunos sumideros y dibujar flechas
          sourcesTrim.forEach(src => {
            if (arrowsCount >= maxArrows) return;
            const srcDelta = deltas.get(src.idx);
            if (srcDelta == null || srcDelta >= -EPS) return;
            const candidateSinks = sinksTrim
              .map(sk => {
                const dLat = sk.c.lat - src.c.lat;
                const dLon = sk.c.lon - src.c.lon;
                const dist2 = dLat * dLat + dLon * dLon;
                return { sk, dist2, delta: deltas.get(sk.idx) };
              })
              .filter(o => o.delta > EPS && o.dist2 > 0 && o.dist2 < MAX_NEIGHBOR_RADIUS2)
              .sort((a,b) => a.dist2 - b.dist2)
              .slice(0, 3);
            if (!candidateSinks.length) return;
            candidateSinks.forEach(o => {
              if (arrowsCount >= maxArrows) return;
              arrowsCount++;
              // Crear una curva ligera (arco) usando punto medio desplazado
              const midLat = (src.c.lat + o.sk.c.lat)/2 + (Math.random()-0.5)*0.15; // curvatura pequeña
              const midLon = (src.c.lon + o.sk.c.lon)/2 + (Math.random()-0.5)*0.15;
              const path = [
                [src.c.lat, src.c.lon],
                [midLat, midLon],
                [o.sk.c.lat, o.sk.c.lon]
              ];
              const arrowColor = '#7f1dff';
              const poly = L.polyline(path, {
                color: arrowColor,
                weight: 2,
                opacity: 0.35,
                className: 'flow-arrow-line'
              }).addTo(arrowsLayer);
              arrowPolylines.push(poly);
              // Añadir marcador arrowhead animado sobre la línea (usamos un pequeño circle marker que se mueve)
              const head = L.circleMarker([src.c.lat, src.c.lon], {
                radius: 3.5,
                color: '#ffffff',
                weight: 1.2,
                fillColor: arrowColor,
                fillOpacity: 0.95,
                className: 'flow-arrow-head'
              }).addTo(arrowsLayer);
              // Precomputar puntos interpolados para animar (submuestreo 40 segmentos)
              const interp = [];
              const segments = 40;
              for (let s=0; s<=segments; s++) {
                const t = s/segments;
                // Bezier cuadrático: P0, P1, P2
                const lat = (1-t)*(1-t)*src.c.lat + 2*(1-t)*t*midLat + t*t*o.sk.c.lat;
                const lon = (1-t)*(1-t)*src.c.lon + 2*(1-t)*t*midLon + t*t*o.sk.c.lon;
                interp.push([lat, lon]);
              }
              // Guardar para animación (lo enganchamos al mismo loop de animate con un array)
              linkPackets.push({ marker: head, interp, idx: 0, speed: 0.7 + Math.random()*0.6, arrow:true });
            });
          });

        console.log(`[FlowMode] fuentes: ${sourcesTrim.length} | sumideros: ${sinksTrim.length} | paquetes: ${linkPackets.length} | flechas: ${arrowPolylines.length}`);
      } catch (e) {
        console.warn('Error creando flujo fuente-sumidero', e);
      }
    }
    
    // Animación continua
    const animate = () => {
      for (let i = 0; i < particlesRuntime.length; i++) {
        const pr = particlesRuntime[i];
        pr.life++;
        // Movimiento principal
        pr.lat += Math.sin(pr.angle) * pr.step;
        pr.lon += Math.cos(pr.angle) * pr.step;
        // Deriva perpendicular ligera
        pr.lat += Math.cos(pr.angle) * pr.jitter * 0.3;
        pr.lon -= Math.sin(pr.angle) * pr.jitter * 0.3;
        // Reciclaje
        if (pr.life > pr.maxLife) {
          pr.life = 0;
          pr.angle = pr.baseAngle + (Math.random() - 0.5) * Math.PI / 5;
          pr.lat = pr.origin.lat + (Math.random() - 0.5) * pr.baseMagnitude * 0.4;
          pr.lon = pr.origin.lon + (Math.random() - 0.5) * pr.baseMagnitude * 0.4;
          pr.step = pr.baseMagnitude * (0.10 + Math.random() * 0.2);
          pr.maxLife = 35 + Math.floor(Math.random() * 50);
        }
        const distFromOrigin = Math.abs(pr.lat - pr.origin.lat) + Math.abs(pr.lon - pr.origin.lon);
        if (distFromOrigin > pr.baseMagnitude * 6) {
          pr.lat = pr.origin.lat;
          pr.lon = pr.origin.lon;
          pr.life = 0;
        }
        pr.marker.setLatLng([pr.lat, pr.lon]);
      }

      // Animar paquetes de flujo (requiere showFlowArrows activo)
      if (showFlowArrows && flowMode && linkPackets.length) {
        for (let i = 0; i < linkPackets.length; i++) {
          const pk = linkPackets[i];
          if (pk.arrow) {
            // Arrowhead sobre curva precomputada
              pk.idx += pk.speed; // velocidad en índices
              if (pk.idx >= pk.interp.length) pk.idx = 0;
              const point = pk.interp[Math.floor(pk.idx)];
              pk.marker.setLatLng(point);
          } else {
            // Paquete lineal simple (legacy)
            pk.t += pk.speed; // progreso
            if (pk.t >= 1) pk.t = 0; // reciclar
            const lat = pk.source.lat + (pk.target.lat - pk.source.lat) * pk.t;
            const lon = pk.source.lon + (pk.target.lon - pk.source.lon) * pk.t;
            pk.marker.setLatLng([lat, lon]);
            const fade = pk.t < 0.5 ? 1 : 1 - (pk.t - 0.5) * 2;
            const newOpacity = 0.15 + 0.55 * Math.max(0, fade);
            pk.marker.setStyle({ fillOpacity: newOpacity });
          }
        }
      }

      // Pulsos en halos de sumideros (requiere showFlowArrows activo)
      if (showFlowArrows && flowMode && sinkHalos.length) {
        for (let h = 0; h < sinkHalos.length; h++) {
          const sh = sinkHalos[h];
          sh.phase += 0.05;
          const pulse = (Math.sin(sh.phase) + 1) / 2; // 0..1
          sh.marker.setRadius(sh.baseRadius + pulse * 3.5);
          sh.marker.setStyle({ fillOpacity: 0.08 + pulse * 0.27 });
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    vectorLayer.addTo(map);

      // Cleanup function
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        map.removeLayer(vectorLayer);
        if (linkLayer) {
          try { map.removeLayer(linkLayer); } catch(_) {}
        }
        if (arrowsLayer) {
          try { map.removeLayer(arrowsLayer); } catch(_) {}
        }
    };
  }, [map, data, selectedHour, isPlaying, opacity, zoom, visible, flowMode, showFlowArrows, flowArrowDensity, showVectors]);

  return null;
};

export default PM25VectorLayer;