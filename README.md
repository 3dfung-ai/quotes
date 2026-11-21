---
title: Quotes – standalone quote library with Discover
tags: [quotes, pwa, offline-first, google-drive-sync, apps-script, discover]
last_verified: 2026-11-21
---

# Quotes

**TL;DR:** Open <https://3dfung-ai.github.io/quotes/> in Brave on each PC and bookmark it. It works offline, saves in the browser first, and syncs a separate data file in your own Google Drive (`My Drive/00_Apps/Quotes/quotes-sync.json`) through your own Apps Script. Same pattern as Linework, separate data.

## What it does
- **Discover** (landing view): a daily set drawn from your own library, least-seen first, spread across tags and authors, no repeats until everything has been shown. Next, Previous, Shuffle. Show history stays on each PC.
- **Related**: every opened quote shows 3–5 related saved quotes with a reason (shared tag, shared words, same author). Local and offline; near-duplicates are hidden.
- **Library**: search (case-insensitive substring across text, author, source, notes and tags), exact tag filters with counts, browse by author or source, newest first, Random within the current list.
- **Capture and edit**: quick capture (N), full editor, duplicate warning, tags with suggestions. Unchanged fields keep their exact stored value.
- **Trash**: recoverable deletion; Delete forever only from Trash.
- **Capture bookmarklet**: highlight text on any page, click the bookmark.

## Sync and safety
| What | How |
|---|---|
| This PC | IndexedDB, one atomic transaction per save; one tab in charge at a time |
| Shared copy | One JSON file in your Drive, written by your Apps Script under a lock |
| Same quote edited on both PCs | Fields merged one by one; only a field changed on both sides to different values is held for you to choose |
| Deleted on one PC, edited on the other | Kept |
| Backups (Drive) | Automatic before the first change each day, before imports and restores; newest 40 kept |
| Backups (this PC) | Before every import, restore and Empty Trash; newest 12 kept |
| Corrupt Drive file | Never overwritten; restore a backup from Settings › Backups |

## Files
| File | Purpose |
|---|---|
| `index.html` | The whole app (no external code, no tracking) |
| `sw.js`, `manifest.webmanifest`, icons | Offline start and "Install as app" |
| `quotes-sync.gs` | The Apps Script, for reference. The app has a Copy button for it |

No quotes or personal data are stored in this repository.
