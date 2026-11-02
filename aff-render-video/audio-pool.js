import fs from "node:fs";
import path from "node:path";

import { AUDIO_EXTENSIONS } from "./render-config.js";

/** Trả về danh sách absolute paths của audio files trong dir, sorted theo tên. */
export function listAudioFiles(audiosDir) {
  const dir = path.resolve(audiosDir);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((name) => {
    return AUDIO_EXTENSIONS.includes(path.extname(name).toLowerCase());
  });
  names.sort();
  return names.map((name) => path.join(dir, name));
}

/**
 * Xoay vòng audio theo sheetId: id=1 → file đầu, id=N+1 → file đầu lại.
 * Dùng (id - 1) % count để id bắt đầu từ 1.
 */
export function pickAudioPathBySheetId(sheetId, audiosDir) {
  const files = listAudioFiles(audiosDir);
  if (files.length === 0) throw new Error(`no audio files in ${audiosDir}`);
  const id = Number(sheetId);
  if (!Number.isInteger(id) || id < 1) throw new Error(`invalid sheet id for audio pick: ${sheetId}`);
  const index = (id - 1) % files.length;
  return { audioPath: files[index], audioIndex: index, audioCount: files.length };
}
