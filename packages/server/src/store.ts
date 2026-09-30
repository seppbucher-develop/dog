import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RoomSnapshot } from './room';

/** Räume als JSON-Datei sichern; atomar (erst temporäre Datei, dann umbenennen). */
export function saveRooms(file: string, rooms: RoomSnapshot[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, rooms }));
  renameSync(tmp, file);
}

export function loadRooms(file: string): RoomSnapshot[] {
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; rooms?: RoomSnapshot[] };
    return data.version === 1 && Array.isArray(data.rooms) ? data.rooms : [];
  } catch {
    return []; // beschädigte Datei: neu anfangen statt abstürzen
  }
}
