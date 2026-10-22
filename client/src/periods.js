// What a place looked like in each era: clothing, transport, street furniture and photographic
// look, per region. The live view uses the visual fields; the AI snapshot uses the `prompt` text.

export const ERAS = [
  { key: 'e1880', year: 1880, start: 1850, end: 1899 },
  { key: 'e1920', year: 1920, start: 1900, end: 1944 },
  { key: 'e1970', year: 1970, start: 1945, end: 1997 },
  { key: 'now', year: 2026, start: 1998, end: 2037 },
  { key: 'e2050', year: 2050, start: 2038, end: 2100 },
];
export const eraFor = (year) => ERAS.find((e) => year >= e.start && year <= e.end) || ERAS[ERAS.length - 1];

const LEVANT_CC = ['il', 'ps', 'lb', 'sy', 'jo'];
export const REGIONS = {
  levant: { label: 'ארץ ישראל והלבנט', en: 'the Levant' },
  europe: { label: 'אירופה', en: 'Europe' },
  north_america: { label: 'צפון אמריקה', en: 'North America' },
  global: { label: 'אזור כללי', en: 'a city' },
};
export function regionFor(lat, lng, countryCode) {
  const cc = (countryCode || '').toLowerCase();
  if (LEVANT_CC.includes(cc)) return 'levant';
  if (cc) {
    if (['us', 'ca', 'mx'].includes(cc)) return 'north_america';
  }
  if (lat > 29 && lat < 37.5 && lng > 34 && lng < 42.5) return 'levant';
  if (lat > 35 && lat < 72 && lng > -25 && lng < 45) return 'europe';
  if (lat > 14 && lat < 72 && lng > -170 && lng < -50) return 'north_america';
  return 'global';
}

/* Costume variants: `garment` is drawn over the body, `headwear` on the head, and `recolor`
   re-dyes the clothing pixels the garment does not cover (trousers, sleeves). */
const C = {
  galabiya: (w, fabric) => ({ w, garment: 'robe', pattern: 'stripes', fabric }),
  thobe: (w) => ({ w, garment: 'dress', pattern: 'embroidery', fabric: ['#1d2233', '#2a1f2d', '#3a2a22'], headwear: 'headscarf', hatColor: '#efe9dc', recolor: ['#2a2430'] }),
};

