const reactNativeConfig = require('@react-native/eslint-config/flat');

module.exports = [
  ...reactNativeConfig,
  {
    ignores: ['.claude/', 'android/', 'coverage/', 'dist/', 'node_modules/', 'vega/'],
  },
  {
    // The React Native preset enables two Flow rules on *.js. This project has no
    // Flow files, and eslint-plugin-ft-flow 2.x crashes under ESLint 9
    // (context.getAllComments was removed), so switch them off.
    files: ['**/*.js'],
    rules: {
      'ft-flow/define-flow-type': 'off',
      'ft-flow/use-flow-type': 'off',
    },
  },
];
