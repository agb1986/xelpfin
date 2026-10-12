module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/integration/', '<rootDir>/android/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
