/**
 * Chuẩn hóa header cột để so khớp (trim, lower, bỏ ký tự ẩn).
 */
export function normalizeHeaderCell(c) {
  return String(c ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string[]} headers - hàng header thô (row 0)
 * @param {string[]} aliases - danh sách tên có thể có trên sheet
 * @returns {number} chỉ số cột 0-based, hoặc -1
 */
export function findHeaderIndex(headers, aliases) {
  const normalizedAliases = aliases.map((a) => normalizeHeaderCell(a));
  return headers.findIndex((h) => normalizedAliases.includes(normalizeHeaderCell(h)));
}
