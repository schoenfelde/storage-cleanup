# 🧹 storage-cleanup

macOS disk usage navigator and scanners (TypeScript + Ink). Quickly surface the largest folders, files, and common heavy caches so you can review and reclaim space. Read‑only by default — no deletions.

• Node 18+ • macOS (BSD utils) • Read‑only


## Why

Finding where your disk space went is tedious. This CLI shells out to fast, accurate macOS tools (`du`, `find`) and presents results in either:

- An interactive navigator (default) to browse and rescan folders with cached results, or
- Focused one‑shot commands for directories, files, `node_modules`, and a curated preset of heavy locations.


## Features

- Interactive navigator with live progress and session/disk caching
- Largest subfolders (depth 1) under any path
- Largest files with size threshold
- Largest `node_modules` directories
- High‑signal preset: Downloads, Movies, Library, Xcode/iOS, Android/Gradle, JS caches, Homebrew, Docker, Adobe, DaVinci
- Transparent sizes: absolute paths + human‑readable output
- macOS‑first: BSD‑compatible flags; stays on same filesystem via `du -x`
- Read‑only reporting — never deletes data


## Quick Start

Requirements

- Node.js 18+ on macOS
- `du` and `find` available in your `PATH` (default on macOS)

Install

```bash
pnpm install
```

Run (interactive navigator)

```bash
pnpm start
```

Run (legacy subcommands)

```bash
# Quick preset overview (recommended first pass)
pnpm start -- preset --top 20

# Largest subfolders (depth 1)
pnpm start -- dirs --path "$HOME" --top 30

# Largest files under a path
pnpm start -- files --path "$HOME" --min-size-mb 500 --top 50

# Largest node_modules under a path
pnpm start -- nodes --path "$HOME/code" --top 50
```

Build and run the compiled CLI

```bash
pnpm run build
node dist/index.js preset --top 20
node dist/index.js dirs --path "$HOME/Library" --top 40
```

Optional: use as a global (local project)

```bash
pnpm link --global
storage-scan preset --top 20
```


## Interactive Navigator

Launch with `pnpm start` (or by running without a subcommand). It auto‑scans `$HOME` on launch and shows the top 30 subfolders by size. Cached results render immediately; while scanning, you’ll see a compact colorized progress bar with counts and elapsed time.

Keybindings

| Key                    | Action                              |
| ---------------------- | ----------------------------------- |
| Up/Down                | Select subfolder                     |
| Right / Enter / Space  | Enter folder + auto‑refresh          |
| Left / b               | Go to parent + auto‑refresh          |
| r                      | Rescan current folder                |
| o                      | Open selected/current in Finder      |
| g / G                  | Jump to top / bottom                 |
| q / Esc                | Quit                                 |

Notes

- Current directory total size is shown under the header.
- Results persist between runs under `.storage-cleanup-cache/cache.json` in the project directory.
- Interactive mode requires a TTY. If you see “Raw mode is not supported”, run in a normal terminal.


## Legacy Subcommands

`dirs`

- Largest immediate subfolders under a path (depth 1).
- Options: `--path PATH` (default: `$HOME`), `--top N`, `--exclude GLOB` (repeatable), `--debug`

`files`

- Largest files under a path with size threshold.
- Options: `--path PATH`, `--top N`, `--min-size-mb M` (default: `100`), `--exclude GLOB` (repeatable)

`nodes`

- Largest `node_modules` directories under a path.
- Options: `--path PATH`, `--top N`, `--exclude GLOB` (repeatable)

`preset`

- High‑signal overview: known heavy locations (Downloads, Movies, Library, Xcode/Simulators, Android/Gradle, JS caches, Homebrew, Docker, Adobe, DaVinci) and top `node_modules`.
- Option: `--top N` applied to relevant lists within the preset.


## Safety & Compatibility

- Read‑only: this tool only reports sizes and paths; it never deletes or modifies files.
- macOS‑first: uses BSD‑compatible flags, e.g. `find -size +100M`, `du -skx`.
- Same filesystem: `du -x` avoids crossing into mounted volumes.
- Exclusions: substring matches; to see everything, omit `--exclude`.


## Caching & Performance

- Directory sizes use `du -skx` for speed and accuracy on macOS.
- Large file sizes read via Node `stat` when scanning `files`.
- Progress callbacks are throttled and guarded to avoid flicker or stale updates.
- Cache persists between sessions at `.storage-cleanup-cache/cache.json` within the project directory.


## Examples

```bash
# Triage downloads
pnpm start -- dirs --path "$HOME/Downloads" --top 30

# Find the biggest single files quickly
pnpm start -- files --path "$HOME" --min-size-mb 1000 --top 25

# Hunt down monster node_modules
pnpm start -- nodes --path "$HOME/code" --top 100
```


## Troubleshooting

- No results from `dirs`? Try `--debug`. The CLI will fall back to `find` if a direct readdir returned empty.
- Interactive mode errors about “raw mode”: run in a regular terminal (not a non‑interactive runner).
- Slow scan of an enormous directory? Narrow the scope first (use `preset`, then drill down).


## Roadmap (non‑destructive)

- Optional output formats: `--json`, `--csv`
- Config file for defaults: start paths, excludes, top counts
- Optional depth for `dirs` (with clear warnings for depth > 1)
- Per‑domain helpers (e.g., summarize Xcode simulators by runtime)
- UI niceties: focus toggle for a Files pane; live controls for file‑size thresholds


## Notes

- Common areas worth reviewing: Xcode DerivedData/Archives/Simulators, Android/Gradle caches, npm/Yarn/pnpm caches, Adobe Media Cache, DaVinci CacheClip/ProxyMedia, Docker Desktop VM disk (`Docker.raw`), `~/Downloads`, `~/Movies`.
- Always review before deleting. For dev projects, removing `node_modules` in inactive projects is generally safe; active projects may need them kept or reinstalled.
