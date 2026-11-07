const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const own = path.resolve(__dirname, 'node_modules');

/**
 * The shared code lives in ../src and ../App.tsx. Metro watches the repo root for it, but
 * react, react-native and the AsyncStorage alias must come from vega/node_modules only: the
 * root has react-native-tvos 0.81 and a second React copy would break hooks.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [own],
    // Shared files resolve bare imports against vega/node_modules, never the root's.
    extraNodeModules: new Proxy(
      {},
      { get: (_, name) => path.join(own, String(name)) },
    ),
    blockList: [
      new RegExp(`${root}/node_modules/.*`),
      new RegExp(`${root}/android/.*`),
      new RegExp(`${root}/src/player/rnv/.*`),
      new RegExp(`${root}/src/platform/firetv/.*`),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
