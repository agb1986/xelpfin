module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/integration/',
    '<rootDir>/android/',
    '<rootDir>/vega/',
    '<rootDir>/.claude/',
  ],
  // react-native-tvos ships its virtualized lists as a separate untranspiled package.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community|-async-storage)?|@react-native-tvos)/)',
  ],
  // Agent worktrees under .claude/ hold full copies of the repo.
  modulePathIgnorePatterns: ['<rootDir>/.claude/', '<rootDir>/vega/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Suites that mount the whole app take several seconds per test on a busy CI runner, past
  // jest's 5 s default.
  testTimeout: 30_000,
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
  // Today's totals rounded down, so coverage can only rise; raise these as tests are added.
  coverageThreshold: {
    global: { statements: 91, branches: 84, functions: 87, lines: 91 },
  },
};
