#!/usr/bin/env node
/** Script relocado dentro de website/scripts para resolver dependencias locales */
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

function parseArgs() {const args = process.argv.slice(2);const o={};for (let i=0;i<args.length;i++){if(args[i].startsWith('--')){const k=args[i].slice(2);const v=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;o[k]=v;}}return o;}
function countVertices(g){if(!g) return 0;const {type,coordinates:c}=g;switch(type){case 'Polygon': return c.reduce((a,r)=>a+r.length,0);case 'MultiPolygon': return c.reduce((a,p)=>a+p.reduce((b,r)=>b+r.length,0),0);case 'LineString': return c.length;case 'MultiLineString': return c.reduce((a,r)=>a+r.length,0);case 'Point': return 1;case 'MultiPoint': return c.length;default:return 0;}}
function roundGeometry(g,precision){const f=Math.pow(10,precision);const rc=v=>Math.round(v*f)/f;const walk=(coords)=>{if(typeof coords[0]==='number'){return [rc(coords[0]),rc(coords[1])];}return coords.map(walk);};return {...g,coordinates:walk(g.coordinates)};}

(async function main(){
  const { input='../old/spain_Municipality_level_3.geojson', output='./public/data/municipios.geojson', tolerance='0.005', highQuality=false, minArea='0', precision='5' } = parseArgs();
  const inPath = path.resolve(process.cwd(), input);
  const outPath = path.resolve(process.cwd(), output);
  if (!fs.existsSync(inPath)) { console.error('No existe input', inPath); process.exit(1); }
  const raw = fs.readFileSync(inPath,'utf-8');
  let gj; try { gj = JSON.parse(raw); } catch(e){ console.error('GeoJSON inválido'); process.exit(1); }
  if (gj.type !== 'FeatureCollection'){ console.error('Se requiere FeatureCollection'); process.exit(1); }
  const tol=parseFloat(tolerance); const minA=parseFloat(minArea); const prec=parseInt(precision,10);
  const outFeats=[]; let removedSmall=0; let origVerts=0; let simpVerts=0;
  for (const f of gj.features){ if(!f.geometry) continue; origVerts+=countVertices(f.geometry); let g=f.geometry; try{ g=turf.simplify({type:'Feature',geometry:g,properties:{}},{tolerance:tol,highQuality:!!highQuality,mutate:false}).geometry; if(minA>0){ const area=turf.area({type:'Feature',geometry:g}); if(area<minA){removedSmall++; continue;} } g=roundGeometry(g,prec); simpVerts+=countVertices(g); outFeats.push({type:'Feature',properties:f.properties||{},geometry:g}); }catch(err){ console.warn('Error simplificando feature, se deja original', err.message); outFeats.push(f); }}
  const out={type:'FeatureCollection', name: gj.name||'municipios', features: outFeats};
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath, JSON.stringify(out));
  const newSize=Buffer.byteLength(JSON.stringify(out)); const origSize=Buffer.byteLength(raw);
  console.log('Features:', gj.features.length,'->',outFeats.length,'(removidos pequeños:',removedSmall+')');
  console.log('Vértices:', origVerts,'->',simpVerts,'Reducción:', ((1-simpVerts/origVerts)*100).toFixed(2)+'%');
  console.log('Tamaño:', (origSize/1024/1024).toFixed(2)+'MB ->', (newSize/1024/1024).toFixed(2)+'MB', '(', ((1-newSize/origSize)*100).toFixed(2)+'% )');
  console.log('Escrito en', outPath);
})();
