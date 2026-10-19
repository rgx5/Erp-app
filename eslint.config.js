const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  { ignores: ['dist/*', '.export-check/*', '.export-web/*', 'scripts/*', 'node_modules/*'] },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
