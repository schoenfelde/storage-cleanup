Storage Cleanup CLI (macOS)

Overview
- A macOS‑friendly CLI (TypeScript + Ink) to surface large folders, files, and common heavy caches so you can manually review and reclaim space.
- Interactive Navigator: arrow‑key UI that lets you browse folders, scan on demand, and cache results within a session.

What It Finds
- Largest subfolders at depth 1 under a path.
- Largest files with a minimum size filter.
- Largest node_modules folders (great for old projects).
- Common heavy locations: Xcode/Simulators, Android/Gradle, npm/Yarn/pnpm caches, Homebrew, Docker, Adobe, DaVinci, Downloads, Movies, Library caches.

Getting Started (pnpm)
Requirements
- Node.js 18+ on macOS.
- System utilities available in PATH: `find`, `du`.

1) Install deps
   - pnpm install

2) Run (dev)
   - pnpm start -- preset --top 20
   - pnpm start -- dirs --path "$HOME" --top 30
   - pnpm start -- files --path "$HOME" --min-size-mb 500 --top 50
   - pnpm start -- nodes --path "$HOME/code" --top 50
   - pnpm start           # Interactive Navigator (default)

3) Build a binary script and run
   - pnpm run build
   - node dist/index.js preset --top 20
   - node dist/index.js dirs --path "$HOME/Library" --top 40

4) Optional: expose as a global (local project)
   - pnpm link --global
   - storage-scan preset --top 20

CLI Commands
- dirs
  - List largest immediate subfolders for a path.
  - Options: --path PATH (default: $HOME), --top N, --exclude GLOB (repeatable), --debug

- files
  - List largest files under a path with size threshold.
  - Options: --path PATH, --top N, --min-size-mb M (default: 100), --exclude GLOB (repeatable)

- nodes
  - Find largest node_modules directories under a path.
  - Options: --path PATH, --top N, --exclude GLOB (repeatable)

- preset
  - Quick scan of common heavy locations and top node_modules, plus depth‑1 scans of Downloads, Movies, and Library.
  - Options: --top N (applies to lists within the preset where relevant)

- nav (interactive default)
  - Arrow‑key navigator with session caching
  - Behavior:
    - Auto‑scans the start directory ($HOME) on launch (top 30)
    - Up/Down: select a subfolder
    - Right, Enter, or Space: enter folder (auto‑refresh)
    - Left or b: go to parent (auto‑refresh)
    - r: rescan current folder
    - o: open selected item in Finder (or current folder if none)
    - q / Esc: quit
  - Shows Folders (top 30) by size; current folder’s total size shown under header
  - While scanning, shows a compact, colorized progress bar and spinner; cached results remain visible and update when complete
  - Caches scans during the session and persists to disk between runs (.storage-cleanup-cache/cache.json in the project directory)

Notes
- The tool only reports sizes; it never deletes anything.
- Excludes are substring matches. To see everything, don’t pass --exclude.
- For broad scans, start with files --min-size-mb 500 to quickly surface biggest wins, then lower as needed.
 - Implementation uses macOS `find` and `du` for speed and accurate sizes.
 - Interactive mode requires a TTY. If you see a "Raw mode is not supported" error, run in a regular terminal (not via a non‑interactive runner).
 - If `dirs` prints no results, try adding `--debug`. The CLI will fall back to using `find` to list immediate directories and will log a short debug note if the initial readdir fails or returns empty.

Areas Commonly Worth Reviewing
- Xcode: DerivedData, Archives, iOS Simulator devices.
- Android/Gradle caches.
- JS package caches: npm, Yarn, pnpm.
- Media app caches: Adobe Media Cache, DaVinci CacheClip/ProxyMedia.
- Docker Desktop VM disk (Docker.raw).
- ~/Downloads and ~/Movies subfolders.

Safety Tip
- Always review before deleting. For dev projects, removing node_modules in inactive projects is generally safe; active projects may need them kept or reinstalled.