const LEVANT = {
  e1880: {
    label: 'התקופה העות׳מאנית', blurb: 'גלביות, תרבושים וכאפיות. חמורים, גמלים וכרכרות על דרכי עפר.',
    grade: 'albumen',
    costumes: [
      { ...C.galabiya(3, ['#e9e1cf', '#d8cdb4', '#6c5a44']), headwear: 'tarbush', recolor: ['#5b4a38'] },
      { ...C.galabiya(3, ['#3d4a66', '#2f3a52', '#6b5d48']), headwear: 'keffiyeh', hatColor: '#f1ece2', recolor: ['#3a3128'] },
      { ...C.galabiya(2, ['#8a6a46', '#6d5236', '#c9b48a']), headwear: 'keffiyeh', hatColor: '#efe8da', recolor: ['#4a3a2a'] },
      C.thobe(2),
    ],
    transport: { motorcycle: 'donkey', bicycle: 'donkey', car: 'carriage', bus: 'wagon', truck: 'cart', mount: 'donkey' },
    furniture: { bench: 'stone', chair: 'stool', 'traffic light': 'lamp_oil', 'parking meter': 'remove', 'stop sign': 'remove', 'fire hydrant': 'remove' },
    prompt: {
      attire: 'late Ottoman Palestine clothing: men in long striped galabiya robes with a red tarbush fez or a white keffiyeh held by a black agal; women in long dark embroidered thobe dresses with white head veils',
      transport: 'donkeys, camels and horse-drawn carriages (hantur)',
      furniture: 'rough limestone blocks and wooden stools instead of benches',
      street: 'unpaved sandy streets, pale limestone buildings with arched windows and wooden shutters, no electricity, no signs, no asphalt, no modern objects',
      photo: 'an 1880s albumen print photograph, sepia toned, soft focus, slight vignette and paper texture',
    },
  },
  e1920: {
    label: 'תקופת המנדט הבריטי', blurb: 'חליפות ותרבושים, כובעי פדורה ושמלות קלוש. מכוניות ראשונות לצד כרכרות.',
    grade: 'ortho',
    costumes: [
      { w: 3, garment: 'suit', pattern: 'tweed', fabric: ['#3a3a3c', '#4a4238', '#2f3440'], headwear: 'tarbush', recolor: ['#2c2c2e'] },
      { w: 3, garment: 'suit', pattern: 'tweed', fabric: ['#5a5146', '#3c3f46', '#6b6458'], headwear: 'fedora', hatColor: '#2b2622', recolor: ['#34302c'] },
      { w: 2, garment: 'coat', pattern: 'plain', fabric: ['#b8ad8f', '#a39878'], headwear: 'flatcap', hatColor: '#4a4238', recolor: ['#3a352e'] },
      { w: 2, garment: 'dress', pattern: 'plain', fabric: ['#e3dccb', '#7a6a58', '#2e2a2a'], headwear: 'cloche', hatColor: '#3a302a', recolor: ['#2e2a2a'] },
      { ...C.galabiya(1, ['#e9e1cf', '#d8cdb4']), headwear: 'keffiyeh', hatColor: '#f1ece2', recolor: ['#5b4a38'] },
    ],
    transport: { motorcycle: 'donkey', bicycle: null, car: 'vintage_car', bus: 'bus_old', truck: 'cart', mount: 'donkey' },
    furniture: { bench: 'bench_wood', chair: 'stool', 'traffic light': 'lamp_gas', 'parking meter': 'remove', 'stop sign': 'remove', 'fire hydrant': 'remove' },
    prompt: {
      attire: 'British Mandate Palestine 1920s clothing: men in wool three-piece suits with tarbush fez, fedora or flat cap; women in drop-waist 1920s dresses with cloche hats; some villagers in galabiya and keffiyeh',
      transport: 'Ford Model T era cars, horse-drawn carts, donkeys and early buses',
      furniture: 'wooden slat benches and gas street lamps',
      street: 'stone buildings with shutters, simple painted shop signs in Arabic, Hebrew and English, dirt and cobblestone roads, no modern objects',
      photo: 'a 1920s black and white orthochromatic photograph with film grain, light scratches and soft contrast',
    },
  },
  e1970: {
    label: 'ישראל של שנות השבעים', blurb: 'כובעי טמבל, חולצות קצרות ושמלות פרחוניות. סוסיתא, פיאט ואוטובוסים ירוקים.',
    grade: 'kodachrome',
    costumes: [
      { w: 3, garment: 'none', headwear: 'kova', hatColor: '#c8b88a', recolor: ['#c9b27a', '#7d8f5a', '#d9d2bf', '#a5642f'] },
      { w: 3, garment: 'none', headwear: null, recolor: ['#c45a2c', '#6a8a3c', '#d9a441', '#3f6f9a', '#8a4f7a'] },
      { w: 2, garment: 'dress', pattern: 'floral', fabric: ['#e2a33b', '#c4562b', '#3f7f8f'], headwear: null, recolor: ['#5b3a2a'] },
    ],
    transport: { motorcycle: 'scooter', bicycle: null, car: 'car70', bus: 'bus70', truck: 'car70', mount: 'scooter' },
    furniture: { bench: 'bench_concrete', chair: null },
    prompt: {
      attire: '1970s Israeli clothing: short-sleeved button shirts, khaki shorts and trousers, sandals, kova tembel bucket hats, women in floral A-line dresses and flared trousers',
      transport: 'Susita, Peugeot 404 and Fiat 124 cars, Vespa scooters, green and cream buses',
      furniture: 'concrete and wooden municipal benches',
      street: '1970s storefronts with hand-painted Hebrew signs, fewer and older cars, no smartphones, no modern LED signage',
      photo: 'a faded 1970s Kodachrome colour photograph with warm highlights, slightly lifted blacks and fine grain',
    },
  },
  e2050: {
    label: 'תרחיש עתידי', blurb: 'בדים חכמים זוהרים, משקפי מציאות רבודה, רכבים אוטונומיים מרחפים.',
    grade: 'future',
    costumes: [
      { w: 3, garment: 'coat', pattern: 'smart', fabric: ['#e6eef0', '#c9d6dc', '#2b3a42'], headwear: 'visor', recolor: ['#dfe7ea', '#2b3a42'] },
      { w: 2, garment: 'none', headwear: 'visor', recolor: ['#9be7d8', '#c7d2fe', '#f0abfc'] },
    ],
    transport: { motorcycle: 'hoverbike', bicycle: 'hoverbike', car: 'pod', bus: 'pod', truck: 'pod', mount: 'hoverbike' },
    furniture: { bench: 'bench_future', chair: 'bench_future', 'traffic light': null },
    prompt: {
      attire: 'plausible 2050 clothing: minimalist smart fabrics with subtle light-emitting trims, lightweight AR glasses',
      transport: 'quiet autonomous electric pods and hover bikes',
      furniture: 'sleek smart benches with integrated planters',
      street: 'the same buildings retrofitted with vertical gardens and solar glass, clean streets, trees, no fossil fuel vehicles',
      photo: 'a crisp, slightly cool-toned photograph',
    },
  },
};

