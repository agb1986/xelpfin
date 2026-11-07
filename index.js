/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { createFireTvPlatform } from './src/platform/firetv';
import { setPlatform } from './src/platform';
import { VideoEngine } from './src/player/rnv/VideoEngine';
import { setEngine } from './src/player';

setPlatform(createFireTvPlatform());
setEngine(VideoEngine);

AppRegistry.registerComponent(appName, () => App);
