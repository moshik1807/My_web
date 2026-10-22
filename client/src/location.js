// Where the viewer is: GPS position, a readable place name (OpenStreetMap) and nearby
// historical places (Wikipedia). Region drives which period clothing and transport apply.
import { NOMINATIM, WIKI } from './config.js';
import { regionFor } from './periods.js';

export const PRESETS = [
  { id: 'jaffa', name: 'כיכר השעון, יפו', lat: 32.05497, lng: 34.75633, cc: 'il' },
  { id: 'jerusalem', name: 'שער יפו, ירושלים', lat: 31.77666, lng: 35.22788, cc: 'il' },
  { id: 'rothschild', name: 'שדרות רוטשילד, תל אביב', lat: 32.06385, lng: 34.77428, cc: 'il' },
  { id: 'haifa', name: 'המושבה הגרמנית, חיפה', lat: 32.81737, lng: 34.98832, cc: 'il' },
  { id: 'paris', name: 'Place de la Concorde, Paris', lat: 48.86561, lng: 2.32122, cc: 'fr' },
  { id: 'nyc', name: 'Times Square, New York', lat: 40.75801, lng: -73.98554, cc: 'us' },
];

const dist = (a, b) => {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function getJSON(url, timeout = 6000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export class LocationService {
  constructor() {
    this.pos = null;          // { lat, lng, accuracy, source: 'gps' | 'preset' }
    this.place = null;        // { name, city, country, countryCode }
    this.nearby = [];         // [{ title, dist, url }]
    this.region = 'levant';
    this.status = 'idle';     // idle | locating | ok | denied | unavailable
    this.listeners = new Set();
    this._watch = null; this._lastLookup = null; this._lastLookupAt = 0;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  startGPS() {
    if (!('geolocation' in navigator)) { this.status = 'unavailable'; this.emit(); return; }
    this.status = 'locating'; this.emit();
    this.stopGPS();
    this._watch = navigator.geolocation.watchPosition(
      (p) => this.setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'gps' }),
      (err) => { this.status = err.code === 1 ? 'denied' : 'unavailable'; this.emit(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }
  stopGPS() { if (this._watch !== null) navigator.geolocation.clearWatch(this._watch); this._watch = null; }

  usePreset(id) {
    const p = PRESETS.find((x) => x.id === id); if (!p) return;
    this.stopGPS();
    this.place = { name: p.name, city: '', country: '', countryCode: p.cc };
    this.setPosition({ lat: p.lat, lng: p.lng, accuracy: 0, source: 'preset' }, p.cc);
  }

  setPosition(pos, cc) {
    this.pos = pos; this.status = 'ok';
    this.region = regionFor(pos.lat, pos.lng, cc || this.place?.countryCode);
    this.emit();
    const moved = !this._lastLookup || dist(this._lastLookup, pos) > 120;
    if (moved && Date.now() - this._lastLookupAt > 8000) this.lookup(pos);
  }

  async lookup(pos) {
    this._lastLookup = pos; this._lastLookupAt = Date.now();
    const lang = 'he';
    const [geo, wiki] = await Promise.allSettled([
      pos.source === 'preset' ? Promise.resolve(null)
        : getJSON(`${NOMINATIM}?format=jsonv2&lat=${pos.lat}&lon=${pos.lng}&zoom=17&addressdetails=1&accept-language=${lang}`),
      getJSON(`${WIKI(lang)}?action=query&list=geosearch&gscoord=${pos.lat}|${pos.lng}&gsradius=2000&gslimit=6&format=json&origin=*`),
    ]);
    if (geo.status === 'fulfilled' && geo.value) {
      const a = geo.value.address || {};
      const street = a.road || a.pedestrian || a.square || a.neighbourhood || '';
      const city = a.city || a.town || a.village || a.municipality || '';
      this.place = {
        name: [street, city].filter(Boolean).join(', ') || geo.value.display_name?.split(',').slice(0, 2).join(',') || 'המיקום שלך',
        street, city, country: a.country || '', countryCode: a.country_code || '',
      };
      this.region = regionFor(pos.lat, pos.lng, this.place.countryCode);
    }
    if (wiki.status === 'fulfilled') {
      this.nearby = (wiki.value.query?.geosearch || []).map((g) => ({
        title: g.title, dist: Math.round(g.dist), url: `https://${lang}.wikipedia.org/?curid=${g.pageid}`,
      }));
    }
    this.emit();
  }

  /** English description for prompts, e.g. "Jaffa Clock Square area, Tel Aviv-Yafo, Israel". */
  describe() {
    const p = this.place;
    if (!p) return this.pos ? `the location ${this.pos.lat.toFixed(5)}, ${this.pos.lng.toFixed(5)}` : 'this street';
    return [p.name, p.country].filter(Boolean).join(', ');
  }
}
