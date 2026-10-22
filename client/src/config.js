// External services. Versions are pinned; the import map in index.html must match.
export const GRADIO_CLIENT = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.7.1/dist/browser.js';
export const FREE_SPACE = 'black-forest-labs/FLUX.1-Kontext-Dev';
export const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
export const WIKI = (lang) => `https://${lang}.wikipedia.org/w/api.php`;

export const YEAR_MIN = 1880;
export const YEAR_MAX = 2050;

// Scene parsing: SegFormer-B0 trained on ADE20K (150 classes), ONNX export.
export const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.all.min.mjs';
const HF = 'https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/main';
export const SEG_MODEL = { config: `${HF}/config.json`, fp32: `${HF}/onnx/model.onnx`, q8: `${HF}/onnx/model_quantized.onnx` };
