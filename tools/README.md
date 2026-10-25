# Tools (not part of the site)

End-to-end tests with mocked market data (CNBC, Frankfurter and logos are faked,
so the tests run offline), in Russian and English, desktop and phone.

```bash
npm install --no-save playwright && npx playwright install chromium
npx http-server .. -p 8123 -c-1 -s &        # serve the app from the repo root
node test.cjs http://localhost:8123 /tmp/shots   # must end with ALL CHECKS PASSED
node showcase.cjs /tmp/showcase                  # demo screenshots
(cd .. && npx eslint@9 -c tools/eslint.config.mjs js)   # lint, from the repo root
```

`icons.py` draws the app icons in `../icons/`.
