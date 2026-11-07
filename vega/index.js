import { AppRegistry } from 'react-native';
import App from '../App';
import { MockConnector } from '../src/backend';
import { setPlatform } from '../src/platform';
import { setEngine } from '../src/player';
import { createVegaPlatform } from '../src/platform/vega';
import { name as appName } from './app.json';
import { queryVegaCapabilities } from './platform/mediaCapabilities';
import { VegaEngine } from './player/VegaEngine';

setPlatform(createVegaPlatform(queryVegaCapabilities));
setEngine(VegaEngine);

// Jellyfin sign-in is untested on the stick until the app is deployed. Set this to true to run
// against the mock backend instead. The Vega SDK has no UDP, so there is no LAN discovery and
// the server screen takes a typed address.
const USE_MOCK_BACKEND = false;

const connector = USE_MOCK_BACKEND ? new MockConnector() : undefined;

AppRegistry.registerComponent(appName, () => () => (
  <App connector={connector} />
));
