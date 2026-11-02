/**
 * Chạy trên GitHub Actions. Quét 1 Google Sheet tìm row status=pending_generate,
 * download + render (ffmpeg), upload kết quả qua actions/upload-artifact.
 *
 * Generic — không biết gì về business (affSource→sheet mapping, local path).
 * spreadsheetId được tra qua env var SPREADSHEET_ID_<AFFSOURCE viết hoa>,
 * set sẵn làm GitHub Secret ở repo này — không bao giờ truyền thẳng qua input
 * hay xuất hiện trong log, để tránh lộ ID thật dù repo public.
 *
 * Usage: node generate-pending-videos.mjs --affSource VDStore --limit 5
 */
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";

import { downloadVideoToPath, listAudioFiles, pickAudioPathBySheetId, renderAffVideo, resolveAudiosDir } from "../aff-render-video/index.js";

import { STATUS_CLOUD_GENERATED, STATUS_PENDING_GENERATE } from "../affSheetConstants.js";
import { writeRowStatus } from "../postStatusSheet.js";
import { findHeaderIndex, normalizeHeaderCell } from "../sheetHeaders.js";
import { readSpreadsheetValues, resolveWorksheetTitle, sheetTitleToA1Prefix } from "../sheetsClient.js";

const DEFAULT_SHEET_TITLE = "AFF";

function parseArgs(argv) {
  const out = { limit: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--affSource") out.affSource = argv[++i];
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
  }
  return out;
}

/** Tra spreadsheetId qua env var SPREADSHEET_ID_<AFFSOURCE>, không bao giờ log ra giá trị. */
function resolveSpreadsheetId(affSource) {
  const envKey = `SPREADSHEET_ID_${affSource.toUpperCase()}`;
  const value = process.env[envKey];
  if (!value || !value.trim()) {
    throw new Error(`missing secret ${envKey} for affSource: ${affSource}`);
  }
  return value.trim();
}

async function findPendingRows(spreadsheetId, sheetHint, limit) {
  const worksheetTitle = await resolveWorksheetTitle(spreadsheetId, sheetHint);
  const prefix = sheetTitleToA1Prefix(worksheetTitle);
  const { values } = await readSpreadsheetValues(spreadsheetId, `${prefix}A1:Z1000`);
  if (values.length < 2) return [];

  const headers = values[0].map((h) => normalizeHeaderCell(h));
  const idCol = findHeaderIndex(headers, ["id"]);
  const statusCol = findHeaderIndex(headers, ["status"]);
  const videoUrlCol = findHeaderIndex(headers, ["video_url", "video url"]);
  if (idCol === -1 || statusCol === -1 || videoUrlCol === -1) {
    throw new Error("sheet missing required column: id / status / video_url");
  }

  const rows = [];
  for (let r = 1; r < values.length && rows.length < limit; r++) {
    const row = values[r] ?? [];
    if (String(row[statusCol] ?? "").trim() !== STATUS_PENDING_GENERATE) continue;
    const id = String(row[idCol] ?? "").trim();
    const videoUrl = String(row[videoUrlCol] ?? "").trim();
    if (!id || !videoUrl) continue;
    rows.push({ rowNumber: r + 1, id, videoUrl });
  }
  return rows;
}

async function main() {
  const { affSource, limit: rawLimit } = parseArgs(process.argv.slice(2));
  if (!affSource) throw new Error("missing --affSource");
  if (!Number.isInteger(rawLimit) || rawLimit < 0) throw new Error(`invalid --limit: ${rawLimit}`);
  // 0 = không giới hạn, xử lý hết toàn bộ row pending_generate trong sheet.
  const limit = rawLimit === 0 ? Infinity : rawLimit;

  const spreadsheetId = resolveSpreadsheetId(affSource);
  const sheetHint = { sheetTitle: DEFAULT_SHEET_TITLE, sheetIndex: null };

  // Fail-fast: audio dir phải có file trước khi xử lý row nào (tránh fail giữa batch).
  const audiosDir = resolveAudiosDir();
  const audioFiles = listAudioFiles(audiosDir);
  if (audioFiles.length === 0) {
    throw new Error(`no audio files in ${audiosDir} — set AFF_AUDIOS_DIR?`);
  }
  console.log(`[audio] ${audioFiles.length} file(s) trong ${audiosDir}`);

  const pendingRows = await findPendingRows(spreadsheetId, sheetHint, limit);
  console.log(`[scan] ${affSource}: ${pendingRows.length} row pending_generate (limit=${limit})`);
  if (pendingRows.length === 0) return;

  const outputDir = path.resolve("ci-output");
  await mkdir(outputDir, { recursive: true });

  let okCount = 0;
  let failCount = 0;

  for (const row of pendingRows) {
    console.log(`[render] ${affSource}#${row.id} start`);
    const tmpInputPath = path.join(outputDir, `__src_${row.id}.mp4`);
    try {
      const downloadStart = Date.now();
      await downloadVideoToPath(row.videoUrl, tmpInputPath);
      const downloadMs = Date.now() - downloadStart;
      console.log(`[timing] ${affSource}#${row.id} download: ${(downloadMs / 1000).toFixed(1)}s`);

      const { audioPath } = pickAudioPathBySheetId(row.id, audiosDir);
      const outputVideoPath = path.join(outputDir, `${row.id}.mp4`);

      const renderStart = Date.now();
      await renderAffVideo({ inputVideoPath: tmpInputPath, audioPath, outputVideoPath });
      const renderMs = Date.now() - renderStart;
      console.log(`[timing] ${affSource}#${row.id} ffmpeg render: ${(renderMs / 1000).toFixed(1)}s`);

      await writeRowStatus(spreadsheetId, sheetHint, row.rowNumber, STATUS_CLOUD_GENERATED);
      console.log(`[render] ${affSource}#${row.id} done → ${outputVideoPath}`);
      okCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[render] ${affSource}#${row.id} FAILED: ${msg}`);
      failCount++;
    } finally {
      await unlink(tmpInputPath).catch(() => {});
    }
  }

  console.log(`[done] ok=${okCount} fail=${failCount}`);
  if (okCount === 0 && pendingRows.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
