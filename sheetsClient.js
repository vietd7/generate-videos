import path from "node:path";
import { google } from "googleapis";

import { AFF_LINK_HEADER_ALIASES } from "./affSheetConstants.js";
import { findHeaderIndex, normalizeHeaderCell } from "./sheetHeaders.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const AFF_LINK_KEY_SET = new Set(
  AFF_LINK_HEADER_ALIASES.map((a) => normalizeHeaderCell(a)),
);

let sheetsApiPromise;

/**
 * Retry a Sheets API call on rate-limit (429) or service-unavailable (503) errors.
 * Auth/validation errors (other 4xx) are not retried.
 */
export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const status = err?.status ?? err?.code;
      const isRetryable =
        status === 429 ||
        status === 503 ||
        String(err?.message ?? "").toLowerCase().includes("rate limit");
      if (!isRetryable) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
}

function getCredentialsPath() {
  return process.env.GOOGLE_CREDENTIALS_PATH
    ? path.resolve(process.env.GOOGLE_CREDENTIALS_PATH)
    : path.join(process.cwd(), "credentials.json");
}

async function getSheetsApi() {
  const auth = new google.auth.GoogleAuth({
    keyFile: getCredentialsPath(),
    scopes: SCOPES,
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export function getSheetsApiSingleton() {
  if (!sheetsApiPromise) sheetsApiPromise = getSheetsApi();
  return sheetsApiPromise;
}

/** A1 sheet prefix: quotes + escape ' per Google Sheets rules */
export function sheetTitleToA1Prefix(sheetTitle) {
  const escaped = String(sheetTitle).replace(/'/g, "''");
  return `'${escaped}'!`;
}

/**
 * @typedef {{ sheetTitle?: string | null, sheetIndex?: number | null }} SheetResolveHint
 */

/**
 * Pick worksheet title.
 * Order: hint.sheetTitle (if exists on file) → hint.sheetIndex → env SHEETS_TAB → env SHEETS_TAB_INDEX → first tab.
 */
export async function resolveWorksheetTitle(spreadsheetId, hint = {}) {
  const sheets = await getSheetsApiSingleton();
  const { data } = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }),
  );
  const titles = (data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t) => typeof t === "string" && t.length > 0);
  if (titles.length === 0) {
    throw new Error("spreadsheet has no sheets");
  }

  const explicitTitle = hint.sheetTitle != null && String(hint.sheetTitle).trim() !== "" ? String(hint.sheetTitle).trim() : null;
  if (explicitTitle) {
    if (!titles.includes(explicitTitle)) {
      throw new Error(`sheetTitle "${explicitTitle}" not found (tabs: ${titles.join(", ")})`);
    }
    return explicitTitle;
  }

  if (hint.sheetIndex != null && Number.isInteger(hint.sheetIndex)) {
    const i = hint.sheetIndex;
    if (i < 0 || i >= titles.length) {
      throw new Error(`sheetIndex ${i} out of range (spreadsheet has ${titles.length} tab(s))`);
    }
    return titles[i];
  }

  const want = process.env.SHEETS_TAB?.trim();
  if (want && titles.includes(want)) {
    return want;
  }
  if (want) {
    console.warn(`SHEETS_TAB "${want}" not in spreadsheet; using first tab "${titles[0]}"`);
  }

  const envIdxRaw = process.env.SHEETS_TAB_INDEX?.trim();
  if (envIdxRaw !== undefined && envIdxRaw !== "") {
    const envIdx = Number.parseInt(envIdxRaw, 10);
    if (Number.isInteger(envIdx) && envIdx >= 0 && envIdx < titles.length) {
      return titles[envIdx];
    }
  }

  return titles[0];
}

/** 0-based column index → A, B, …, Z, AA, … */
export function columnIndexToA1Letter(index0) {
  let idx = index0;
  let letters = "";
  while (idx >= 0) {
    letters = String.fromCharCode((idx % 26) + 65) + letters;
    idx = Math.floor(idx / 26) - 1;
  }
  return letters;
}

