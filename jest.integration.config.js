// Integration tests talk to the local Jellyfin container (npm run jellyfin:up) on 127.0.0.1.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
  testTimeout: 60000,
};
