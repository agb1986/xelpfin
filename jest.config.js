module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/integration/', '<rootDir>/android/'],
  // react-native-tvos ships its virtualized lists as a separate untranspiled package.
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-tvos)/)'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
};
