/** Thư mục audio mặc định; override bằng env AFF_AUDIOS_DIR */
export const DEFAULT_AUDIOS_DIR = "/Users/vietd7/data/Aff/generate-video/audios";

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".mp4"];

export const RENDER_CONFIG = {
  OUTPUT_WIDTH: 1080,
  OUTPUT_HEIGHT: 1920,
  VIDEO_SPEED: 1.1,
  ZOOM_FACTOR: 1.07,
  WARM_TONE_STRENGTH: 0.1,
  VIDEO_CRF: 18,
  AUDIO_BITRATE: "160k",
};

export function resolveAudiosDir() {
  const fromEnv = process.env.AFF_AUDIOS_DIR?.trim();
  return fromEnv ? fromEnv : DEFAULT_AUDIOS_DIR;
}
