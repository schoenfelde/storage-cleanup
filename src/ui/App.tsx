#!/usr/bin/env node
import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import {humanFromKB, SizeEntry} from '../utils.js';
import {presetLocations, scanDirsDepth1, scanLargeFiles, scanNodeModules, sizeIfExists, Progress} from '../scanners.js';

type Cmd = 'dirs' | 'files' | 'nodes' | 'preset';

function parseArgs(argv: string[]) {
  const a = argv[0] === '--' ? argv.slice(1) : argv.slice();
  const maybeCmd = a[0] as Cmd | undefined;
  const cmd: Cmd = (maybeCmd === 'dirs' || maybeCmd === 'files' || maybeCmd === 'nodes' || maybeCmd === 'preset') ? maybeCmd : 'preset';
  let startPath = process.env.HOME || process.cwd();
  let top = 25;
  let minSizeMb = 100;
  const excludes: string[] = [];
  let debug = false;

  for (let i = 1; i < a.length; i++) {
    const token = a[i];
    if (token === '--path') startPath = a[++i]!;
    else if (token === '--top') top = parseInt(a[++i]!, 10) || top;
    else if (token === '--min-size-mb') minSizeMb = parseInt(a[++i]!, 10) || minSizeMb;
    else if (token === '--exclude') excludes.push(a[++i]!);
    else if (token === '--debug') debug = true;
    else if (token === '-h' || token === '--help') return { cmd: 'help' as any };
  }
  return { cmd, startPath, top, minSizeMb, excludes, debug };
}

function Header({children}: {children: React.ReactNode}) {
  return (
    <Box marginTop={1}><Text color="cyan" bold>{children}</Text></Box>
  );
}

function Listing({items}: {items: SizeEntry[]}) {
  return (
    <>
      {items.map((it, i) => (
        <Box key={i}>
          <Text color="green">{humanFromKB(it.kb).padEnd(8)}</Text>
          <Text> </Text>
          <Text>{it.path}</Text>
        </Box>
      ))}
    </>
  );
}

function Help() {
  return (
    <>
      <Text>storage-scan (Ink) - macOS disk usage helper</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Usage:</Text>
        <Text>  storage-scan dirs   --path PATH --top N --exclude GLOB...</Text>
        <Text>  storage-scan files  --path PATH --top N --min-size-mb M --exclude GLOB...</Text>
        <Text>  storage-scan nodes  --path PATH --top N --exclude GLOB...</Text>
        <Text>  storage-scan preset --top N</Text>
      </Box>
    </>
  );
}

export default function App() {
  const args = useMemo(() => parseArgs(process.argv.slice(2)), []);
  const [items, setItems] = useState<SizeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [startTs] = useState<number>(Date.now());
  const [, forceTick] = useState(0);

  // Re-render every 250ms while loading to update elapsed/ETA
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => forceTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    (async () => {
      if ((args as any).cmd === 'help') { setLoading(false); return; }
      try {
        const onProg = (p: Progress) => setProgress(p);
        if (args.cmd === 'dirs') {
          const res = await scanDirsDepth1(path.resolve(args.startPath!), args.excludes!, (args as any).debug, onProg);
          setItems(res.slice(0, args.top));
        } else if (args.cmd === 'files') {
          const res = await scanLargeFiles(path.resolve(args.startPath!), args.minSizeMb!, args.excludes!, onProg);
          setItems(res.slice(0, args.top));
        } else if (args.cmd === 'nodes') {
          const res = await scanNodeModules(path.resolve(args.startPath!), args.excludes!, onProg);
          setItems(res.slice(0, args.top));
        } else if (args.cmd === 'preset') {
          // For preset, we don’t show a single list; just mark done here.
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [args]);

  if ((args as any).cmd === 'help') return <Help/>;

  if (args.cmd === 'preset') {
    const [sections, setSections] = useState<Array<{label: string; entries: SizeEntry[]}>>([]);
    useEffect(() => {
      (async () => {
        const out: Array<{label: string; entries: SizeEntry[]}> = [];
        // High-level known locations
        const sized: SizeEntry[] = [];
        for (const loc of presetLocations) {
          const v = await sizeIfExists(loc.path);
          if (v) sized.push(v);
        }
        sized.sort((a, b) => b.kb - a.kb);
        out.push({ label: 'Common Locations', entries: sized });

        // Largest node_modules
        const nodes = (await scanNodeModules(process.env.HOME!, [])).slice(0, args.top);
        out.push({ label: `Largest node_modules (home) (top ${args.top})`, entries: nodes });

        // Largest folders under Downloads, Movies, Library (depth 1)
        const dl = process.env.HOME ? path.join(process.env.HOME, 'Downloads') : '';
        const mv = process.env.HOME ? path.join(process.env.HOME, 'Movies') : '';
        const lib = process.env.HOME ? path.join(process.env.HOME, 'Library') : '';
        if (dl && fsExists(dl)) out.push({ label: `Downloads (depth 1, top ${args.top})`, entries: (await scanDirsDepth1(dl, [])).slice(0, args.top) });
        if (mv && fsExists(mv)) out.push({ label: `Movies (depth 1, top ${args.top})`, entries: (await scanDirsDepth1(mv, [])).slice(0, args.top) });
        if (lib && fsExists(lib)) out.push({ label: `Library (depth 1, top ${args.top})`, entries: (await scanDirsDepth1(lib, [])).slice(0, args.top) });

        setSections(out);
        setLoading(false);
      })();
    }, []);

    return (
      <Box flexDirection="column">
        <Text>Quick scan of common heavy locations</Text>
        {loading && <Text color="yellow">Scanning…</Text>}
        {!loading && sections.map((sec, i) => (
          <Box key={i} flexDirection="column">
            <Header>{sec.label}</Header>
            {sec.entries.length === 0 ? <Text dimColor>(none)</Text> : <Listing items={sec.entries}/>}          
          </Box>
        ))}
      </Box>
    );
  }

  const elapsedMs = Date.now() - startTs;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const pct = progress && progress.total > 0 ? Math.min(100, Math.floor((progress.processed / progress.total) * 100)) : 0;
  // ETA intentionally omitted for now; percent + elapsed are sufficient.

  return (
    <Box flexDirection="column">
      {loading && (
        <Text color="yellow">Scanning… {progress ? `${progress.processed}/${progress.total} (${pct}%)` : ''} | elapsed {elapsedSec}s</Text>
      )}
      {!loading && (
        <>
          <Header>
            {args.cmd === 'dirs' && `Largest subfolders of ${path.resolve(args.startPath!)}`}
            {args.cmd === 'files' && `Largest files >= ${args.minSizeMb}MB under ${path.resolve(args.startPath!)}`}
            {args.cmd === 'nodes' && `Largest node_modules under ${path.resolve(args.startPath!)}`}
          </Header>
          {items.length === 0 ? <Text dimColor>(no results)</Text> : <Listing items={items} />}
        </>
      )}
    </Box>
  );
}

function fsExists(p: string) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
