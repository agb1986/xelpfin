import { AppRegistry } from 'react-native';
import App from '../App';
import { MockConnector } from '../src/backend';
import { setPlatform } from '../src/platform';
import { setEngine } from '../src/player';
import { createVegaPlatform } from '../src/platform/vega';
import { name as appName } from './app.json';
import { VegaEngine } from './player/VegaEngine';

setPlatform(createVegaPlatform());
setEngine(VegaEngine);

// Real Jellyfin sign-in is deferred until the app is deployed; the mock backend stands in.
const connector = new MockConnector();

AppRegistry.registerComponent(appName, () => () => (
  <App connector={connector} />
));