/**
 * Đọc sheet (tab đã resolve), tìm dòng đầu có cột id trống, tính id tiếp theo.
 * Dùng trước khi tải video (cần nextId cho tên file) rồi gọi writeAffIngestRow.
 */
export async function planAffIngestRow(spreadsheetId, sheetResolveHint) {
  const tab = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(tab);
  const sheets = await getSheetsApiSingleton();

  const readRange = `${prefix}A1:Z1000`;
  const { data: readData } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: readRange }),
  );
  const values = readData.values ?? [];
  if (values.length === 0) {
    throw new Error("sheet has no header row");
  }

  const headers = (values[0] ?? []).map((h) => normalizeHeaderCell(h));
  const idCol = headers.indexOf("id");
  if (idCol === -1) {
    throw new Error('header row must include column "id"');
  }

  let maxId = 0;
  let targetDataRow1Based = null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const idCell = row[idCol] != null ? String(row[idCol]).trim() : "";
    if (idCell !== "" && /^\d+$/.test(idCell)) {
      maxId = Math.max(maxId, Number.parseInt(idCell, 10));
    }
    if (idCell === "" && targetDataRow1Based === null) {
      targetDataRow1Based = r + 1;
    }
  }

  if (targetDataRow1Based === null) {
    targetDataRow1Based = values.length + 1;
  }

  const nextId = maxId === 0 ? 1 : maxId + 1;
  const headerKeys = (values[0] ?? []).map((h) => String(h ?? "").trim());

  return {
    nextId,
    targetDataRow1Based,
    headerKeys,
    worksheetTitle: tab,
  };
}

function buildRowValues(headerKeys, body) {
  return headerKeys.map((rawName) => {
    const key = normalizeHeaderCell(rawName);
    switch (key) {
      case "id":
        return body.id ?? "";
      case "product_url":
        return body.url ?? "";
      case "video_url":
        return body.videoSrc ?? "";
      case "video_local":
        return body.videoLocal ?? "";
      case "title":
        return body.title ?? "";
      case "hash_tag":
        return body.hashTag ?? body.hash_tag ?? "";
      case "status":
        return "ready";
      default:
        if (AFF_LINK_KEY_SET.has(key)) {
          return body.affLink ?? body.aff_link ?? "";
        }
        return "";
    }
  });
}

/**
 * Ghi một dòng ingest (sau khi đã có body.id / video_local đầy đủ nếu cần).
 * @param {object} body - url, title, videoSrc, videoLocal, …; phải có body.id = nextId
 */
export async function writeAffIngestRow(spreadsheetId, plan, body) {
  const prefix = sheetTitleToA1Prefix(plan.worksheetTitle);
  const sheets = await getSheetsApiSingleton();
  const headerKeys = plan.headerKeys;
  const rowOut = buildRowValues(headerKeys, body);

  const lastCol = columnIndexToA1Letter(Math.max(headerKeys.length - 1, 0));
  const writeRange = `${prefix}A${plan.targetDataRow1Based}:${lastCol}${plan.targetDataRow1Based}`;

  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowOut] },
    }),
  );

  return {
    worksheetTitle: plan.worksheetTitle,
    rowNumber: plan.targetDataRow1Based,
    id: plan.nextId,
    rangeWritten: writeRange.replace(/\n/g, "").trim(),
  };
}

/**
 * Đọc sheet → ghi dòng (không tải video). Dùng khi không cần bước download.
 */
export async function ingestAffProductRow(spreadsheetId, sheetResolveHint, body) {
  const plan = await planAffIngestRow(spreadsheetId, sheetResolveHint);
  const bodyWithId = { ...body, id: plan.nextId };
  return writeAffIngestRow(spreadsheetId, plan, bodyWithId);
}

/**
 * Cập nhật ô video_local cho một row cụ thể sau khi render xong.
 * No-op nếu sheet không có cột video_local.
 *
 * @param {string} spreadsheetId
 * @param {object} sheetResolveHint - { sheetTitle?, sheetIndex? }
 * @param {number} rowNumber - 1-based
 * @param {string} videoPath - absolute path tới file mp4 đã render
 */
