import path from "node:path";

/**
 * Trả về thư mục gốc aff từ localInputDir.
 * Ví dụ: .../vdstore/input → .../vdstore
 */
export function getAffBaseDir(localInputDir) {
  return path.dirname(path.resolve(localInputDir));
}

/**
 * Đường dẫn file output sau render.
 * Đặt cùng cấp với thư mục input, không dùng subfolder output.
 * Ví dụ: .../vdstore/42.mp4
 */
export function getRenderedVideoPath(localInputDir, id) {
  return path.resolve(getAffBaseDir(localInputDir), `${id}.mp4`);
}
