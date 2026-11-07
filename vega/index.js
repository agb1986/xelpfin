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

// Scaffold stage: the shared UI runs against the mock backend until sign-in is verified on Vega.
const connector = new MockConnector();

AppRegistry.registerComponent(appName, () => () => <App connector={connector} />);
