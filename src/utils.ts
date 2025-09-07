import fs from 'node:fs';
import path from 'node:path';

export type SizeEntry = { kb: number; path: string };

export function humanFromKB(kb: number): string {
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;
  let i = 0;
  let x = kb;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(1)}${units[i]}`;
}

export function applyExcludes(p: string, excludes: string[]): boolean {
  return excludes.some((e) => p.includes(e));
}

export function listImmediateDirectories(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name));
}

export function safeReaddir(dir: string): string[] {
  try {
    return listImmediateDirectories(dir);
  } catch {
    return [];
  }
}

export function toTopN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}
