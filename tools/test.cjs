// End-to-end walk through the app with mocked market data, in both languages.
// usage: node test.cjs <baseUrl> <shotsDir>
const fs = require('fs');
const { chromium } = require('playwright');
const { install } = require('./mock.cjs');

const base = process.argv[2];
const shots = process.argv[3];
const errors = [];
let step = 0;

const L = {
  ru: {
    empty: 'Здесь будут ваши ракеты', fee: '155,00', closeHint: /закрытия/, tooMany: /Нельзя продать больше/,
    monthly: /каждый месяц/, budget150: /из 150,00/, budget200: /из 200,00/, why: 'Делают маленькие модульные ядерные реакторы.\nРиск: всё ещё нет выручки.',
    note: 'Охлаждение батарей.', rules: 'Правило один\nПравило два', mask: '••• ₪',
    opinions: 'Вот блок:\n```\nМНЕНИЕ CLAUDE {d}\nТикер | Статус | Причина\nKULR | под вопросом | Компания объявила выпуск новых акций.\n**SERV** | идея сломалась | Главный клиент ушёл.\n| NNE | временно | Упала вместе со всем рынком. |\nZZZZ | временно | Тест.\n```',
    servReason: 'Главный клиент ушёл.',
  },
  en: {
    empty: 'Your rockets will live here', fee: '155.00', closeHint: /closing price/, tooMany: /can’t sell more/,
    monthly: /every month/, budget150: /of ₪150\.00/, budget200: /of ₪200\.00/, why: 'Small modular nuclear reactors.\nRisk: no revenue yet.',
    note: 'Battery cooling.', rules: 'Rule one\nRule two', mask: '₪ •••',
    opinions: 'Here it is:\n```\nCLAUDE’S TAKE {d}\nTicker | Status | Reason\nKULR | watch closely | Announced a new share sale.\n**SERV** | thesis broken | Lost its main customer.\n| NNE | temporary | Fell with the whole market. |\nZZZZ | temporary | Test.\n```',
    servReason: 'Lost its main customer.',
  },
};

