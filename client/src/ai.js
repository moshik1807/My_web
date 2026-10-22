// "Photo from the past": sends the current frame to an image-editing model with an instruction
// built from what the camera recognised, where the viewer is and which year they chose.
// The key stays in this browser (localStorage) or on the project's own server.

const SETTINGS_KEY = 'vw:ai';
export const PROVIDERS = {
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash-image', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { label: 'OpenAI', model: 'gpt-image-1', keyUrl: 'https://platform.openai.com/api-keys' },
};

export function loadSettings() {
  try { return { provider: 'gemini', key: '', model: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { provider: 'gemini', key: '', model: '' }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

const PLACE_WORDS = { left: 'on the left', right: 'on the right' };
const OBJ = { car: 'car', motorcycle: 'motorcycle', bicycle: 'bicycle', bus: 'bus', truck: 'truck', bench: 'bench', chair: 'chair', 'traffic light': 'traffic light', 'fire hydrant': 'fire hydrant', 'stop sign': 'stop sign', 'parking meter': 'parking meter' };
const KIND = {
  donkey: 'a donkey', horse: 'a horse', camel: 'a camel', carriage: 'a horse-drawn carriage', cart: 'a donkey cart', wagon: 'a horse-drawn wagon',
  vintage_car: 'a period-correct early automobile', car70: 'a period-correct 1970s car', bus_old: 'an early bus', bus70: 'a 1970s bus', scooter: 'a vintage Vespa scooter',
  bicycle_old: 'an old black bicycle', pod: 'an autonomous electric pod', hoverbike: 'a hover bike', stone: 'a rough limestone block', bench_wood: 'a wooden slat bench',
  bench_iron: 'a cast iron bench', bench_concrete: 'a 1970s concrete bench', bench_future: 'a sleek smart bench', stool: 'a wooden stool',
  lamp_oil: 'an oil street lantern', lamp_gas: 'a gas street lamp', remove: 'nothing (remove it)',
};

/** Build the edit instruction from the scene facts, the place and the era profile. */
export function buildPrompt({ year, place, region, profile, facts }) {
  const p = profile.prompt;
  const lines = [
    `Transform this photo so it looks like the same spot photographed in the year ${year}, at ${place} (${region}).`,
    'Keep the exact composition, camera angle, perspective, the street layout and building positions. Keep every person in the same place, pose and body position; keep their faces recognisable.',
    `Dress every person in ${p.attire}.`,
  ];
  const people = facts.people || [];
  people.forEach((x, i) => {
    if (x.riding) lines.push(`The person ${x.where} who is riding should ride ${KIND[profile.transport.mount] || 'a period-appropriate mount'} instead, dressed for the era.`);
    else if (x.sitting) lines.push(`The person ${x.where} who is sitting should sit on ${KIND[profile.furniture.bench] || 'a period-appropriate seat'}.`);
    else if (i < 6) lines.push(`Person ${i + 1} ${x.where}: same pose, period clothing.`);
  });
  for (const o of facts.objects || []) {
    if (!o.becomes || !OBJ[o.label]) continue;
    lines.push(`Replace the ${OBJ[o.label]} ${PLACE_WORDS[o.where] || o.where} with ${KIND[o.becomes] || o.becomes}, at the same position and scale.`);
  }
  lines.push(`Vehicles in this era are ${p.transport}. Street furniture: ${p.furniture}.`);
  lines.push(`The street itself: ${p.street}. Remove anything that did not exist in ${year} (phones, modern cars, plastic, LED screens, modern signs, power cables where inappropriate).`);
  lines.push(`Photographic style: ${p.photo}. The result must look like a real photograph, not an illustration.`);
  return lines.join('\n');
}

/** Grab the current source frame as a JPEG data URL, longest side ≤ maxSide. */
export function captureFrame(el, w, h, maxSide = 1280) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

async function errorText(res) {
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg = j.error?.message || j.error || msg; } catch { /* not JSON */ }
  if (res.status === 400 && /key/i.test(msg)) return 'מפתח ה-API לא תקין. בדקו אותו בהגדרות.';
  if (res.status === 401 || res.status === 403) return 'מפתח ה-API נדחה. בדקו שהוא נכון ושיש לו הרשאה למודל.';
  if (res.status === 429) return 'חרגתם ממכסת השימוש של הספק. נסו שוב בעוד דקה או בדקו את החיוב בחשבון.';
  return `הספק החזיר שגיאה: ${msg}`;
}

/** Run the edit. Returns a data URL of the generated image. */
export async function transformImage({ dataUrl, prompt, settings, serverBase, signal }) {
  const b64 = dataUrl.split(',')[1];
  if (serverBase) {
    const res = await fetch(`${serverBase}/api/ai/transform`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mime: 'image/jpeg', prompt }) });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json(); return `data:${j.mime};base64,${j.image}`;
  }
  if (!settings.key) throw new Error('צריך מפתח API כדי ליצור תמונה מהעבר. הוסיפו אותו בהגדרות.');
  if (settings.provider === 'openai') {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append('model', settings.model || PROVIDERS.openai.model); form.append('prompt', prompt); form.append('image', blob, 'frame.jpg');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal, headers: { Authorization: `Bearer ${settings.key}` }, body: form });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json(); return `data:image/png;base64,${j.data[0].b64_json}`;
  }
  const model = settings.model || PROVIDERS.gemini.model;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const j = await res.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const text = parts.find((p) => p.text)?.text;
    throw new Error(text ? `המודל לא החזיר תמונה: ${text.slice(0, 160)}` : 'המודל לא החזיר תמונה. נסו שוב או בחרו מודל אחר בהגדרות.');
  }
  const d = img.inlineData || img.inline_data;
  return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
}
