# opencode-memory-work v0.0.2

Public copy and configuration cleanup.

## Changes

- Refined README, package metadata, and in-product copy for public release.
- Added `~/.opencode-memory-work/` as the primary user config location.
- Kept legacy `~/.pal/` config fallback for compatibility (read-only).
- Cleaned tool/system guidance text and removed stale internal naming.

## Install

```sh
opencode plugin opencode-memory-work -g
```

Or add to `opencode.json`:

```json
{
  "plugin": ["opencode-memory-work"]
}
```