const EUROPE = {
  e1880: {
    label: 'התקופה הוויקטוריאנית', blurb: 'מעילי פראק, מגבעות ושמלות באסל. כרכרות ואומניבוסים רתומים לסוסים.',
    grade: 'albumen',
    costumes: [
      { w: 3, garment: 'coat', pattern: 'plain', fabric: ['#24221f', '#2f2a26', '#3a3530'], headwear: 'tophat', hatColor: '#151413', recolor: ['#2a2724'] },
      { w: 2, garment: 'coat', pattern: 'tweed', fabric: ['#4a4238', '#5a5040'], headwear: 'bowler', hatColor: '#1d1b19', recolor: ['#38322b'] },
      { w: 3, garment: 'dress', pattern: 'plain', fabric: ['#3b2a3a', '#2a3340', '#5a3a2a'], headwear: 'bonnet', hatColor: '#e8e0cf', recolor: ['#2a2424'] },
    ],
    transport: { motorcycle: 'horse', bicycle: 'horse', car: 'carriage', bus: 'wagon', truck: 'cart', mount: 'horse' },
    furniture: { bench: 'bench_iron', chair: 'stool', 'traffic light': 'lamp_gas', 'parking meter': 'remove', 'stop sign': 'remove', 'fire hydrant': 'remove' },
    prompt: {
      attire: 'Victorian 1880s clothing: men in frock coats, waistcoats and top hats or bowler hats; women in long bustle dresses with bonnets',
      transport: 'horse-drawn carriages, hansom cabs and horse omnibuses',
      furniture: 'cast iron benches and gas lamps',
      street: 'cobblestone streets, period shopfronts with painted signs, no cars, no electric lights, no modern objects',
      photo: 'an 1880s albumen print photograph, sepia toned, soft focus, slight vignette',
    },
  },
  e1920: {
    label: 'שנות העשרים', blurb: 'חליפות, כובעי מצחייה ושמלות קלוש. מכוניות מודל T וחשמליות.',
    grade: 'ortho',
    costumes: [
      { w: 3, garment: 'suit', pattern: 'tweed', fabric: ['#3a3a3c', '#4a4238', '#2f3440'], headwear: 'fedora', hatColor: '#2b2622', recolor: ['#2c2c2e'] },
      { w: 2, garment: 'coat', pattern: 'tweed', fabric: ['#5a5146', '#3c3f46'], headwear: 'flatcap', hatColor: '#4a4238', recolor: ['#34302c'] },
      { w: 2, garment: 'dress', pattern: 'plain', fabric: ['#e3dccb', '#7a6a58', '#2e2a2a'], headwear: 'cloche', hatColor: '#3a302a', recolor: ['#2e2a2a'] },
    ],
    transport: { motorcycle: 'bicycle_old', bicycle: 'bicycle_old', car: 'vintage_car', bus: 'bus_old', truck: 'vintage_car', mount: 'bicycle_old' },
    furniture: { bench: 'bench_wood', chair: null, 'traffic light': 'lamp_gas', 'parking meter': 'remove' },
    prompt: {
      attire: '1920s clothing: men in wool suits with fedoras or flat caps, women in drop-waist dresses with cloche hats',
      transport: 'Ford Model T era cars, trams, early buses and bicycles',
      furniture: 'wooden slat benches and gas street lamps',
      street: '1920s shopfronts and enamel signs, cobblestones, no modern objects',
      photo: 'a 1920s black and white photograph with film grain and light scratches',
    },
  },
  e1970: {
    label: 'שנות השבעים', blurb: 'מכנסיים מתרחבים, צווארונים רחבים וצבעים חמים. חיפושיות ופיאטים.',
    grade: 'kodachrome',
    costumes: [
      { w: 3, garment: 'none', headwear: null, recolor: ['#c45a2c', '#6a8a3c', '#d9a441', '#3f6f9a', '#8a4f7a'] },
      { w: 2, garment: 'dress', pattern: 'floral', fabric: ['#e2a33b', '#c4562b', '#3f7f8f'], headwear: null, recolor: ['#5b3a2a'] },
    ],
    transport: { motorcycle: 'scooter', bicycle: null, car: 'car70', bus: 'bus70', truck: 'car70', mount: 'scooter' },
    furniture: { bench: 'bench_concrete', chair: null },
    prompt: {
      attire: '1970s clothing: flared trousers, wide collars, earth-tone knitwear, floral dresses',
      transport: 'Volkswagen Beetles, Fiat 124s, Citroën DS cars and Vespa scooters',
      furniture: 'concrete and wooden benches',
      street: '1970s shopfronts and signs, older cars, no smartphones, no LED screens',
      photo: 'a faded 1970s Kodachrome colour photograph with warm highlights and fine grain',
    },
  },
};
EUROPE.e2050 = LEVANT.e2050;

