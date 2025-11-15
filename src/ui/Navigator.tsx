import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {humanFromKB, SizeEntry} from '../utils.js';
import {listDirsViaFind, runDuKb, Progress} from '../scanners.js';
import {loadCacheFromDisk, saveCacheToDisk} from '../persist.js';

type DirStatus = 'unscanned' | 'scanning' | 'scanned';

type DirCacheEntry = {
  status: DirStatus;
  path: string;
  alphaDirs: string[]; // alphabetical immediate subdirs
  dirs?: SizeEntry[]; // sized subdirs (topN)
  files?: SizeEntry[]; // legacy; not used in UI
  lastScan?: number;
  msg?: string;
};

const TOP_N = 30;
const CONCURRENCY = 6;

function basenameNoSlash(p: string) {
  const b = path.basename(p);
  return b || p; // handle root
}

async function measureDirs(dirs: string[], onProgress?: (p: Progress) => void): Promise<SizeEntry[]> {
  const total = dirs.length;
  onProgress?.({phase: 'measuring', processed: 0, total});
  const results: SizeEntry[] = [];
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= total) break;
      const d = dirs[i];
      const kb = await runDuKb(d);
      results.push({kb, path: d});
      onProgress?.({phase: 'measuring', processed: results.length, total});
    }
  }
  const workers = Array.from({length: Math.min(CONCURRENCY, Math.max(1, total))}, () => worker());
  await Promise.all(workers);
  results.sort((a, b) => b.kb - a.kb);
  return results;
}

function Header({current, width}: {current: string; width: number}) {
  const hr = '─'.repeat(Math.max(20, Math.min(width, 100)));
  return (
    <Box flexDirection="column">
      <Text dimColor>{hr}</Text>
      <Box width={width} justifyContent="center">
        <Text>
          <Text color="magenta" bold>🧹 storage-cleanup</Text>
        </Text>
      </Box>
      <Box width={width} justifyContent="center">
        <Text color="cyan" dimColor>interactive navigator</Text>
      </Box>
      <Text>
        <Text color="blue">Path:</Text>
        <Text> {current}</Text>
      </Text>
      <Text dimColor>{hr}</Text>
    </Box>
  );
}

function SectionTitle({children}: {children: React.ReactNode}) {
  return (
    <Box marginTop={1}>
      <Text color="magenta" bold>{children}</Text>
    </Box>
  );
}

function Rows({items, selectedIndex}: {items: Array<{label: string; right?: string; dim?: boolean}>, selectedIndex: number}) {
  return (
    <>
      {items.map((it, i) => (
        <Box key={i}>
          <Text inverse={i === selectedIndex}>{(i === selectedIndex ? '▶ ' : '  ') + it.label}</Text>
          {it.right && (
            <>
              <Text> </Text>
              <Text color={it.dim ? 'gray' : 'green'}>{it.right}</Text>
            </>
          )}
        </Box>
      ))}
    </>
  );
}

function getNavigableList(entry?: DirCacheEntry): Array<SizeEntry | string> {
  if (!entry) return [];
  if (entry.dirs && entry.dirs.length > 0) {
    return entry.dirs;
  }
  return entry.alphaDirs || [];
}

