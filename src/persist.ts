import fs from 'node:fs';
import path from 'node:path';
import {SizeEntry} from './utils.js';

type PersistEntry = {
  lastScan: number;
  dirs: SizeEntry[];
  files: SizeEntry[];
};

type PersistMap = Record<string, PersistEntry>;

function repoCacheDir(): string {
  // Cache under the current working directory so it sits alongside the project
  const dir = path.join(process.cwd(), '.storage-cleanup-cache');
  try { fs.mkdirSync(dir, {recursive: true}); } catch {}
  return dir;
}

function cacheFilePath(): string {
  return path.join(repoCacheDir(), 'cache.json');
}

export async function loadCacheFromDisk(): Promise<Map<string, any>> {
  const file = cacheFilePath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data: PersistMap = JSON.parse(raw);
    const map = new Map<string, any>();
    for (const [p, val] of Object.entries(data)) {
      map.set(p, {
        status: 'scanned',
        path: p,
        alphaDirs: [],
        dirs: val.dirs,
        files: val.files,
        lastScan: val.lastScan
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveCacheToDisk(dirPath: string, entry: PersistEntry): Promise<void> {
  const file = cacheFilePath();
  let data: PersistMap = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  data[dirPath] = entry;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