const NORTH_AMERICA = {
  e1880: {
    ...EUROPE.e1880,
    label: 'סוף המאה ה-19', blurb: 'וסטים, כובעי באולר וכובעי בוקרים. כרכרות ועגלות רתומות לסוסים.',
    costumes: [
      { w: 3, garment: 'coat', pattern: 'tweed', fabric: ['#4a4238', '#3a3530'], headwear: 'bowler', hatColor: '#1d1b19', recolor: ['#38322b'] },
      { w: 2, garment: 'coat', pattern: 'plain', fabric: ['#6b5a44', '#5a4a38'], headwear: 'cowboy', hatColor: '#6b5236', recolor: ['#3a3128'] },
      { w: 2, garment: 'dress', pattern: 'plain', fabric: ['#3b2a3a', '#2a3340'], headwear: 'bonnet', hatColor: '#e8e0cf', recolor: ['#2a2424'] },
    ],
    transport: { motorcycle: 'horse', bicycle: 'horse', car: 'carriage', bus: 'wagon', truck: 'wagon', mount: 'horse' },
    prompt: { ...EUROPE.e1880.prompt, attire: '1880s American clothing: men in vests, frock coats, bowler or wide-brim hats; women in long bustle dresses with bonnets', transport: 'horse-drawn buggies, wagons and riders on horseback', furniture: 'wooden benches and hitching posts', street: 'wooden sidewalks, dirt roads, brick and timber storefronts with painted signs, no modern objects' },
  },
  e1920: EUROPE.e1920,
  e1970: { ...EUROPE.e1970, prompt: { ...EUROPE.e1970.prompt, transport: 'large 1970s American sedans, station wagons and muscle cars' } },
  e2050: LEVANT.e2050,
};

const PRESENT = {
  label: 'היום', blurb: 'המצלמה מציגה את המקום כפי שהוא עכשיו. גררו את הסרגל לעבר או לעתיד.',
  grade: 'none', costumes: [], transport: {}, furniture: {}, prompt: null,
};

const TABLES = { levant: LEVANT, europe: EUROPE, north_america: NORTH_AMERICA, global: EUROPE };

export function profileFor(regionKey, year) {
  const era = eraFor(year);
  const p = era.key === 'now' ? PRESENT : (TABLES[regionKey] || EUROPE)[era.key];
  return { ...p, era, region: regionKey };
}

/** Stable pick of a weighted variant by a numeric seed (e.g. a track id). */
export function pickVariant(list, seed) {
  if (!list.length) return null;
  const total = list.reduce((s, v) => s + (v.w || 1), 0);
  let x = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * total;
  for (const v of list) { x -= v.w || 1; if (x <= 0) return v; }
  return list[0];
}