export default function Navigator() {
  const startPath = useMemo(() => process.env.HOME || process.cwd(), []);
  const [currentPath, setCurrentPath] = useState<string>(startPath);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [cache, setCache] = useState<Map<string, DirCacheEntry>>(new Map());
  const [progressDirs, setProgressDirs] = useState<Progress | null>(null);
  const [elapsedStart, setElapsedStart] = useState<number>(Date.now());
  const [currentSizeKb, setCurrentSizeKb] = useState<number | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<{path: string; label: string; status: 'confirm' | 'working'; error?: string} | null>(null);
  const {stdout} = useStdout();
  const termRows = stdout?.rows ?? 24;
  const entry = cache.get(currentPath);
  const navigableList = getNavigableList(entry);
  const navigableLen = navigableList.length;

  // Initialize entry, list alpha subdirs
  useEffect(() => {
    if (!cache.has(currentPath)) {
      setCache((prev) => new Map(prev).set(currentPath, {
        status: 'unscanned',
        path: currentPath,
        alphaDirs: [],
        msg: 'Unscanned. Press Enter to scan.'
      }));
      (async () => {
        try {
          const alpha = await listDirsViaFind(currentPath);
          setCache((prev) => {
            const next = new Map(prev);
            const entry = next.get(currentPath);
            if (entry) entry.alphaDirs = alpha.sort((a,b)=>basenameNoSlash(a).localeCompare(basenameNoSlash(b)));
            return next;
          });
        } catch {}
      })();
    }
    // refresh current directory size asynchronously
    (async () => {
      try {
        setCurrentSizeKb(null);
        const kb = await runDuKb(currentPath);
        setCurrentSizeKb(kb);
      } catch {
        setCurrentSizeKb(null);
      }
    })();
  }, [currentPath]);

  // Load persisted cache on boot
  useEffect(() => {
    (async () => {
      try {
        const disk = await loadCacheFromDisk();
        if (disk.size > 0) {
          setCache(disk);
        }
      } catch {}
    })();
  }, []);

  // Auto-scan on first launch/start path only (or refresh if cached), once
  const bootScannedRef = useRef(false);
  useEffect(() => {
    if (bootScannedRef.current) return;
    const entry = cache.get(startPath);
    if (!entry) return; // wait for initial entry/cache load
    bootScannedRef.current = true;
    setElapsedStart(Date.now());
    void triggerScan(startPath, entry.status === 'scanned');
  }, [cache, startPath]);

  // Prevent stale progress updates when scans overlap
  const scanSeqRef = useRef(0);

  async function triggerScan(p: string, force: boolean) {
    const mySeq = ++scanSeqRef.current;
    setCache((prev) => {
      const next = new Map(prev);
      const ent = next.get(p);
      if (!ent) return prev;
      if (ent.status === 'scanning') return prev;
      if (!force && ent.status === 'scanned') return prev;
      ent.status = 'scanning';
      ent.msg = 'Scanning…';
      return next;
    });

    try {
      const entryBefore = cache.get(p);
      const alpha = entryBefore?.alphaDirs?.length ? entryBefore.alphaDirs : await listDirsViaFind(p);
      if (scanSeqRef.current !== mySeq) return; // stale
      setProgressDirs({phase:'measuring', processed:0, total: alpha.length});
      let lastDirsTs = 0;
      const dirSizes = await measureDirs(alpha, (prog) => {
        if (scanSeqRef.current !== mySeq) return; // stale
        const now = Date.now();
        if (now - lastDirsTs > 150 || prog.processed === prog.total) {
          setProgressDirs(prog);
          lastDirsTs = now;
        }
      });

      if (scanSeqRef.current !== mySeq) return; // stale
      setCache((prev) => {
        const next = new Map(prev);
        const ent = next.get(p);
        if (ent) {
          ent.status = 'scanned';
          ent.msg = undefined;
          ent.dirs = dirSizes.slice(0, TOP_N);
          ent.files = [];
          ent.lastScan = Date.now();
        }
        return next;
      });
      // Persist to disk after successful scan
      try { await saveCacheToDisk(p, {dirs: dirSizes.slice(0, TOP_N), files: [], lastScan: Date.now()}); } catch {}
      // update displayed size after scan completes
      try { const kb = await runDuKb(p); if (scanSeqRef.current === mySeq) setCurrentSizeKb(kb); } catch {}
    } catch (e:any) {
      setCache((prev) => {
        const next = new Map(prev);
        const ent = next.get(p);
        if (ent) {
          ent.status = 'unscanned';
          ent.msg = `Scan failed: ${e?.message || e}`;
        }
        return next;
      });
    } finally {
      if (scanSeqRef.current === mySeq) {
        setProgressDirs(null);
      }
    }
  }

  // Scrolling viewport state for folders list
  const [viewOffset, setViewOffset] = useState(0);

  function adjustViewport(len: number, selected: number, currentOffset: number, viewSize: number) {
    if (len <= viewSize) return 0;
    if (selected < currentOffset) return selected; // scroll up
    if (selected >= currentOffset + viewSize) return selected - viewSize + 1; // scroll down
    return currentOffset;
  }

  async function confirmDelete(targetPath: string) {
    setDeletePrompt((prev) => prev ? {...prev, status: 'working', error: undefined} : prev);
    try {
      await fs.promises.rm(targetPath, {recursive: true, force: true});
      setDeletePrompt(null);
      setCache((prev) => {
        const next = new Map(prev);
        next.delete(targetPath);
        const parent = path.dirname(targetPath);
        const parentEntry = next.get(parent);
        if (parentEntry) {
          parentEntry.alphaDirs = parentEntry.alphaDirs.filter((d) => d !== targetPath);
          if (parentEntry.dirs) parentEntry.dirs = parentEntry.dirs.filter((d) => d.path !== targetPath);
        }
        return next;
      });
      if (currentPath === targetPath) {
        // If the deleted target is the current directory, go up a level
        const parent = path.dirname(targetPath);
        if (parent && parent !== targetPath) {
          setCurrentPath(parent);
          setSelectedIndex(0);
          setViewOffset(0);
        }
      }
      setElapsedStart(Date.now());
      void triggerScan(currentPath === targetPath ? path.dirname(targetPath) : currentPath, true);
    } catch (err: any) {
      setDeletePrompt((prev) => prev ? {...prev, status: 'confirm', error: err?.message || String(err)} : prev);
    }
  }

  useEffect(() => {
    setSelectedIndex((idx) => {
      if (navigableLen === 0) return 0;
      return Math.max(0, Math.min(idx, navigableLen - 1));
    });
  }, [navigableLen]);

  // Navigation input
  useInput((input, key) => {
    if (deletePrompt) {
      if (key.escape || input === 'n') {
        setDeletePrompt(null);
        return;
      }
      if ((input && input.toLowerCase() === 'y') || key.return) {
        if (deletePrompt.status !== 'working') {
          void confirmDelete(deletePrompt.path);
        }
      }
      return;
    }

    const list = navigableList;
    const len = navigableLen;
    const normalizedIndex = len ? Math.min(selectedIndex, len - 1) : 0;

    if (key.escape || input === 'q') {
      process.exit(0);
    }

    if (key.upArrow) {
      setSelectedIndex((i) => {
        const next = len ? (i - 1 + len) % len : 0;
        setViewOffset((off) => adjustViewport(len, next, off, computeFolderViewportSize()));
        return next;
      });
    } else if (key.downArrow) {
      setSelectedIndex((i) => {
        const next = len ? (i + 1) % len : 0;
        setViewOffset((off) => adjustViewport(len, next, off, computeFolderViewportSize()));
        return next;
      });
    } else if (key.leftArrow || input === 'b') {
      const parent = path.dirname(currentPath);
      if (parent && parent !== currentPath) {
        const cameFrom = currentPath;
        setCurrentPath(parent);
        setSelectedIndex(0);
        setViewOffset(0);
        setElapsedStart(Date.now());
        // Auto refresh parent on navigate
        void triggerScan(parent, true);
        // try to highlight the child we came from
        setTimeout(() => {
          const pe = cache.get(parent);
          const arr = getNavigableList(pe);
          if (arr && arr.length) {
            const idx = arr.findIndex((v:any) => (typeof v === 'string' ? v : v.path) === cameFrom);
            if (idx >= 0) setSelectedIndex(idx);
          }
        }, 0);
      }
    } else if (key.rightArrow || key.return || input === ' ') {
      // Enter selected directory
      if (!len) return;
      const sel = list[normalizedIndex];
      const nextPath = typeof sel === 'string' ? sel : (sel as SizeEntry).path;
      setCurrentPath(nextPath);
      setSelectedIndex(0);
      setViewOffset(0);
      setElapsedStart(Date.now());
      if (!cache.has(nextPath)) {
        setCache((prev) => new Map(prev).set(nextPath, {status:'unscanned', path: nextPath, alphaDirs:[], msg:'Unscanned. Press Enter to scan.'}));
        (async ()=>{
          try { const alpha = await listDirsViaFind(nextPath);
            setCache((prev)=>{const next=new Map(prev); const e=next.get(nextPath); if(e) e.alphaDirs=alpha.sort((a,b)=>basenameNoSlash(a).localeCompare(basenameNoSlash(b))); return next;});
          } catch {}
        })();
      }
      // Auto refresh on navigate into directory
      void triggerScan(nextPath, true);
    } else if (input === 'r') {
      // Rescan
      void triggerScan(currentPath, true);
    } else if (input === 'd') {
      if (!len || !list[normalizedIndex]) return;
      const sel = list[normalizedIndex];
      const targetPath = typeof sel === 'string' ? sel : (sel as SizeEntry).path;
      const label = basenameNoSlash(targetPath);
      setDeletePrompt({path: targetPath, label, status: 'confirm'});
    } else if (input === 'o') {
      // Open in Finder
      try {
        // Open selected item if available; fall back to currentPath
        let openPath = currentPath;
        if (len) {
          const sel = list[normalizedIndex];
          openPath = typeof sel === 'string' ? sel : (sel as SizeEntry).path;
          // If it somehow points to a file, open its parent
          try { const st = fs.statSync(openPath); if (st.isFile()) openPath = path.dirname(openPath); } catch {}
        }
        spawn('open', [openPath], {stdio:'ignore', detached:true}).unref();
      } catch {}
    } else if (input === 'g') {
      setSelectedIndex(0);
    } else if (input === 'G') {
      setSelectedIndex(Math.max(0, len - 1));
    }
  });

  const elapsedSec = ((Date.now() - elapsedStart) / 1000).toFixed(1);

  const folderRowsAll = ((): Array<{label: string; right?: string; dim?: boolean}> => {
    if (!entry) return [];
    // Show cached results even while scanning
    return (entry.dirs || []).map((d) => ({
      label: basenameNoSlash(d.path),
      right: humanFromKB(d.kb)
    }));
  })();

  function computeFolderViewportSize(): number {
    // Reserve lines: header(1) + help(1) + optional msg(1) + optional progress(1) + section headers(2) + files section header(1) + files rows
    const msgLines = entry?.msg ? 1 : 0;
    const progLines = entry?.status === 'scanning' ? 2 : 0;
    const filesVisible = Math.min((entry?.files?.length ?? 0), 10); // cap visible files to 10 to avoid overflow
    const reserved = 1 + 1 + msgLines + progLines + 1 + 1 + filesVisible + 1; // +1 bottom padding
    const view = Math.max(5, termRows - reserved);
    return view;
  }

  const folderViewSize = computeFolderViewportSize();
  const totalFolderRows = folderRowsAll.length;
  const safeOffset = Math.min(viewOffset, Math.max(0, totalFolderRows - folderViewSize));
  const folderRows = folderRowsAll.slice(safeOffset, safeOffset + folderViewSize);

  // Simple spinner when scanning
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  const [spinIdx, setSpinIdx] = useState(0);
  useEffect(() => {
    if (entry?.status !== 'scanning') return;
    const t = setInterval(() => setSpinIdx((i) => (i + 1) % spinnerFrames.length), 100);
    return () => clearInterval(t);
  }, [entry?.status]);

  function renderBarColored(processed: number, total: number) {
    const cols = stdout?.columns ?? 80;
    const width = Math.max(10, Math.min(24, cols - 48));
    const pct = total > 0 ? Math.min(1, processed / total) : 0;
    const filled = Math.floor(pct * width);
    const empty = Math.max(0, width - filled);
    const pctTxt = total > 0 ? ` ${(Math.floor(pct * 100)).toString().padStart(3)}%` : '';
    return (
      <>
        <Text color="green">{'█'.repeat(filled)}</Text>
        <Text color="gray">{'░'.repeat(empty)}</Text>
        <Text dimColor>{pctTxt}</Text>
      </>
    );
  }

  return (
    <Box flexDirection="column">
      <Header current={currentPath} width={stdout?.columns ?? 80} />
      <Box>
        <Text color="gray">Size:</Text>
        <Text> {currentSizeKb == null ? '—' : humanFromKB(currentSizeKb)}</Text>
      </Box>
      <Box>
        <Text dimColor>Up/Down: select • Right: enter • Left: up • Enter: scan • r: rescan • d: delete • q: quit</Text>
      </Box>

      {entry?.status === 'unscanned' && (
        <Box>
          <Text color="yellow">Unscanned. Press Enter to scan.</Text>
        </Box>
      )}

      {entry?.status === 'scanning' && (
        <Box flexDirection="column">
          {(() => {
            const dirDone = !!(progressDirs && progressDirs.total > 0 && progressDirs.processed >= progressDirs.total);
            const color = dirDone ? 'green' : (progressDirs ? 'yellow' : 'gray');
            return (
              <Text color={color}>{spinnerFrames[spinIdx]} Scanning… | elapsed {elapsedSec}s</Text>
            );
          })()}
          <Box>
            {/* Folders status with dynamic color */}
            {(() => {
              const complete = !!(progressDirs && progressDirs.total > 0 && progressDirs.processed >= progressDirs.total);
              const started = !!(progressDirs && progressDirs.processed > 0 && !complete);
              const color = complete ? 'green' : started ? 'yellow' : 'gray';
              return (
                <>
                  <Text color={color}>Folders:</Text>
                  <Text> </Text>
                  {progressDirs ? (
                    <>
                      <Text color={color}>{`${progressDirs.processed}/${progressDirs.total}`}</Text>
                      <Text> </Text>
                      <Text>[</Text>
                      {renderBarColored(progressDirs.processed, progressDirs.total)}
                      <Text>]</Text>
                    </>
                  ) : (
                    <Text dimColor>—</Text>
                  )}
                </>
              );
            })()}
          </Box>
        </Box>
      )}

      {entry && (
        <>
          <SectionTitle>
            Folders (top {TOP_N})
            {entry.status === 'scanning' && folderRows.length > 0 && (
              <Text dimColor italic> (cached — updating…)</Text>
            )}
          </SectionTitle>
          {totalFolderRows > 0 && (
            <Text dimColor>
              Showing {safeOffset + 1}-{Math.min(safeOffset + folderViewSize, totalFolderRows)} of {totalFolderRows}
            </Text>
          )}
          {folderRows.length === 0 ? (
            <Text dimColor>(none)</Text>
          ) : (
            <Rows
              items={folderRows}
              selectedIndex={Math.min(selectedIndex - safeOffset, folderRows.length - 1)}
            />
          )}
        </>
      )}

      {deletePrompt && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>
            {deletePrompt.status === 'working' ? 'Deleting…' : 'Delete selected folder?'}
          </Text>
          <Text>
            <Text color="yellow">{deletePrompt.path}</Text>
          </Text>
          {deletePrompt.error && (
            <Text color="red">Error: {deletePrompt.error}</Text>
          )}
          <Text dimColor>
            {deletePrompt.status === 'working' ? 'Please wait…' : 'Press y to confirm, n to cancel'}
          </Text>
        </Box>
      )}
    </Box>
  );
}
