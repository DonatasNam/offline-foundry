# Offline Foundry

An offline-first PWA character sheet for our D&D table. No accounts, no server of its
own: characters arrive by scanning **JSON Grab** QR codes from Foundry VTT
(see [fvtt-json-grab](https://github.com/DonatasNam/fvtt-json-grab)), are stored on the
phone in IndexedDB, and stay usable with no connection at all: track HP, spell slots,
and item uses at the table.

## How it works

1. In Foundry, open a character sheet and press the QR button (JSON Grab module).
2. In this app, tap **Scan** and point the camera at the code
   (paste-a-link and file import work too).
3. The character is stored locally, keyed by its Foundry uuid: re-scanning updates it
   in place, and the roster's refresh button re-fetches from the last link while it
   is still alive.

Payload contract: `docs/app-schema.md` in the module repository. The app depends on
that schema only, never on Foundry or dnd5e internals.

## Stack

Deliberately boring: static files, vanilla ES modules, no build step, no framework.

- `index.html`, `css/app.css`: shell and theme
- `js/app.js`: hash router (roster / sheet / scan), toasts, install hint, SW updates
- `js/db.js`: IndexedDB (store `characters`, keyed by uuid)
- `js/sync.js`: link parsing, payload fetch and validation, local tracking state
- `js/scanner.js`: camera scanning, BarcodeDetector with vendored jsQR fallback (iOS)
- `js/sheet.js`: sheet rendering and HP/slot/uses tracking
- `sw.js`: precache app shell, cache-first, offline portraits
- `js/lib/jsQR.js`: vendored [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)

## Hosting

Served same-origin with Foundry (no CORS): nginx `alias` of `/app/` to
`/var/www/offline-foundry/`. Deploy = copy files there. The service worker
versions the cache; bump `VERSION` in `sw.js` when releasing so clients pick
up the update and show the reload toast.

## iPhone notes

Install via Safari: Share, then Add to Home Screen (the app shows a one-time hint).
Camera scanning uses jsQR because iOS lacks BarcodeDetector. iOS never routes links
into installed PWAs, so scanning happens inside the app; the paste box covers every
other path.
