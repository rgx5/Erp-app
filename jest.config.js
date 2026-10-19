/**
 * Domain and data logic is plain TypeScript, so the suite runs in Node with just the Expo Babel preset (no React
 * Native runtime needed). UI is verified separately (typecheck, bundle for Android/iOS/web, screenshots).
 */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/data/**/*.ts', 'src/industries/**/*.ts'],
};
