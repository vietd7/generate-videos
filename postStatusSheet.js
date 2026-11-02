/**
 * Ghi / đọc cột status trên Google Sheet cho từng bài đăng.
 * No-op nếu sheet không có cột status — backwards compatible với sheet cũ.
 */

import { STATUS_HEADER_ALIASES } from "./affSheetConstants.js";
import { findHeaderIndex } from "./sheetHeaders.js";
import {
  columnIndexToA1Letter,
  getSheetsApiSingleton,
  resolveWorksheetTitle,
  sheetTitleToA1Prefix,
  withRetry,
} from "./sheetsClient.js";

/**
 * Đếm số row có cột status = targetStatus.
 * Trả về 0 nếu sheet không có cột status.
 *
 * @param {string} spreadsheetId
 * @param {object} sheetHint - { sheetTitle?, sheetIndex? }
 * @param {string} targetStatus - e.g. "tiktok_ok"
 * @returns {Promise<number>}
 */
export async function countRowsByStatus(spreadsheetId, sheetHint, targetStatus) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const sheets = await getSheetsApiSingleton();

  const { data } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${prefix}A1:Z1000` }),
  );
  const values = data.values ?? [];
  if (values.length < 2) return 0;

  const headers = values[0] ?? [];
  const statusIdx = findHeaderIndex(headers, STATUS_HEADER_ALIASES);
  if (statusIdx === -1) return 0;

  let count = 0;
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    if (String(row[statusIdx] ?? "").trim() === targetStatus) count++;
  }
  return count;
}

/**
 * Ghi một giá trị status vào cột status của một row cụ thể.
 * Trả về { skipped: true } nếu sheet không có cột status.
 *
 * @param {string} spreadsheetId
 * @param {object} sheetResolveHint - { sheetTitle?, sheetIndex? }
 * @param {number} rowNumber - 1-based row number
 * @param {string} status - e.g. STATUS_QUEUED, STATUS_POSTED
 */
export async function writeRowStatus(spreadsheetId, sheetResolveHint, rowNumber, status) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const sheets = await getSheetsApiSingleton();

  // Read only the header row to find status column index
  const { data: headerData } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${prefix}1:1` }),
  );
  const headers = headerData.values?.[0] ?? [];
  const statusCol = findHeaderIndex(headers, STATUS_HEADER_ALIASES);
  if (statusCol === -1) {
    return { skipped: true, reason: "no status column on sheet" };
  }

  const colLetter = columnIndexToA1Letter(statusCol);
  const writeRange = `${prefix}${colLetter}${rowNumber}`;
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: [[status]] },
    }),
  );

  return { worksheetTitle, rowNumber, statusWritten: status, rangeWritten: writeRange };
}
