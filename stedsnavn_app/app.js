const $ = id => document.getElementById(id);
const state = { last: null };

function show(id, html, cls = '') {
  const el = $(id);
  el.hidden = false;
  el.className = 'card ' + cls;
  el.innerHTML = html;
}
function hide(id) { $(id).hidden = true; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmt(n, d=5) { return Number.isFinite(n) ? n.toFixed(d) : ''; }

$('locateBtn').addEventListener('click', () => locate());
$('demoBtn').addEventListener('click', () => {
  const lat = parseFloat(prompt('Breddegrad / latitude', state.last?.lat ?? '59.9291'));
  const lon = parseFloat(prompt('Lengdegrad / longitude', state.last?.lon ?? '10.7277'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) runLookup(lat, lon, null);
});

async function locate() {
  if (!navigator.geolocation) {
    show('status', 'Denne nettleseren støtter ikke geolokasjon.', 'warn');
    return;
  }
  $('locateBtn').disabled = true;
  show('status', 'Henter GPS-posisjon …');
  navigator.geolocation.getCurrentPosition(
    pos => runLookup(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy).finally(() => $('locateBtn').disabled = false),
    err => { show('status', `<b>Fikk ikke GPS-posisjon.</b><br>${esc(err.message)}<br><br>På iPhone: åpne siden via HTTPS og tillat posisjon i Safari.`, 'warn'); $('locateBtn').disabled = false; },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

async function runLookup(lat, lon, accuracy) {
  state.last = { lat, lon };
  ['best','coords','osm','ssr','nominatim'].forEach(hide);
  show('status', 'Slår opp stedsnavn …');
  show('coords', `<b>Posisjon</b><div class="row"><span class="label">Lat/lon</span><span>${fmt(lat, 6)}, ${fmt(lon, 6)}</span></div>${accuracy ? `<div class="row"><span class="label">Nøyaktighet</span><span>ca. ${Math.round(accuracy)} m</span></div>` : ''}`);

  const [osm, ssr, nom] = await Promise.allSettled([
    lookupOverpassAreas(lat, lon),
    lookupSSR(lat, lon, 350),
    lookupNominatim(lat, lon)
  ]);

  const osmAreas = osm.status === 'fulfilled' ? osm.value : [];
  const ssrNames = ssr.status === 'fulfilled' ? ssr.value : [];
  const nomi = nom.status === 'fulfilled' ? nom.value : null;

  renderBest(osmAreas, ssrNames, nomi);
  renderOSM(osmAreas, osm.reason);
  renderSSR(ssrNames, ssr.reason);
  renderNominatim(nomi, nom.reason);
  show('status', 'Ferdig.', 'ok');
}

function renderBest(osmAreas, ssrNames, nomi) {
  const bestArea = osmAreas[0];
  const bestSSR = ssrNames[0];
  let name = bestArea?.name || bestSSR?.navn || nomi?.name || nomi?.display_name;
  let source = bestArea ? 'OSM-flate' : bestSSR ? 'Kartverket/SSR punkt i nærheten' : nomi ? 'Nominatim fallback' : 'Ingen treff';
  if (!name) name = 'Fant ikke lokalt navn';
  const tags = [];
  if (bestArea) tags.push(bestArea.kind, bestArea.admin_level ? `admin_level=${bestArea.admin_level}` : '', bestArea.sourceTag).filter(Boolean);
  show('best', `<b>Beste forslag</b><div class="big">${esc(name)}</div><div class="muted">Kilde: ${esc(source)}</div>${tags.length ? `<div>${tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}`);
}

function renderOSM(areas, err) {
  if (err) return show('osm', `<b>OSM-flater</b><p class="warn">Kunne ikke hente OSM-flater: ${esc(err.message || err)}</p>`, 'warn');
  if (!areas.length) return show('osm', '<b>OSM-flater</b><p class="muted">Ingen navngitte flater funnet akkurat her.</p>');
  const rows = areas.slice(0, 12).map(a => `<li><b>${esc(a.name)}</b><br><span class="muted">${esc(a.kind)} ${a.sourceTag ? ' · ' + esc(a.sourceTag) : ''}</span></li>`).join('');
  show('osm', `<b>OSM-flater som inneholder punktet</b><ol>${rows}</ol>`);
}

function renderSSR(names, err) {
  if (err) return show('ssr', `<b>Kartverket/SSR</b><p class="warn">Kunne ikke hente SSR-navn: ${esc(err.message || err)}</p>`, 'warn');
  if (!names.length) return show('ssr', '<b>Kartverket/SSR</b><p class="muted">Ingen SSR-navn funnet innen radiusen.</p>');
  const rows = names.slice(0, 12).map(n => `<li><b>${esc(n.navn)}</b><br><span class="muted">${esc(n.type || '')}${n.distance ? ' · ca. ' + Math.round(n.distance) + ' m' : ''}</span></li>`).join('');
  show('ssr', `<b>Offisielle stedsnavn nær punktet</b><ol>${rows}</ol>`);
}

function renderNominatim(n, err) {
  if (err) return show('nominatim', `<b>Nominatim</b><p class="warn">Kunne ikke hente Nominatim: ${esc(err.message || err)}</p>`, 'warn');
  if (!n) return show('nominatim', '<b>Nominatim</b><p class="muted">Ingen svar.</p>');
  const addr = n.address || {};
  const interesting = ['neighbourhood','suburb','quarter','city_district','village','hamlet','locality','road','municipality','county'];
  const rows = interesting.filter(k => addr[k]).map(k => `<div class="row"><span class="label">${esc(k)}</span><span>${esc(addr[k])}</span></div>`).join('');
  show('nominatim', `<b>Nominatim / OSM reverse</b>${rows || `<p>${esc(n.display_name || '')}</p>`}`);
}

async function lookupOverpassAreas(lat, lon) {
  const query = `[out:json][timeout:12];is_in(${lat},${lon})->.a;area.a[name];out tags;`;
  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, { method: 'POST', body: query, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
  if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
  const data = await res.json();
  const rows = (data.elements || []).map(e => normalizeArea(e.tags || {})).filter(Boolean);
  const seen = new Set();
  return rows.filter(r => { const k = r.name + '|' + r.kind; if (seen.has(k)) return false; seen.add(k); return true; })
             .sort((a,b) => a.priority - b.priority || a.name.length - b.name.length);
}

function normalizeArea(t) {
  const name = t['name:nb'] || t['name:no'] || t.name;
  if (!name) return null;
  let priority = 100, kind = 'annet område', sourceTag = '';
  if (t.place === 'neighbourhood') { priority = 1; kind = 'nabolag'; sourceTag = 'place=neighbourhood'; }
  else if (t.place === 'quarter') { priority = 2; kind = 'byområde/kvartal'; sourceTag = 'place=quarter'; }
  else if (t.place === 'suburb') { priority = 3; kind = 'bydel/forstad'; sourceTag = 'place=suburb'; }
  else if (['hamlet','village','town'].includes(t.place)) { priority = 4; kind = 'sted/bosetning'; sourceTag = 'place=' + t.place; }
  else if (t.leisure === 'park') { priority = 5; kind = 'park'; sourceTag = 'leisure=park'; }
  else if (t.landuse) { priority = 8; kind = 'arealbruk'; sourceTag = 'landuse=' + t.landuse; }
  else if (t.natural) { priority = 9; kind = 'naturflate'; sourceTag = 'natural=' + t.natural; }
  else if (t.boundary === 'administrative') { priority = 20 + Number(t.admin_level || 20); kind = 'administrativ grense'; sourceTag = 'boundary=administrative'; }
  else if (t.boundary) { priority = 30; kind = 'grense'; sourceTag = 'boundary=' + t.boundary; }
  return { name, kind, priority, sourceTag, admin_level: t.admin_level || '' };
}

async function lookupNominatim(lat, lon) {
  const params = new URLSearchParams({ format: 'jsonv2', lat, lon, addressdetails: '1', namedetails: '1', extratags: '1', zoom: '15', 'accept-language': 'nb,no,en' });
  const res = await fetch('https://nominatim.openstreetmap.org/reverse?' + params.toString());
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  return await res.json();
}

async function lookupSSR(lat, lon, radius = 350) {
  const utm = latLonToUTM(lat, lon);
  const params = new URLSearchParams({ nord: String(Math.round(utm.northing)), ost: String(Math.round(utm.easting)), radius: String(radius), koordsys: String(25800 + utm.zone), treffPerSide: '20', side: '1' });
  const res = await fetch('https://ws.geonorge.no/stedsnavn/v1/punkt?' + params.toString());
  if (!res.ok) throw new Error('SSR HTTP ' + res.status);
  const data = await res.json();
  const list = data.navn || data.stedsnavn || data.skrivemater || [];
  return list.map(x => {
    const skriv = x.stedsnavn || x.skrivemåte || x.skrivemate || x.navn || x.skrivemater?.[0]?.skrivemåte || x.skrivemater?.[0]?.skrivemate;
    const type = x.navneobjekttype || x.objekttype || x.stedstatus || x.type || '';
    const dist = x.meterFraPunkt || x.avstand || x.distance;
    return { navn: skriv, type, distance: Number(dist) };
  }).filter(x => x.navn);
}

// WGS84 latitude/longitude to UTM, sufficient for SSR point search.
function latLonToUTM(lat, lon) {
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e = Math.sqrt(f * (2 - f));
  const zone = Math.floor((lon + 180) / 6) + 1;
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const n = f / (2 - f);
  const A = a / (1 + n) * (1 + n*n/4 + n**4/64);
  const alpha = [null,
    n/2 - 2*n*n/3 + 5*n**3/16,
    13*n*n/48 - 3*n**3/5,
    61*n**3/240
  ];
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - (2*Math.sqrt(n)/(1+n)) * Math.atanh((2*Math.sqrt(n)/(1+n)) * Math.sin(phi)));
  const xiPrime = Math.atan2(t, Math.cos(lambda - lambda0));
  const etaPrime = Math.atanh(Math.sin(lambda - lambda0) / Math.sqrt(1 + t*t));
  let xi = xiPrime, eta = etaPrime;
  for (let j = 1; j <= 3; j++) {
    xi += alpha[j] * Math.sin(2*j*xiPrime) * Math.cosh(2*j*etaPrime);
    eta += alpha[j] * Math.cos(2*j*xiPrime) * Math.sinh(2*j*etaPrime);
  }
  return { zone, easting: 500000 + k0 * A * eta, northing: k0 * A * xi };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
