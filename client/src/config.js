// External resources. Versions are pinned; the import map in index.html must match.
export const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const MODELS = {
  detector: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
export const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
export const WIKI = (lang) => `https://${lang}.wikipedia.org/w/api.php`;

export const YEAR_MIN = 1880;
export const YEAR_MAX = 2050;
