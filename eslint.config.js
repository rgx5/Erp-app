const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  { ignores: ['dist/*', '.export-check/*', '.export-web/*', 'scripts/*', 'node_modules/*'] },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      // These React-Compiler-readiness rules flag patterns that are idiomatic in React Native and that this app uses on purpose
      // (Animated values held in refs, resetting a sheet's form when it opens, reading the clock while rendering a screen).
      // The app does not enable the React Compiler, so they would only add noise. Re-enable them when it does.
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      '@typescript-eslint/array-type': 'off',
    },
  },
]);
