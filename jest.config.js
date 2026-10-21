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
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-tvos)/)',
  ],
  // Agent worktrees under .claude/ hold full copies of the repo.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
};
