import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// ─── Extension / content-type helpers ────────────────────────────────────────

function guessExtFromUrlAndType(videoUrl, contentType) {
  const pathname = (() => {
    try { return new URL(videoUrl).pathname.toLowerCase(); } catch { return ""; }
  })();
  if (pathname.endsWith(".mp4")) return "mp4";
  if (pathname.endsWith(".webm")) return "webm";
  if (pathname.endsWith(".mov")) return "mov";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("quicktime")) return "mov";
  return "mp4";
}

// ─── Download ─────────────────────────────────────────────────────────────────

const DOWNLOAD_RETRIES = 2;        // số lần retry tối đa sau lần đầu thất bại
const DOWNLOAD_RETRY_DELAY_MS = 3000; // chờ 3 giây trước mỗi lần retry

/** Các error code mạng thoáng qua — đáng retry (DNS fail, connection reset, timeout) */
function isRetryableNetworkError(err) {
  const cause = err?.cause;
  const code = cause?.code ?? cause?.errno ?? "";
  return ["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(code);
}

/**
 * Tải video từ URL trực tiếp (single stream).
 * Không hỗ trợ HLS (.m3u8).
 * Tự retry khi gặp lỗi mạng thoáng qua (ENOTFOUND, ECONNRESET, v.v.).
 */
export async function downloadVideoToPath(videoUrl, destPath) {
  let lastErr;

  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`[download] retry ${attempt}/${DOWNLOAD_RETRIES} sau ${DOWNLOAD_RETRY_DELAY_MS}ms — ${videoUrl.slice(0, 80)}...`);
      await new Promise((r) => setTimeout(r, DOWNLOAD_RETRY_DELAY_MS));
    }

    try {
      const res = await fetch(videoUrl, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
      });
      if (!res.ok) throw new Error(`video download failed: HTTP ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error("video download: empty response body");
      await mkdir(path.dirname(destPath), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
      return { destPath, contentType: res.headers.get("content-type") };
    } catch (err) {
      lastErr = err;
      // Chỉ retry khi là lỗi mạng thoáng qua, không retry HTTP error (403, 404...)
      if (!isRetryableNetworkError(err) || attempt >= DOWNLOAD_RETRIES) break;
    }
  }

  throw lastErr;
}

// ─── Filename helpers ─────────────────────────────────────────────────────────

/** Chuẩn hoá tiêu đề thành slug an toàn cho tên file */
export function slugifyForFilename(s, maxLen = 80) {
  const raw = String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return raw || "item";
}

function stripUnsafePathParts(name) {
  return String(name).replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * Đặt tên file tải về.
 * - Mặc định: `{id}.{ext}`
 * - `template`: ví dụ `"{id}-{slug}.{ext}"`. Placeholder: {id}, {slug}, {ext}.
 * - `videoFileBase`: nếu có thì ưu tiên dùng `"{videoFileBase}.{ext}"`.
 */
export function buildVideoFilename(id, videoUrl, contentTypeHint, options = {}) {
  const ext = guessExtFromUrlAndType(videoUrl, contentTypeHint);
  const slug = slugifyForFilename(options.title ?? "");
  const baseOverride =
    typeof options.videoFileBase === "string" && options.videoFileBase.trim() !== ""
      ? stripUnsafePathParts(options.videoFileBase.trim())
      : null;
  if (baseOverride) return `${baseOverride}.${ext}`;

  const template =
    typeof options.template === "string" && options.template.trim() !== ""
      ? options.template.trim()
      : "{id}.{ext}";

  let name = template
    .replace(/\{id\}/g, String(id))
    .replace(/\{slug\}/g, slug)
    .replace(/\{ext\}/g, ext);
  if (!/\{ext\}/.test(template) && !name.endsWith(`.${ext}`)) name = `${name}.${ext}`;
  return stripUnsafePathParts(name).replace(/\s/g, "-");
}
