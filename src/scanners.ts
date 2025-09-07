import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {applyExcludes, safeReaddir, SizeEntry} from './utils.js';

export type Progress = { phase: string; processed: number; total: number };

export function runDuKb(target: string): Promise<number> {
  return new Promise((resolve) => {
    const ps = spawn('du', ['-skx', target]);
    let out = '';
    ps.stdout.on('data', (d) => (out += String(d)));
    ps.on('close', () => {
      const kb = parseInt(out.split(/\s+/)[0] || '0', 10);
      resolve(Number.isFinite(kb) ? kb : 0);
    });
    ps.on('error', () => resolve(0));
  });
}

export function listDirsViaFind(dir: string): Promise<string[]> {
  return new Promise((resolve) => {
    const ps = spawn('find', [dir, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0']);
    const out: string[] = [];
    let buf = Buffer.alloc(0);
    ps.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let idx;
      while ((idx = buf.indexOf(0)) !== -1) {
        out.push(buf.subarray(0, idx).toString());
        buf = buf.subarray(idx + 1);
      }
    });
    ps.on('close', () => resolve(out));
    ps.on('error', () => resolve([]));
  });
}

export async function scanDirsDepth1(startPath: string, excludes: string[], debug = false, onProgress?: (p: Progress) => void): Promise<SizeEntry[]> {
  let dirs = safeReaddir(startPath);
  if (dirs.length === 0) {
    if (debug) console.error(`[debug] readdir returned 0 entries, falling back to find for ${startPath}`);
    dirs = await listDirsViaFind(startPath);
  }
  dirs = dirs.filter((p) => !applyExcludes(p, excludes));
  const results: SizeEntry[] = [];
  const total = dirs.length;
  onProgress?.({ phase: 'measuring', processed: 0, total });
  for (const d of dirs) {
    const kb = await runDuKb(d);
    results.push({ kb, path: d });
    onProgress?.({ phase: 'measuring', processed: results.length, total });
  }
  results.sort((a, b) => b.kb - a.kb);
  return results;
}

export async function scanNodeModules(startPath: string, excludes: string[], onProgress?: (p: Progress) => void): Promise<SizeEntry[]> {
  const results: SizeEntry[] = [];
  await new Promise<void>((resolve) => {
    const ps = spawn('find', [startPath, '-type', 'd', '-name', 'node_modules', '-prune', '-print0']);
    const files: string[] = [];
    let buf = Buffer.alloc(0);
    ps.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let idx;
      while ((idx = buf.indexOf(0)) !== -1) {
        const p = buf.subarray(0, idx).toString();
        files.push(p);
        buf = buf.subarray(idx + 1);
      }
    });
    ps.on('close', async () => {
      const total = files.length;
      onProgress?.({ phase: 'measuring', processed: 0, total });
      for (const p of files) {
        if (applyExcludes(p, excludes)) continue;
        const kb = await runDuKb(p);
        results.push({ kb, path: p });
        onProgress?.({ phase: 'measuring', processed: results.length, total });
      }
      results.sort((a, b) => b.kb - a.kb);
      resolve();
    });
    ps.on('error', () => resolve());
  });
  return results;
}

export async function scanLargeFiles(startPath: string, minSizeMb: number, excludes: string[], onProgress?: (p: Progress) => void): Promise<SizeEntry[]> {
  const results: SizeEntry[] = [];
  await new Promise<void>((resolve) => {
    const ps = spawn('find', [startPath, '-type', 'f', '-size', `+${minSizeMb}M`, '-print0']);
    const files: string[] = [];
    let buf = Buffer.alloc(0);
    ps.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let idx;
      while ((idx = buf.indexOf(0)) !== -1) {
        const p = buf.subarray(0, idx).toString();
        files.push(p);
        buf = buf.subarray(idx + 1);
      }
    });
    ps.on('close', async () => {
      const total = files.length;
      onProgress?.({ phase: 'measuring', processed: 0, total });
      for (const f of files) {
        if (applyExcludes(f, excludes)) continue;
        try {
          const st = fs.statSync(f);
          const kb = Math.floor(st.size / 1024);
          results.push({ kb, path: f });
          onProgress?.({ phase: 'measuring', processed: results.length, total });
        } catch {}
      }
      results.sort((a, b) => b.kb - a.kb);
      resolve();
    });
    ps.on('error', () => resolve());
  });
  return results;
}

export const presetLocations: Array<{label: string; path: string}> = [
  { label: 'Downloads', path: `${process.env.HOME}/Downloads` },
  { label: 'Movies', path: `${process.env.HOME}/Movies` },
  { label: 'Pictures', path: `${process.env.HOME}/Pictures` },
  { label: 'Music', path: `${process.env.HOME}/Music` },
  { label: 'User Caches', path: `${process.env.HOME}/Library/Caches` },
  { label: 'System Caches', path: `/Library/Caches` },
  { label: 'Xcode DerivedData', path: `${process.env.HOME}/Library/Developer/Xcode/DerivedData` },
  { label: 'Xcode Archives', path: `${process.env.HOME}/Library/Developer/Xcode/Archives` },
  { label: 'iOS Simulators', path: `${process.env.HOME}/Library/Developer/CoreSimulator/Devices` },
  { label: 'Android SDK', path: `${process.env.HOME}/Library/Android/sdk` },
  { label: 'Android User Dir', path: `${process.env.HOME}/.android` },
  { label: 'Gradle cache', path: `${process.env.HOME}/.gradle` },
  { label: 'npm cache', path: `${process.env.HOME}/.npm` },
  { label: 'npm cache (Library)', path: `${process.env.HOME}/Library/Caches/npm` },
  { label: 'Yarn cache', path: `${process.env.HOME}/Library/Caches/Yarn` },
  { label: 'pnpm store (Library)', path: `${process.env.HOME}/Library/pnpm/store` },
  { label: 'pnpm store (home)', path: `${process.env.HOME}/.pnpm-store` },
  { label: 'Homebrew (user)', path: `${process.env.HOME}/Library/Caches/Homebrew` },
  { label: 'Homebrew (system)', path: `/Library/Caches/Homebrew` },
  { label: 'Docker.raw', path: `${process.env.HOME}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw` },
  { label: 'Docker config', path: `${process.env.HOME}/.docker` },
  { label: 'Adobe Media Cache Files', path: `${process.env.HOME}/Library/Application Support/Adobe/Common/Media Cache Files` },
  { label: 'Adobe Media Cache', path: `${process.env.HOME}/Library/Application Support/Adobe/Common/Media Cache` },
  { label: 'Adobe Caches', path: `${process.env.HOME}/Library/Caches/Adobe` },
  { label: 'DaVinci CacheClip', path: `${process.env.HOME}/Movies/DaVinci Resolve/CacheClip` },
  { label: 'DaVinci ProxyMedia', path: `${process.env.HOME}/Movies/DaVinci Resolve/ProxyMedia` }
];

export async function sizeIfExists(p: string): Promise<SizeEntry | null> {
  try {
    fs.accessSync(p);
    const kb = await runDuKb(p);
    return { kb, path: p };
  } catch {
    return null;
  }
}
