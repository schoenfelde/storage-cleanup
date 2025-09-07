Project Agent Guide

Scope and Goal
- Purpose: Help a macOS user quickly locate the largest folders, files, and common heavy caches to manually reclaim disk space. This is a review/reporting tool — it must never delete data by default.
- Target platform: macOS (BSD utilities). The CLI shells out to `find` and `du` for accurate, fast disk usage.

Primary Interface
- TypeScript + Ink CLI exposed via `pnpm start`.
- Interactive Navigator (default):
  - Launches if no legacy subcommand is passed.
  - Auto-scans `$HOME` on launch; caches within session and persists across runs.
  - Keybindings: Up/Down select; Right/Enter/Space enter (auto-refresh); Left/`b` parent (auto-refresh); `r` rescan; `o` open selected item in Finder (or current); `g/G` top/bottom; `q`/Esc quit.
  - Shows top 30 subfolders by size. Current directory’s total size is displayed under the header.
  - Cached results render immediately; while scanning, show a compact colorized progress bar + spinner. No ETA, only counts + elapsed.
- Legacy subcommands (still supported):
  - `dirs`: Largest subfolders (depth 1) under a path.
  - `files`: Largest files with a minimum size threshold.
  - `nodes`: Largest `node_modules` directories under a path.
  - `preset`: High-signal overview (Downloads, Movies, Library, Xcode/iOS, Android/Gradle, JS caches, Homebrew, Docker, Adobe, DaVinci) plus top `node_modules`.

Design Principles
- Read-only: strictly report sizes and paths; do not modify or delete files.
- macOS-first: prefer BSD-compatible flags (e.g., `find -size +100M`, `du -skx`).
- Performance: leverage `du` for directory sizes and `stat`/file size via Node when needed; paginate via `--top` to limit output.
- Transparency: show absolute paths and human-readable sizes; avoid hiding results behind opinionated filters.
- Safety: stay on the same filesystem (use `du -x`) to avoid scanning mounted volumes unintentionally.

Repo Layout
- `src/` TypeScript source
  - `src/index.tsx` (entrypoint: navigator by default, legacy UI when subcommands present)
- `src/ui/Navigator.tsx` (interactive cached navigator, key handling, viewport; folders-only UI)
  - `src/ui/App.tsx` (legacy one-shot commands: dirs/files/nodes/preset)
- `src/scanners.ts` (spawn + scanning helpers; progress hooks; BSD `find`/`du`)
- `src/persist.ts` (disk cache under project `.storage-cleanup-cache/cache.json`)
- `src/utils.ts` (formatting helpers, path utilities)
- `package.json`, `tsconfig.json` (pnpm, TypeScript config)
- `README.md` usage and examples
- `.gitignore` includes `.storage-cleanup-cache/`

Operational Notes
- Node 18+ required (ESM, Ink 4). Use `pnpm`.
- Interactive mode requires a TTY (Ink raw mode). Run in a terminal.
- Progress updates are throttled and guarded by a scan token to avoid flicker or stale updates. No ETA shown.
- Exclusions (legacy subcommands) are substring matches; default is to show everything.
- `preset` should remain fast and actionable; add new heavy locations cautiously and keep labels clear.

Future Work Ideas (non-destructive)
- Output formats: `--json`, `--csv` to export results.
- Config file: default start paths, excludes, and top counts.
- Optional depth parameter for `dirs` (with strong warnings about time cost at depth > 1).
- Per-domain helpers (e.g., summarize Xcode simulators by runtime).
 - Add focus toggle (e.g., Tab) to scroll Files pane; live controls for file-size threshold.

Out-of-Scope / Safety Constraints
- Do not implement deletion or mutation without explicit user request and an interactive confirmation flow. Even then, default to dry-run.
- Avoid Linux/GNU-only flags unless gated; maintain macOS compatibility.
