// Screenshots with a realistic demo portfolio, for the summary.
const { chromium } = require('playwright');
const { install } = require('./mock.cjs');
const out = process.argv[2];
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const demo = {
  settings: { budget: 150, maxShare: 30, fee: 0 },
  txs: [
    { id: '1', symbol: 'SERV', type: 'buy', date: day(240), shares: 10.2, price: 4.1, fx: 3.62, fee: 0, created: 1 },
    { id: '2', symbol: 'NNE', type: 'buy', date: day(180), shares: 2.1, price: 18.5, fx: 3.7, fee: 0, created: 2 },
    { id: '3', symbol: 'KULR', type: 'buy', date: day(120), shares: 14, price: 2.9, fx: 3.66, fee: 0, created: 3 },
    { id: '4', symbol: 'SERV', type: 'buy', date: day(60), shares: 3.6, price: 11.2, fx: 3.6, fee: 0, created: 4 },
    { id: '5', symbol: 'NNE', type: 'buy', date: day(25), shares: 1.05, price: 36.9, fx: 3.68, fee: 0, created: 5 },
  ],
  watch: [
    { symbol: 'NNE', added: day(200), addedPrice: 16.2, why: 'Маленькие модульные ядерные реакторы. Денег хватит на несколько лет.', risk: 'lottery', source: 'Отчёт за апрель 2026' },
    { symbol: 'SERV', added: day(250), addedPrice: 3.9, why: 'Роботы-курьеры для доставки еды, контракт с Uber Eats.', risk: 'vhigh', source: 'Отчёт за февраль 2026' },
    { symbol: 'KULR', added: day(130), addedPrice: 2.7, why: 'Системы охлаждения и защиты батарей.', risk: 'vhigh', source: '' },
  ],
  notes: { SERV: 'Роботы-курьеры', NNE: 'Ядерные реакторы', KULR: 'Батареи' }, names: {},
  achievements: { first: day(240), three: day(120), double: day(40), reasons: day(30), timetravel: day(20), backup: day(10) },
};
(async () => {
  const browser = await chromium.launch();
  const shots = [
    ['ru-desktop', 'ru', { width: 1280, height: 900 }, 'light'],
    ['en-desktop', 'en', { width: 1280, height: 900 }, 'dark'],
    ['ru-phone', 'ru', { width: 390, height: 844 }, 'dark'],
  ];
  for (const [tag, lang, viewport, scheme] of shots) {
    const page = await browser.newPage({ viewport, colorScheme: scheme, locale: lang, deviceScaleFactor: tag.includes('phone') ? 2 : 1 });
    await install(page);
    await page.goto('http://localhost:8123/index.html');
    await page.evaluate(([d, lang]) => {
      localStorage.setItem('rk.data', JSON.stringify(d));
      localStorage.setItem('rk.prefs', JSON.stringify({ welcomed: true, lang, machine: { symbol: 'AAPL', name: 'Apple', date: '1980-12-12', amount: 1000, monthly: false, log: true } }));
    }, [demo, lang]);
    await page.reload();
    await page.waitForSelector('#pf-hist-chart svg path');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${tag}-1-portfolio.png`, fullPage: !tag.includes('phone') });
    await page.click('.pos[data-symbol="SERV"]');
    await page.waitForSelector('#d-chart svg path');
    await page.click('#detail [data-range="1Y"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}-2-company.png` });
    await page.keyboard.press('Escape');
    await page.click('#tabs [data-view="machine"]');
    await page.waitForSelector('.tm-result .tm-big span');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}-3-time-machine.png`, fullPage: !tag.includes('phone') });
    await page.click('#tabs [data-view="plan"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-4-plan.png`, fullPage: !tag.includes('phone') });
    await page.click('#tabs [data-view="portfolio"]');
    await page.click('#privacy-btn');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-5-privacy.png` });
    await page.close();
  }
  await browser.close();
})();
