import { AppRegistry } from 'react-native';
import App from '../App';
import { MockConnector } from '../src/backend';
import { setPlatform } from '../src/platform';
import { createVegaPlatform } from '../src/platform/vega';
import { name as appName } from './app.json';

setPlatform(createVegaPlatform());
// No PlayerEngine yet: setEngine() comes with the W3C media player engine.

// Scaffold stage: the shared UI runs against the mock backend until sign-in is verified on Vega.
const connector = new MockConnector();

AppRegistry.registerComponent(appName, () => () => <App connector={connector} />);
