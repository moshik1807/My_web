// What a place looked like in each era, per region: the photographic look of the live view
// (`grade`) and the description the AI uses to rebuild the whole scene (`prompt`).

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

const LEVANT = {
  e1880: {
    label: 'התקופה העות׳מאנית', blurb: 'גלביות, תרבושים וכאפיות. חמורים, גמלים וכרכרות על דרכי עפר.',
    grade: 'albumen',
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
    prompt: { ...EUROPE.e1880.prompt, attire: '1880s American clothing: men in vests, frock coats, bowler or wide-brim hats; women in long bustle dresses with bonnets', transport: 'horse-drawn buggies, wagons and riders on horseback', furniture: 'wooden benches and hitching posts', street: 'wooden sidewalks, dirt roads, brick and timber storefronts with painted signs, no modern objects' },
  },
  e1920: EUROPE.e1920,
  e1970: { ...EUROPE.e1970, prompt: { ...EUROPE.e1970.prompt, transport: 'large 1970s American sedans, station wagons and muscle cars' } },
  e2050: LEVANT.e2050,
};

const PRESENT = {
  label: 'היום', blurb: 'המצלמה מציגה את המקום כפי שהוא עכשיו. גררו את הסרגל לעבר או לעתיד.',
  grade: 'none', prompt: null,
};

const TABLES = { levant: LEVANT, europe: EUROPE, north_america: NORTH_AMERICA, global: EUROPE };

export function profileFor(regionKey, year) {
  const era = eraFor(year);
  const p = era.key === 'now' ? PRESENT : (TABLES[regionKey] || EUROPE)[era.key];
  return { ...p, era, region: regionKey };
}

