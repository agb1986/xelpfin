module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/integration/',
    '<rootDir>/android/',
    '<rootDir>/.claude/',
  ],
  // react-native-tvos ships its virtualized lists as a separate untranspiled package.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community|-async-storage)?|@react-native-tvos)/)',
  ],
  // Agent worktrees under .claude/ hold full copies of the repo.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Suites that mount the whole app take several seconds per test on a busy CI runner, past
  // jest's 5 s default.
  testTimeout: 30_000,
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
};