function check(cond, msg) {
  if (!cond) { errors.push('FAIL: ' + msg); console.log('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/${String(++step).padStart(2, '0')}-${name}.png` });
}

async function pick(page, inputSel, text, symbol) {
  await page.fill(inputSel, '');
  await page.type(inputSel, text, { delay: 20 });
  const li = page.locator(`${inputSel} >> xpath=.. >> .suggestions li`, { hasText: symbol }).first();
  await li.waitFor({ timeout: 4000 });
  await li.dispatchEvent('mousedown');
}

// Text on screen must not show raw string keys; English must have no Cyrillic.
async function checkText(page, lang, where) {
  // Language names are shown in their own language on purpose, and Claude's
  // take and the report are model-written text, in whatever language they came in.
  const text = (await page.evaluate(() => [...document.querySelectorAll('.op-text, .ut')]
    .reduce((s, el) => s.split(el.innerText).join(''), document.body.innerText))).replace(/Русский/g, '');
  const keys = text.match(/\b(?:pf|tm|w|d|tx|s|wl|plan|ach|err|f|top|cap|risk|stage|range|period|hist|tab)\.[a-zA-Z0-9.]+\b/g);
  check(!keys, `${where}: no raw string keys${keys ? ' (' + keys.slice(0, 3).join(', ') + ')' : ''}`);
  if (lang === 'en') {
    const cyr = text.match(/[А-Яа-яЁё][^\n]{0,30}/);
    check(!cyr, `${where}: no Russian text in English mode${cyr ? ' ("' + cyr[0] + '")' : ''}`);
  }
}

const reportDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const REPORT = {
  ru: {
    date: reportDate, kind: 'monthly', summary: 'Маленькие компании в этом месяце нервничали.', plan: 'Докупите NNE — 100 ₪; новая — TSLA, 100 ₪.',
    opinions: [{ symbol: 'NNE', verdict: 'ok', text: 'Падение временное.' }, { symbol: 'SERV', verdict: 'watch', text: 'Ждём отчёт.' }, { symbol: 'bad', verdict: 'x', text: '' }],
    candidates: [{ symbol: 'TSLA', name: 'Tesla Inc', why: 'Тестовый кандидат.', risk: 'vhigh', amount: 100 }, { symbol: 'NFLX', name: 'Netflix Inc', why: 'Кино.', risk: 'high', amount: 50, creative: true }],
    creative: 'Netflix — тест.', sources: [{ title: 'Пример', url: 'https://example.com/' }, { title: 'bad', url: 'javascript:alert(1)' }],
  },
  en: {
    date: reportDate, kind: 'monthly', summary: 'Small caps were jumpy this month.', plan: 'Add NNE — ₪100; new — TSLA, ₪100.',
    opinions: [{ symbol: 'NNE', verdict: 'ok', text: 'A temporary dip.' }, { symbol: 'SERV', verdict: 'watch', text: 'Waiting for results.' }, { symbol: 'bad', verdict: 'x', text: '' }],
    candidates: [{ symbol: 'TSLA', name: 'Tesla Inc', why: 'Test candidate.', risk: 'vhigh', amount: 100 }, { symbol: 'NFLX', name: 'Netflix Inc', why: 'Films.', risk: 'high', amount: 50, creative: true }],
    creative: 'Netflix — test.', sources: [{ title: 'Example', url: 'https://example.com/' }, { title: 'bad', url: 'javascript:alert(1)' }],
  },
};

const closed = (page, sel) => page.waitForSelector(sel + ':not([open])', { state: 'attached' });

async function run(viewport, tag, scheme, lang) {
  const T = L[lang];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, locale: lang === 'ru' ? 'ru-RU' : 'en-US', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || /missing string/.test(m.text())) errors.push(`[${tag}] console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await install(page, { report: REPORT[lang] });
  await page.goto(base + '/index.html');

  // ---- welcome ----
  console.log(`\n[${tag}] welcome`);
  await page.waitForSelector('#welcome[open]');
  await page.click(`#welcome [data-lang="${lang}"]`);
  check(await page.getAttribute('html', 'lang') === lang, 'language picked on welcome');
  await shot(page, `${tag}-welcome`);
  await checkText(page, lang, 'welcome');
  await page.fill('#wl-budget', '150');
  await page.click('#welcome-form button[type="submit"]');
  await closed(page, '#welcome');
  await page.waitForSelector('#view-portfolio .empty-hero');
  await page.waitForFunction(() => /3[.,]681/.test(document.querySelector('.fx-text').textContent));
  check(await page.locator('.empty-hero h2').textContent() === T.empty, 'empty portfolio shows hero');
  await checkText(page, lang, 'empty portfolio');

  // ---- watchlist ----
  console.log(`[${tag}] watchlist`);
  await page.click('#tabs [data-view="watch"]');
  await page.click('#view-watch [data-act="add"]');
  await pick(page, '#w-symbol', 'nano', 'NNE');
  check(await page.inputValue('#w-symbol') === 'NNE', 'search suggestion fills ticker');
  await page.fill('#w-why', T.why);
  await page.selectOption('#w-risk', 'lottery');
  await page.click('#w-submit');
  await page.waitForSelector('#view-watch .cand[data-symbol="NNE"]');
  for (const [q, s] of [['serve', 'SERV'], ['KULR', 'KULR'], ['ionq', 'IONQ'], ['rocket', 'RKLB']]) {
    await page.click('#view-watch [data-act="add"]');
    await pick(page, '#w-symbol', q, s);
    await page.fill('#w-why', 'Test note ' + s);
    await page.selectOption('#w-risk', 'vhigh');
    await page.click('#w-submit');
    await page.waitForSelector(`#view-watch .cand[data-symbol="${s}"]`);
  }
  check(await page.locator('#view-watch .cand').count() === 5, 'five candidates listed');
  check((await page.locator('.cand[data-symbol="KULR"] .badge.cap-micro').count()) === 1, 'micro-cap badge on KULR');
  check((await page.locator('.cand[data-symbol="IONQ"] .note-warn').count()) === 1, 'IONQ warns it is already big');
  await page.waitForSelector('.cand[data-symbol="NNE"] .logo-img.ok');
  check(true, 'company logo loaded');
  await page.waitForTimeout(300);
  check(!!(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).achievements.scout)), 'scout achievement for 5 candidates');
  await shot(page, `${tag}-watch`);
  await checkText(page, lang, 'watchlist');

  // ---- buy from a candidate, today ----
  console.log(`[${tag}] buy today`);
  await page.click('.cand[data-symbol="NNE"] [data-act="buy"]');
  await page.waitForFunction(() => document.querySelector('#tx-price').value !== '' && document.querySelector('#tx-fx').value !== '');
  check(await page.inputValue('#tx-price') === '38.4', 'price auto-filled from quote');
  check(await page.inputValue('#tx-fx') === '3.6812', 'rate auto-filled from CNBC');
  await page.fill('#tx-amount', '150');
  await page.fill('#tx-fee', '5');
  await page.waitForTimeout(100);
  check((await page.locator('#tx-preview').textContent()).includes(T.fee), 'preview shows total with fee');
  await shot(page, `${tag}-buy-form`);
  await checkText(page, lang, 'buy form');
  await page.click('#tx-submit');
  await closed(page, '#tx-dialog');
  await page.waitForTimeout(200);
  check(!!(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).achievements.first)), 'first-rocket achievement unlocked');

  // ---- past purchase with history-based price & ECB rate ----
  console.log(`[${tag}] buy in the past`);
  await page.click('#tabs [data-view="portfolio"]');
  await page.click('#view-portfolio [data-go="buy"]');
  await pick(page, '#tx-symbol', 'serv', 'SERV');
  const past = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  await page.fill('#tx-date', past);
  await page.dispatchEvent('#tx-date', 'change');
  await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('#tx-price-hint').textContent), T.closeHint.source);
  const fxPast = await page.inputValue('#tx-fx');
  check(fxPast !== '' && fxPast !== '3.6812', 'historical rate used for a past date (' + fxPast + ')');
  await page.fill('#tx-amount', '200');
  await page.click('#tx-submit');
  await closed(page, '#tx-dialog');

  // ---- shares mode + sell ----
  console.log(`[${tag}] buy by shares, then sell part`);
  await page.click('#view-portfolio [data-go="buy"]');
  await pick(page, '#tx-symbol', 'kulr', 'KULR');
  await page.click('#tx-mode [data-mode="shares"]');
  await page.waitForFunction(() => document.querySelector('#tx-price').value !== '');
  await page.fill('#tx-shares', '10');
  await page.click('#tx-submit');
  await closed(page, '#tx-dialog');
  await page.waitForSelector('#view-portfolio .pos[data-symbol="KULR"]');
  check(await page.locator('#view-portfolio .pos').count() === 3, 'three positions in portfolio');
  await page.waitForSelector('#pf-hist-chart svg path');
  check(true, 'portfolio history chart drawn');
  await page.waitForTimeout(900);
  await shot(page, `${tag}-portfolio`);
  await checkText(page, lang, 'portfolio');
  check(!!(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).achievements.three)), 'three-rockets achievement unlocked');

  // ---- Claude's take pasted from the report ----
  console.log(`[${tag}] claude's take`);
  await page.click('#view-portfolio [data-go="opinions"]');
  await page.waitForSelector('#op-dialog[open]');
  check(await page.locator('#op-submit').isDisabled(), 'save disabled until something is pasted');
  const auto = await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).opinions);
  check(auto.NNE?.verdict === 'ok' && auto.NNE.date === reportDate && !auto.BAD, 'report verdicts filed automatically, junk skipped');
  check(await page.locator('#op-latest [data-report="open"]').count() === 1, 'paste dialog links the latest report');
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('#op-text', T.opinions.replace('{d}', today));
  check(await page.locator('#op-preview .op-list li').count() === 4, 'preview finds four companies, skips the header');
  await shot(page, `${tag}-opinions-paste`);
  await checkText(page, lang, 'opinions dialog');
  await page.click('#op-submit');
  await closed(page, '#op-dialog');
  const ops = await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).opinions);
  check(ops.KULR?.verdict === 'watch' && ops.SERV?.verdict === 'broken' && ops.NNE?.verdict === 'ok' && ops.NNE.date === today, 'verdicts and date saved');
  check(await page.locator('.pos[data-symbol="KULR"] .opinion.op-watch').count() === 1, 'card shows the take');
  await shot(page, `${tag}-portfolio-opinions`);
  await page.click('.pos[data-symbol="SERV"]');
  await page.waitForSelector('#detail[open]');
  check((await page.locator('#d-opinion').textContent()).includes(T.servReason), 'company window shows the full take');
  await checkText(page, lang, 'detail with take');
  await page.click('#detail .close-btn');
  await closed(page, '#detail');
  await page.click('#tabs [data-view="watch"]');
  check(await page.locator('.cand[data-symbol="NNE"] .opinion.op-ok').count() === 1, 'watchlist card shows the take');
  await page.click('#tabs [data-view="portfolio"]');
  await page.waitForSelector('#view-portfolio .pos');

  // table view
  await page.click('#pf-view [data-pfview="table"]');
  check(await page.locator('.pf-table tbody tr').count() === 3, 'table view lists three rows');
  check(await page.locator('.pf-table .op-dot').count() === 3, 'table view marks each take with a dot');
  await shot(page, `${tag}-portfolio-table`);
  await page.selectOption('#pf-sort', 'name');
  check(await page.locator('.pf-table tbody tr').first().getAttribute('data-symbol') === 'KULR', 'sort by ticker');
  await page.click('#pf-view [data-pfview="cards"]');

  // privacy
  await page.click('#privacy-btn');
  await page.waitForTimeout(150);
  check((await page.locator('#pf-total').textContent()).includes(T.mask), 'privacy mode hides the total');
  check(!/\d/.test(await page.locator('.pos[data-symbol="SERV"] .big').textContent()), 'privacy mode hides card values');
  await shot(page, `${tag}-privacy`);
  await page.click('#privacy-btn');

  await page.click('.pos[data-symbol="KULR"]');
  await page.waitForSelector('#detail[open]');
  await page.waitForSelector('#d-chart svg path');
  check(await page.locator('#d-position .tx-list li').count() === 1, 'detail lists the KULR purchase');
  await page.click('#detail [data-act="sell"]');
  await page.click('#tx-mode [data-mode="shares"]');
  await page.fill('#tx-shares', '20');
  await page.waitForFunction(() => document.querySelector('#tx-price').value !== '');
  await page.click('#tx-submit');
  check(T.tooMany.test(await page.locator('#tx-error').textContent()), 'cannot sell more than held');
  await page.fill('#tx-shares', '4');
  await page.click('#tx-submit');
  await closed(page, '#tx-dialog');
  await page.waitForTimeout(200);
  check(await page.locator('#d-position .tx-list li').count() === 2, 'sale recorded in detail');
  const sharesText = await page.locator('#d-position .pos-grid dd').first().textContent();
  check(sharesText.trim() === '6', 'six shares left after selling four (' + sharesText + ')');
  await page.fill('#d-note', T.note);
  await page.click('#detail [data-range="5Y"]');
  await page.waitForTimeout(300);
  await shot(page, `${tag}-detail`);
  await checkText(page, lang, 'detail');
  const box = await page.locator('#d-chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.waitForTimeout(100);
  check(await page.locator('#d-chart .chart-tip').isVisible(), 'chart tooltip on hover');
  await page.click('#detail .close-btn');
  await closed(page, '#detail');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).notes.KULR) === T.note, 'note saved on close');

  // ---- time machine ----
  console.log(`[${tag}] time machine`);
  await page.click('#tabs [data-view="machine"]');
  await page.waitForSelector('.tm-result .tm-big span');
  check(/₪/.test(await page.locator('.tm-big span').textContent()), 'time machine shows a result');
  check(/S&P 500/.test(await page.locator('.tm-stats').textContent()), 'time machine compares with the S&P 500');
  await page.click('label.switch');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.prefs')).machine.log) === true, 'log scale toggle remembered');
  await page.click('#tm-copy');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(/Apple/.test(clip) && /×/.test(clip), 'copy result puts a summary on the clipboard');
  await shot(page, `${tag}-machine-once`);
  await checkText(page, lang, 'time machine');
  await page.click('#tm-mode [data-monthly="1"]');
  await page.click('#tm-presets [data-preset="5"]');
  await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.tm-headline')?.textContent || ''), T.monthly.source);
  check(await page.inputValue('#tm-amount') === '150', 'monthly mode uses the budget as amount');
  await page.locator('#tm-presets [data-watch]').first().click();
  await page.waitForSelector('.tm-result');
  check(true, 'watchlist chip in time machine');

  // ---- plan ----
  console.log(`[${tag}] plan`);
  await page.click('#tabs [data-view="plan"]');
  await page.waitForSelector('.budget-card');
  check(T.budget150.test(await page.locator('.budget-card').textContent()), 'budget card shows monthly budget');
  check(await page.locator('.spread-row').count() === 3, 'spread lists three companies');
  check(await page.locator('.ach.got').count() >= 4, 'achievements shown as unlocked (' + await page.locator('.ach.got').count() + ')');
  await page.click('.rules [data-go="rules"]');
  await page.fill('#rules-text', T.rules);
  await page.click('.rules [data-go="rules"]');
  check(await page.locator('.rules li').count() === 2, 'rules edited');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${tag}-plan`);
  await checkText(page, lang, 'plan');

  // ---- settings: budget, theme, backup, CSV ----
  console.log(`[${tag}] settings`);
  await page.click('#settings-btn');
  await page.fill('#s-budget', '200');
  await page.selectOption('#s-theme', scheme === 'dark' ? 'light' : 'dark');
  check(await page.getAttribute('html', 'data-theme') === (scheme === 'dark' ? 'light' : 'dark'), 'theme switches at once');
  await shot(page, `${tag}-settings`);
  await checkText(page, lang, 'settings');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForTimeout(150);
  check(T.budget200.test(await page.locator('.budget-card').textContent()), 'budget change applied');
  await page.click('#settings-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#s-export')]);
  const path = await dl.path();
  const backup = JSON.parse(fs.readFileSync(path, 'utf8'));
  check(backup.txs.length === 4 && backup.watch.length === 5, 'backup contains all records');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#s-csv')]);
  const csv = fs.readFileSync(await dl2.path(), 'utf8');
  check(csv.startsWith('﻿date,type,symbol') && csv.trim().split('\n').length === 5, 'CSV export has a header and four rows');
  await page.selectOption('#s-theme', 'auto');
  await page.click('#settings-dialog [data-close]');

  // ---- switch language on the fly ----
  const other = lang === 'ru' ? 'en' : 'ru';
  await page.click('#lang-btn');
  await page.waitForTimeout(200);
  check(await page.getAttribute('html', 'lang') === other, 'top button switches language');
  await page.click('#tabs [data-view="portfolio"]');
  await page.waitForSelector('#view-portfolio .pos');
  await checkText(page, other, 'portfolio after switching');
  await shot(page, `${tag}-switched-${other}`);
  await page.click('#lang-btn');

  // ---- reload keeps everything ----
  await page.reload();
  await page.waitForSelector('#view-portfolio .pos');
  check(await page.getAttribute('html', 'lang') === lang, 'language survives reload');
  check(!(await page.locator('#welcome[open]').count()), 'welcome not shown again');

  // ---- help ----
  await page.click('#help-btn');
  await page.waitForSelector('#help-dialog[open]');
  await checkText(page, lang, 'help');
  await shot(page, `${tag}-help`);
  await page.keyboard.press('Escape');

  // ---- automatic report ----
  console.log(`[${tag}] automatic report`);
  await page.waitForSelector('#pf-report .report-banner');
  check(true, 'banner announces the new report');
  await page.click('#pf-report [data-report="open"]');
  await page.waitForSelector('#report-dialog[open]');
  check(await page.locator('#report-dialog .rp-cand').count() === 2, 'report lists two candidates');
  check(await page.locator('#report-dialog .rp-sources a').count() === 1, 'only https sources are linked');
  await shot(page, `${tag}-report`);
  await checkText(page, lang, 'report dialog');
  await page.click('#report-dialog [data-report="add"][data-symbol="TSLA"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('rk.data')).watch.some((w) => w.symbol === 'TSLA'));
  await page.waitForSelector('#report-dialog [data-symbol="TSLA"][disabled]');
  const tsla = await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).watch.find((w) => w.symbol === 'TSLA'));
  check(tsla && tsla.addedPrice > 0 && tsla.risk === 'vhigh', 'candidate added to the watchlist with its price (' + JSON.stringify(tsla) + ')');
  await page.click('#report-dialog .close-btn');
  await closed(page, '#report-dialog');
  check(await page.locator('.report-banner').count() === 0, 'banner gone once the report was opened');
  await page.reload();
  await page.waitForSelector('#view-portfolio .pos');
  await page.waitForTimeout(300);
  check(await page.locator('.report-banner').count() === 0, 'banner stays gone after reload');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).opinions.SERV.verdict) === 'broken', 'a newer hand-pasted verdict beats the older report');
  for (const verdict of ['ok', 'broken']) {
    const body = JSON.stringify({ ...REPORT[lang], opinions: [{ symbol: 'NFLX', verdict, text: verdict }] });
    await page.route('**/claude/report.json', (route) => route.fulfill({ contentType: 'application/json', body }));
    await page.reload();
    await page.waitForFunction((v) => JSON.parse(localStorage.getItem('rk.data')).opinions.NFLX?.verdict === v, verdict, { timeout: 5000 }).catch(() => {});
  }
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('rk.data')).opinions.NFLX?.verdict) === 'broken', 'a report rewritten the same day replaces its own verdict');

  // ---- import backup into a fresh context ----
  const ctx2 = await browser.newContext({ viewport, colorScheme: scheme, locale: lang === 'ru' ? 'ru-RU' : 'en-US' });
  const p2 = await ctx2.newPage();
  p2.on('dialog', (d) => d.accept());
  p2.on('pageerror', (e) => errors.push(`[${tag}/import] pageerror: ${e.message}`));
  await install(p2);
  await p2.goto(base + '/index.html#portfolio');
  await p2.waitForSelector('#welcome[open]');
  await p2.keyboard.press('Escape');
  await p2.click('#settings-btn');
  await p2.setInputFiles('#s-import', path);
  await p2.waitForSelector('#view-portfolio .pos');
  check(await p2.locator('#view-portfolio .pos').count() === 3, 'import restores the portfolio');
  await ctx2.close();

  // ---- offline behaviour ----
  const ctx3 = await browser.newContext({ viewport, colorScheme: scheme });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push(`[${tag}/offline] pageerror: ${e.message}`));
  await install(p3, { offline: true });
  await p3.goto(base + '/index.html#portfolio');
  await p3.waitForFunction(() => document.querySelector('#fx-pill').dataset.kind === 'offline');
  check(true, 'offline state shown');
  await ctx3.close();

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 860 }, 'desktop-ru', 'light', 'ru');
  await run({ width: 390, height: 844 }, 'phone-en', 'dark', 'en');
  console.log('\n' + (errors.length ? errors.join('\n') : 'ALL CHECKS PASSED'));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); console.log(errors.join('\n')); process.exit(2); });
