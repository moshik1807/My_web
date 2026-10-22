// Rebuilds the whole camera view as it would have looked in the chosen year, indoors or out:
// buildings, streets, people and clothes, vehicles, furniture and objects. Three engines: a free public model (no key, slower, daily quota),
// or Gemini / OpenAI with the user's own key, kept only in this browser.
import { GRADIO_CLIENT, FREE_SPACE } from './config.js';

const SETTINGS_KEY = 'vw:ai';
export const PROVIDERS = {
  free: { label: 'חינמי (FLUX Kontext ב-Hugging Face)', model: FREE_SPACE, keyUrl: 'https://huggingface.co/settings/tokens', keyLabel: 'טוקן של Hugging Face (לא חובה, מגדיל את המכסה)' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash-image', keyUrl: 'https://aistudio.google.com/apikey', keyLabel: 'מפתח API' },
  openai: { label: 'OpenAI', model: 'gpt-image-1', keyUrl: 'https://platform.openai.com/api-keys', keyLabel: 'מפתח API' },
};

export function loadSettings() {
  const base = { provider: 'free', key: '', model: '' };
  try { const s = { ...base, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; return PROVIDERS[s.provider] ? s : base; }
  catch { return base; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

// What everyday objects become, indoors or out (computers, phones, lights, furniture...).
const OBJECTS = {
  e1880: 'no electricity: computers, screens and keyboards become ledgers, inkwells and paper; phones disappear; electric lights become oil lamps and candles; modern furniture becomes heavy carved wood; plastic, metal and glass items become wood, brass, clay and woven baskets',
  e1920: 'computers and screens become typewriters, ledgers and paper files; phones become candlestick telephones; lighting is bare incandescent bulbs or brass fixtures; furniture is dark wood and leather; no plastic',
  e1970: 'computers become electric typewriters and calculators; screens become CRT television sets; phones become rotary dial phones; furniture is formica, teak and orange or brown upholstery; fluorescent tube lights',
  e2050: 'devices become sleek holographic and transparent displays; furniture is minimal, organic and modular; soft integrated lighting; plants built into surfaces',
};

/** Instruction for rebuilding the entire scene. `short` keeps it within FLUX's prompt budget. */
export function buildPrompt({ year, place, region, profile, short = false }) {
  const p = profile.prompt, objects = OBJECTS[profile.era.key] || '';
  if (short) {
    return `Transform this exact photo into a real photograph taken in ${year} in ${region}. Keep the same viewpoint, layout and the positions of people and objects, `
      + `but change everything in the scene to ${year}: ${objects}. People wear ${p.attire}. If outdoors: ${p.street}; vehicles become ${p.transport}. ${p.photo}.`;
  }
  return [
    `Transform this entire photo into the same scene as it would have looked in the year ${year}, at ${place} (${region}).`,
    'Whatever the scene is (a street, an office, a room, a shop, a landscape), keep the exact viewpoint, perspective and composition, and keep every person and object where it is, so the new picture lines up with the original.',
    `Then change everything visible to its ${year} equivalent, not just colours: ${objects}.`,
    `People keep their poses and positions but wear ${p.attire}.`,
    `If outdoors: ${p.street}. Vehicles become ${p.transport}. Street furniture: ${p.furniture}.`,
    `Nothing from after ${year} may remain: no phones, modern electronics, modern cars, plastic, LED lights or modern signage.`,
    `Photographic style: ${p.photo}. It must look like a real photograph, not an illustration.`,
  ].join('\n');
}

async function errorText(res) {
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg = j.error?.message || j.error || msg; } catch { /* not JSON */ }
  if (res.status === 400 && /key/i.test(msg)) return 'מפתח ה-API לא תקין. בדקו אותו בהגדרות.';
  if (res.status === 401 || res.status === 403) return 'מפתח ה-API נדחה. בדקו שהוא נכון ושיש לו הרשאה למודל.';
  if (res.status === 429) return 'חרגתם ממכסת השימוש של הספק. נסו שוב בעוד דקה, או בדקו את החיוב בחשבון.';
  return `הספק החזיר שגיאה: ${msg}`;
}

async function viaFreeSpace(dataUrl, prompt, token) {
  let mod;
  try { mod = await import(GRADIO_CLIENT); } catch { throw new Error('לא הצלחנו לטעון את הספרייה של המודל החינמי. בדקו את החיבור לאינטרנט.'); }
  const { Client, handle_file } = mod;
  const blob = await (await fetch(dataUrl)).blob();
  let client;
  try { client = await Client.connect(FREE_SPACE, token ? { hf_token: token } : undefined); }
  catch { throw new Error('המודל החינמי לא זמין כרגע (ייתכן שהוא בתחזוקה או עמוס). נסו שוב מאוחר יותר, או בחרו Gemini בהגדרות.'); }
  let r;
  try {
    r = await client.predict('/infer', { input_image: handle_file(blob), prompt, seed: 0, randomize_seed: true, guidance_scale: 2.5, steps: 28 });
  } catch (e) {
    const m = String(e?.message || e);
    if (/quota|ZeroGPU|exceeded/i.test(m)) throw new Error('נגמרה המכסה החינמית להיום. אפשר להוסיף בהגדרות טוקן חינמי של Hugging Face כדי לקבל מכסה גדולה יותר, או לנסות שוב מחר.');
    throw new Error(`המודל החינמי החזיר שגיאה: ${m.slice(0, 160)}`);
  }
  const out = Array.isArray(r.data) ? r.data[0] : r.data;
  const url = typeof out === 'string' ? out : out?.url;
  if (!url) throw new Error('המודל החינמי לא החזיר תמונה. נסו שוב.');
  return url;
}

/** Run the transformation. Returns an image URL (data: or https:). */
export async function transformImage({ dataUrl, year, place, region, profile, settings, serverBase, signal }) {
  const b64 = dataUrl.split(',')[1];
  const prompt = buildPrompt({ year, place, region, profile, short: !serverBase && settings.provider === 'free' });
  if (serverBase) {
    const res = await fetch(`${serverBase}/api/ai/transform`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mime: 'image/jpeg', prompt }) });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json(); return { url: `data:${j.mime};base64,${j.image}`, prompt };
  }
  if (settings.provider === 'free') return { url: await viaFreeSpace(dataUrl, prompt, settings.key), prompt };
  if (!settings.key) throw new Error('הספק שבחרתם צריך מפתח API. הוסיפו אותו בהגדרות, או חזרו למודל החינמי.');
  if (settings.provider === 'openai') {
    const form = new FormData();
    form.append('model', settings.model || PROVIDERS.openai.model); form.append('prompt', prompt);
    form.append('image', await (await fetch(dataUrl)).blob(), 'frame.jpg');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal, headers: { Authorization: `Bearer ${settings.key}` }, body: form });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json(); return { url: `data:image/png;base64,${j.data[0].b64_json}`, prompt };
  }
  const model = settings.model || PROVIDERS.gemini.model;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const j = await res.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const text = parts.find((p) => p.text)?.text;
    throw new Error(text ? `המודל לא החזיר תמונה: ${text.slice(0, 160)}` : 'המודל לא החזיר תמונה. נסו שוב.');
  }
  const d = img.inlineData || img.inline_data;
  return { url: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`, prompt };
}
