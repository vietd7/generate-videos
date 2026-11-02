import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { RENDER_CONFIG } from "./render-config.js";

// ─── ffprobe ──────────────────────────────────────────────────────────────────

/** Lấy duration (giây) của video input bằng ffprobe (chỉ đọc header, không decode). */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code} for ${videoPath}`));
      const dur = parseFloat(Buffer.concat(chunks).toString().trim());
      if (!Number.isFinite(dur) || dur <= 0) return reject(new Error(`ffprobe: invalid duration "${dur}" for ${videoPath}`));
      resolve(dur);
    });
  });
}

// ─── Filter builders ──────────────────────────────────────────────────────────

function getWarmToneFilter() {
  const s = RENDER_CONFIG.WARM_TONE_STRENGTH;
  return `colorbalance=rm=${s}:gm=0:bm=-${s}`;
}

function buildVideoFilterChain() {
  const { VIDEO_SPEED, ZOOM_FACTOR, OUTPUT_WIDTH, OUTPUT_HEIGHT } = RENDER_CONFIG;
  const flip = `[0:v]hflip`;
  const speed = `setpts=PTS/${VIDEO_SPEED}`;
  const warm = `${getWarmToneFilter()},eq=contrast=1.08:saturation=1.08`;
  // denoise trước khi upscale để tránh sharpen khuếch đại noise từ source
  const denoise = `hqdn3d=1.5:1.5:6:6`;
  // Zoom: scale lên rồi crop center về đúng tỉ lệ gốc (lách trùng video)
  const zoom = `scale=iw*${ZOOM_FACTOR}:ih*${ZOOM_FACTOR}:flags=lanczos,crop=iw/${ZOOM_FACTOR}:ih/${ZOOM_FACTOR}`;
  // Contain: scale vừa khung giữ nguyên tỉ lệ (decrease = không vượt quá output), pad viền đen phần thiếu
  const contain = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
  const sharpen = `unsharp=3:3:0.8[vout]`;
  return `${flip},${speed},${warm},${denoise},${zoom},${contain},${sharpen}`;
}

export function buildFilterComplex() {
  const v = buildVideoFilterChain();
  return `${v};[1:a]atempo=${RENDER_CONFIG.VIDEO_SPEED}[aout]`;
}

// ─── FFmpeg runner ────────────────────────────────────────────────────────────

function getFfmpegArgs(inputVideoPath, audioPath, outputVideoPath, outputDuration) {
  return [
    "-i", inputVideoPath,
    "-i", audioPath,
    "-filter_complex", buildFilterComplex(),
    "-map", "[vout]",
    "-map", "[aout]",
    // Dùng -t thay -shortest để đảm bảo output không vượt quá độ dài video gốc.
    // -shortest + filter_complex + atempo không reliable (buffer flush non-deterministic).
    "-t", String(outputDuration),
    "-c:v", "libx264",
    "-preset", "medium",
    "-threads", "2",
    "-crf", String(RENDER_CONFIG.VIDEO_CRF),
    "-c:a", "aac",
    "-b:a", RENDER_CONFIG.AUDIO_BITRATE,
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputVideoPath,
  ];
}

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // Chạy FFmpeg qua `nice -n 10` để OS ưu tiên Chrome/hệ thống hơn khi tranh CPU
    const ff = spawn("nice", ["-n", "10", "ffmpeg", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    ff.stderr?.on("data", (d) => chunks.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errText = Buffer.concat(chunks).toString("utf8").trim().slice(-2000);
        reject(new Error(`ffmpeg exited ${code}${errText ? `: ${errText}` : ""}`));
      }
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Render một video: download input + audio → output mp4 */
export async function renderAffVideo({ inputVideoPath, audioPath, outputVideoPath }) {
  await fs.promises.mkdir(path.dirname(outputVideoPath), { recursive: true });
  // Lấy duration input để tính output duration chính xác (input / speed = output)
  const inputDuration = await getVideoDuration(inputVideoPath);
  const outputDuration = inputDuration / RENDER_CONFIG.VIDEO_SPEED;
  const args = getFfmpegArgs(inputVideoPath, audioPath, outputVideoPath, outputDuration);
  await runFfmpeg(args);
  return { outputVideoPath };
}
