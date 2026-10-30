# D&D Campaign Manager (web)

A D&D campaign wiki, party tracker, battle tracker and living-world simulator for the world of Pallimustus,
now runnable as a single web page. The goal is an automatic DM for one player: see the
[Auto DM adaptation plan](https://claude.ai/artifact/MRGS7VhTcDVCfNFvu3qTM4).

## Run it

- **On GitHub Pages:** pushes to `main` publish `dist/index.html` through `.github/workflows/pages.yml`.
  Turn it on once in the repo's Settings → Pages → Source: GitHub Actions.
- **Locally:** `npm install`, `npm run build:web`, then open `dist/index.html` from any static server
  (for example `npx serve dist`). The file is self-contained, about 9 MB.

## How the web build works

The app was a Windows desktop app (Electron). All of its logic lives in `src/renderer/`, which talks to the disk
only through `window.api`. The web build swaps that one piece:

- `web/api.js` is the browser version of `src/main.js`: the same calls, storing campaigns in IndexedDB.
  Starter upgrades, the trash and backups behave as on the desktop, and `.dndcampaign` backups move between the two.
- File dialogs become downloads and file pickers. Handouts print through the browser's print dialog.
  The battle's player view opens in another tab and follows along over a BroadcastChannel.
- `web/build.mjs` bundles everything (scripts, styles, the starter campaign, the blank character sheet)
  into `dist/index.html`.

Campaigns live in the browser's site storage, so they stay with one browser on one device.
Use **Switch or back up → Export** to keep a copy or move to another device.
