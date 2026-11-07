// Installs the polyfills Shaka Player needs on Vega's JS runtime, then exports it. The files come
// from scripts/vega-shaka.sh (vega/vendor/ is git-ignored).
import Document from '../vendor/polyfills/DocumentPolyfill';
import DOMParserPolyfill from '../vendor/polyfills/DOMParserPolyfill';
import Element from '../vendor/polyfills/ElementPolyfill';
import MiscPolyfill from '../vendor/polyfills/MiscPolyfill';
import TextDecoderPolyfill from '../vendor/polyfills/TextDecoderPolyfill';
import W3CMediaPolyfill from '../vendor/polyfills/W3CMediaPolyfill';
import shaka from '../vendor/shakaplayer/shaka-player.compiled';

Document.install();
Element.install();
TextDecoderPolyfill.install();
W3CMediaPolyfill.install();
MiscPolyfill.install();
DOMParserPolyfill.install();

shaka.polyfill.installAll();
shaka.net.NetworkingEngine.unregisterScheme('http');
shaka.net.NetworkingEngine.unregisterScheme('https');
for (const scheme of ['http', 'https']) {
  shaka.net.NetworkingEngine.registerScheme(
    scheme,
    shaka.net.HttpFetchPlugin.parse,
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
    true,
  );
}

export default shaka;
