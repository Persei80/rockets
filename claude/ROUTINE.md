# Automatic check for «Мои ракеты»

A scheduled Claude run follows this file. It researches the companies, writes
`claude/report.json`, and the app (https://persei80.github.io/rockets/) picks
the file up on start. The owner is a beginner investor in Israel who buys small
amounts of young US companies through the Blink app (fractional shares, amounts
in dollars, about 300 ₪ a month). Write every text field in Russian, in very
simple words, like for someone who is new to investing.

## What to do on each run

1. Today's date in Israel decides the kind of run:
   - the 10th of the month → `"kind": "monthly"` (full report with new picks);
   - any other day → `"kind": "weekly"` (only verdicts on tracked companies).
2. Read `claude/tracked.txt` (one ticker per line) and, if present, the
   previous `claude/report.json`. These are the companies to check.
3. For each tracked ticker, search the web for news and price moves since the
   previous report (or the last 7 days if there is none). Check facts in more
   than one source where you can, never invent numbers, and note dates.
4. Give each ticker one verdict:
   - `ok` — the move comes from market mood or a one-off reason; the idea is intact;
   - `watch` — worrying news (cash running out, new share sales, weak results, key people leaving);
   - `broken` — the reason to own it no longer holds.
   The `text` (at most 550 characters) is 3–4 short sentences: why the price
   moved, what comes next (for example the next earnings date) and whether it is
   getting better or worse. It ends with a clear advice for this week, starting
   with «Совет:» — «докупать сейчас», «подождать 1–2 недели», «подождать до
   отчёта (дата)», «подождать месяц», «не докупать» or «продать» — and the
   reason in a few words. This is Claude's own opinion; say it plainly.
5. Monthly runs only:
   - Pick up to 3 new candidates, strongest first, with the rules below, and add
     each to `claude/tracked.txt`.
   - `plan`: one or two sentences with exact amounts for about 300 ₪: about 200 ₪
     to top up 1–2 tracked companies doing well, about 100 ₪ for one new
     candidate (only if one is truly strong). Never more than 20% of the money in
     one company. The owner's exact holdings are private; base the plan on the
     tracked list.
   - `creative`: one line on young creative companies (games, film and animation,
     music, tools for artists including AI for video, 3D and animation): name a
     strong one (and list it as a candidate with `"creative": true`) or say that
     there is none this month and why.
   - `bitcoin`: empty, unless bitcoin trades below $35,000 (the record was about
     $126,000 in October 2025). Then: "⚠️ Биткоин упал до $…", your view on the
     chance of returning to $100,000, and whether to buy a bitcoin fund in Blink
     (for example IBIT) for 100–200 ₪.
   - Put each new candidate into `watch` too (see 7), and take out of `watch`
     and `claude/tracked.txt` any company whose idea is `broken` or which is
     clearly no longer worth a place (say why in its last verdict).
6. Weekly runs: `candidates` is `[]`, `creative` and `bitcoin` are `""`.
   `plan` is one sentence on what to do this week, for example «На этой неделе:
   ничего не покупать, ждём отчёт AMPX 6 ноября» or «На этой неделе можно
   докупить SLDP на 100 ₪». Still mention bitcoin in `bitcoin` if it is below
   $35,000.
7. Every run writes `watch`: the owner's whole watchlist, which Claude keeps.
   The app makes its «Наблюдаю» list match it: it adds what is new, replaces the
   text of what is there and removes the companies Claude dropped (companies the
   owner added by hand stay). So always write the full list — start from the
   previous report's `watch`, never leave it out or empty by accident.
   `claude/tracked.txt` holds the same tickers. Each entry: `symbol`, `name`,
   `risk` (`high`, `vhigh` or `lottery`) and `why` (at most 450 characters):
   what the company does, why it is interesting, the main risks and what decides
   the next step. Rewrite `why` only when something important changed;
   the week's news belongs in `opinions`. Every ticker in `watch` gets a verdict
   in `opinions`. Dropped companies get a last `broken` verdict saying why.

## How to run it cheaply

The run is scheduled on the owner's Mac (Claude desktop app, scheduled tasks):
weekly on Monday at 08:00 Israel time, monthly on the 10th at 08:00. It uses the
Max subscription, not cloud credit. Do the research with cheaper subagents
(`model: "sonnet"`), one per ticker in parallel, plus one for the market mood and
bitcoin; then check their numbers against each other and write the file yourself.

### Rules for new candidates

- Market value roughly $50 million – $1.5 billion, closer to the lower end is better.
- Listed on NASDAQ or NYSE for at most ~5 years, little known.
- A genuinely new technology or product that could create or take a large market.
- A real product or technical results, and cash for at least ~18 months.
- Not: shares under $1, OTC, empty SPACs, pump-and-dump stories, companies close to bankruptcy.
- No index funds, ETFs or large well-known companies.
- `amount`: 100, 150 or 200 (shekels). `risk`: `high`, `vhigh` or `lottery`.
- `why`: what the company does (as for a child), why this one, what could go
  wrong, price, market value and how long the cash lasts — 3–5 short sentences.

## The file

Write `claude/report.json` (UTF-8, valid JSON, exactly these fields) and a copy at
`claude/reports/YYYY-MM-DD.json`:

```json
{
  "date": "YYYY-MM-DD",
  "kind": "weekly",
  "summary": "Одна-две фразы: что происходило с маленькими компаниями.",
  "plan": "",
  "opinions": [
    { "symbol": "AMPX", "verdict": "ok", "text": "Почему цена так двигается. Что дальше." }
  ],
  "candidates": [
    { "symbol": "ABCD", "name": "Company Inc", "why": "…", "risk": "vhigh", "amount": 100, "creative": false }
  ],
  "creative": "",
  "bitcoin": "",
  "watch": [
    { "symbol": "AMPX", "name": "Amprius Technologies, Inc.", "risk": "high", "why": "Что делает. Чем интересна. Риски. Что решит дальше." }
  ],
  "sources": [ { "title": "Short title", "url": "https://…" } ]
}
```

Check it with `python3 -m json.tool claude/report.json` before committing.

## Saving

- Change only files inside `claude/`. Never touch the app's code or any other
  repository (in particular, never change `persei80/stock-watch`).
- Commit to `main` of `Persei80/rockets` with the message `Claude check YYYY-MM-DD`
  and push. If the push fails because of the network, retry a few times.
