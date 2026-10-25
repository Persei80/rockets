export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Intl: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', crypto: 'readonly', Blob: 'readonly', ResizeObserver: 'readonly', confirm: 'readonly', self: 'readonly', caches: 'readonly', matchMedia: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly' } },
  rules: { 'no-unused-vars': ['error', { args: 'none' }], 'no-undef': 'error' },
}];