export async function updateVideoLocalByRow(spreadsheetId, sheetResolveHint, rowNumber, videoPath) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const sheets = await getSheetsApiSingleton();

  const { data: headerData } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${prefix}1:1` }),
  );
  const headers = headerData.values?.[0] ?? [];
  const colIdx = findHeaderIndex(headers, ["video_local", "video local"]);
  if (colIdx === -1) return { skipped: true, reason: "no video_local column on sheet" };

  const colLetter = columnIndexToA1Letter(colIdx);
  const writeRange = `${prefix}${colLetter}${rowNumber}`;
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: [[videoPath]] },
    }),
  );

  return { worksheetTitle, rowNumber, rangeWritten: writeRange };
}

/**
 * Cập nhật ô hash_tag cho một row cụ thể (sau khi generate hashtag xong).
 * No-op nếu sheet không có cột hash_tag.
 *
 * @param {string} spreadsheetId
 * @param {object} sheetResolveHint - { sheetTitle?, sheetIndex? }
 * @param {number} rowNumber - 1-based
 * @param {string} hashTagValue - nội dung hashtag cần ghi
 */
export async function updateHashTagByRow(spreadsheetId, sheetResolveHint, rowNumber, hashTagValue) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const sheets = await getSheetsApiSingleton();

  const { data: headerData } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${prefix}1:1` }),
  );
  const headers = headerData.values?.[0] ?? [];
  const colIdx = findHeaderIndex(headers, ["hash_tag", "hash tag", "hashtag"]);
  if (colIdx === -1) return { skipped: true, reason: "no hash_tag column on sheet" };

  const colLetter = columnIndexToA1Letter(colIdx);
  const writeRange = `${prefix}${colLetter}${rowNumber}`;
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: [[hashTagValue]] },
    }),
  );

  return { worksheetTitle, rowNumber, rangeWritten: writeRange };
}

/**
 * Đọc title của một row cụ thể từ sheet.
 * Trả về string title hoặc null nếu không tìm thấy.
 *
 * @param {string} spreadsheetId
 * @param {object} sheetResolveHint
 * @param {number} rowNumber - 1-based
 * @returns {Promise<string|null>}
 */
export async function readRowTitle(spreadsheetId, sheetResolveHint, rowNumber) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const sheets = await getSheetsApiSingleton();

  // Đọc header row
  const { data: headerData } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${prefix}1:1` }),
  );
  const headers = (headerData.values?.[0] ?? []).map((h) => normalizeHeaderCell(h));
  const titleIdx = headers.indexOf("title");
  if (titleIdx === -1) return null;

  // Đọc data row
  const colLetter = columnIndexToA1Letter(titleIdx);
  const { data: rowData } = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${prefix}${colLetter}${rowNumber}`,
    }),
  );
  return String(rowData.values?.[0]?.[0] ?? "").trim() || null;
}

/** @param {string} spreadsheetId */
export async function readSpreadsheetValues(spreadsheetId, rangeA1) {
  const sheets = await getSheetsApiSingleton();
  const { data } = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: rangeA1 }),
  );
  return {
    range: data.range ?? rangeA1,
    majorDimension: data.majorDimension ?? "ROWS",
    values: data.values ?? [],
  };
}

/**
 * Tìm rowNumber (1-based) theo giá trị cột `id`. Trả về null nếu không tìm thấy.
 * Dùng cho import video đã generate (match theo id trong tên file `<id>.mp4`).
 *
 * @param {string} spreadsheetId
 * @param {object} sheetResolveHint - { sheetTitle?, sheetIndex? }
 * @param {string|number} id
 */
export async function findRowNumberById(spreadsheetId, sheetResolveHint, id) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetResolveHint ?? {});
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const { values } = await readSpreadsheetValues(spreadsheetId, `${prefix}A1:Z1000`);
  if (values.length < 2) return null;

  const headers = values[0].map((h) => normalizeHeaderCell(h));
  const idCol = findHeaderIndex(headers, ["id"]);
  if (idCol === -1) return null;

  const target = String(id).trim();
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    if (String(row[idCol] ?? "").trim() === target) return r + 1;
  }
  return null;
}
