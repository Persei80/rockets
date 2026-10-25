# Мои ракеты · My Rockets — notes for Claude

The owner speaks Russian (answer in Russian, simple words), lives in Israel and is
new to investing. He buys small amounts (≈300 ₪/month) of young, little-known US
companies through the Israeli app **Blink** (fractional shares, amounts in dollars,
25% tax on profit only, ~1.5% dollar-exchange spread). He wants ×10–×20 "rockets":
no index funds, ETFs or big known companies. He wants everything free (Max
subscription only, no paid cloud or API).

Do not touch the `persei80/stock-watch` repository: it belongs to a friend's friend.

## The app

- Static site, vanilla HTML/CSS/ES modules, no build step. Published by GitHub Pages
  from `main`: https://persei80.github.io/rockets/ — pushing to `main` is deploying.
- All user data lives in the browser (`localStorage` keys `rk.data`, `rk.prefs`).
  The Safari "Add to Dock" app has its own storage; data moves via backup files.
- Market data: public CNBC endpoints; USD/ILS from CNBC `ILS=` with Frankfurter as
  fallback; logos from financialmodelingprep. See `README.md` for the file map.
- RU/EN strings in `js/strings.js` (every key in both languages); `sw.js` lists every
  file and its cache name must be bumped when files are added.
- Tests: `tools/README.md`. Run them before every push.

## Monthly / weekly report

- `REPORT.md` — prompt the owner pastes into Claude on the 10th (payday).
- `claude/ROUTINE.md` — the automatic check: research `claude/tracked.txt`, write
  `claude/report.json`; the app loads it on start (`js/report.js`), files verdicts
  under each company (`js/opinions.js`) and offers new candidates.
- Running it in Claude's cloud costs the owner's cloud credit, so the two scheduled
  tasks were created and then paused. To run it for free, do it here, locally:
  "сделай проверку по claude/ROUTINE.md", then commit and push.
