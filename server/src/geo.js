// Local east/south metric frame (x = east, z = south) anchored at a WGS84 origin.
// Equirectangular approximation: accurate to millimetres over the few hundred metres of a site.
const EARTH_R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function localToGeo(origin, x, z) {
  return {
    lat: origin.lat + deg(-z / EARTH_R),
    lng: origin.lng + deg(x / (EARTH_R * Math.cos(rad(origin.lat)))),
  };
}

export function geoToLocal(origin, lat, lng) {
  return {
    x: rad(lng - origin.lng) * EARTH_R * Math.cos(rad(origin.lat)),
    z: -rad(lat - origin.lat) * EARTH_R,
  };
}

export const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;
