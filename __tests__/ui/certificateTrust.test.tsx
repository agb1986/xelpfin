/**
 * Trust on first use for a self-signed https server, driven through the real screens with a
 * fake platform TLS layer that only lets requests through when the right pin is set.
 */
import React from 'react';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../../App';
import { MockConnector } from '../../src/backend/mock/MockBackend';
import { BackendError, type ServerInfo } from '../../src/backend/types';
import {
  MemoryStore,
  type CertificatePin,
  type TlsInspection,
  type TlsTrust,
} from '../../src/platform/types';
import { testPlatform } from '../../test-utils/testPlatform';

const fp = (byte: string) => Array(32).fill(byte).join(':');
const OLD = fp('0A');
const NEW = fp('0B');
const URL = 'https://secure.lan:8920';
const SECURE: ServerInfo = { id: 'secure', name: 'Secure', url: URL };

class FakeTls implements TlsTrust {
  pins: CertificatePin[] = [];
  pushes: CertificatePin[][] = [];
  inspected: string[] = [];
  constructor(
    public leaf: string,
    public systemTrusted = false,
  ) {}
  async inspect(host: string, port: number): Promise<TlsInspection> {
    this.inspected.push(`${host}:${port}`);
    if (host !== 'secure.lan' || port !== 8920) {
      throw new Error('connection refused');
    }
    return {
      host,
      port,
      trusted: this.systemTrusted,
      trustError: this.systemTrusted ? undefined : 'unknown issuer',
      chain: [
        {
          sha256: this.leaf,
          subject: 'CN=secure.lan',
          issuer: 'CN=secure.lan',
          notBefore: Date.UTC(2026, 0, 1),
          notAfter: Date.UTC(2036, 0, 1),
          selfSigned: true,
        },
      ],
    };
  }
  async setPins(pins: CertificatePin[]) {
    this.pins = pins;
    this.pushes.push(pins);
  }
  /** What the native trust manager would decide for a request to secure.lan:8920. */
  allows() {
    return (
      this.systemTrusted ||
      this.pins.some(
        p =>
          p.host === 'secure.lan' && p.port === 8920 && p.sha256 === this.leaf,
      )
    );
  }
}

class TlsConnector extends MockConnector {
  constructor(private tls: FakeTls) {
    super();
  }
  async discover() {
    return [];
  }
  async probe(address: string): Promise<ServerInfo> {
    if (!address.includes('secure.lan')) {
      return super.probe(address);
    }
    if (!this.tls.allows()) {
      throw new BackendError('handshake failed', 'network');
    }
    return SECURE;
  }
}

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
  });
};
function byId(root: Renderer, id: string): ReactTestInstance {
  const all = root.root.findAll(
    n => n.props.testID === id && typeof n.type !== 'string',
  );
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const has = (root: Renderer, id: string) =>
  root.root.findAll(n => n.props.testID === id).length > 0;
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};
const textOf = (root: Renderer, id: string) =>
  root.root
    .findAll(n => n.props.testID === id)[0]
    .findAll(n => String(n.type) === 'Text')
    .map(n => [].concat(n.props.children).join(''))
    .join('\n');

async function render(tls: FakeTls, store = new MemoryStore()) {
  const platform = { ...testPlatform(store), tls };
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={platform} connector={new TlsConnector(tls)} />,
    );
  });
  await flush(10);
  return { root, store };
}

async function typeAddress(root: Renderer, address: string) {
  await act(async () => byId(root, 'address').props.onChangeText(address));
  await press(root, 'connect');
}

beforeEach(() => jest.useRealTimers());

test('a self-signed server connects after the user accepts its fingerprint', async () => {
  const tls = new FakeTls(OLD);
  const { root, store } = await render(tls);

  await typeAddress(root, 'secure.lan');
  expect(has(root, 'trust-prompt')).toBe(true);
  expect(tls.inspected).toEqual(['secure.lan:8920']);
  expect(textOf(root, 'trust-fingerprint').replace(/\n/g, ':')).toBe(OLD);
  expect(has(root, 'trust-previous')).toBe(false);

  // Rejecting trusts nothing and stays on the picker.
  await press(root, 'trust-reject');
  expect(has(root, 'trust-prompt')).toBe(false);
  expect(has(root, 'server-error')).toBe(true);
  expect(tls.pins).toEqual([]);

  await typeAddress(root, 'secure.lan');
  await press(root, 'trust-accept');
  await flush();
  expect(tls.pins).toEqual([{ host: 'secure.lan', port: 8920, sha256: OLD }]);
  expect(has(root, 'screen-login')).toBe(true);

  await press(root, 'user-xelpfin');
  await act(async () =>
    byId(root, 'password').props.onChangeText('xelpfin-pass'),
  );
  await press(root, 'signin');
  await flush();
  expect(has(root, 'screen-home')).toBe(true);
  const saved = JSON.parse((await store.get('xelpfin.servers'))!);
  expect(saved[0]).toMatchObject({ url: URL, certSha256: OLD });
  await act(async () => root.unmount());
});

test('saved pins are enforced from boot and a changed certificate fails closed', async () => {
  const store = new MemoryStore();
  await store.set(
    'xelpfin.servers',
    JSON.stringify([{ ...SECURE, certSha256: OLD }]),
  );
  const tls = new FakeTls(NEW);
  const { root } = await render(tls, store);
  expect(tls.pushes[0]).toEqual([
    { host: 'secure.lan', port: 8920, sha256: OLD },
  ]);

  await press(root, 'server-secure');
  await flush();
  expect(has(root, 'screen-login')).toBe(false);
  expect(has(root, 'trust-prompt')).toBe(true);
  expect(textOf(root, 'trust-previous').replace(/\n/g, ':')).toBe(OLD);
  expect(textOf(root, 'trust-fingerprint').replace(/\n/g, ':')).toBe(NEW);

  await press(root, 'trust-accept');
  await flush();
  expect(has(root, 'screen-login')).toBe(true);
  expect(tls.pins).toEqual([{ host: 'secure.lan', port: 8920, sha256: NEW }]);
  const saved = JSON.parse((await store.get('xelpfin.servers'))!);
  expect(saved[0].certSha256).toBe(NEW);
  await act(async () => root.unmount());
});

test('an unchanged pinned certificate connects without asking', async () => {
  const store = new MemoryStore();
  await store.set(
    'xelpfin.servers',
    JSON.stringify([{ ...SECURE, certSha256: OLD }]),
  );
  const tls = new FakeTls(OLD);
  const { root } = await render(tls, store);
  await press(root, 'server-secure');
  await flush();
  expect(has(root, 'trust-prompt')).toBe(false);
  expect(has(root, 'screen-login')).toBe(true);
  await act(async () => root.unmount());
});

test('no prompt when the system already trusts the certificate or nothing answers', async () => {
  const tls = new FakeTls(OLD, true);
  tls.allows = () => false; // Fails for some other reason than trust.
  const { root } = await render(tls);
  await typeAddress(root, 'https://secure.lan:8920');
  expect(has(root, 'trust-prompt')).toBe(false);
  expect(has(root, 'server-error')).toBe(true);

  await typeAddress(root, 'bad.lan');
  expect(tls.inspected).toEqual([
    'secure.lan:8920',
    'bad.lan:8920',
    'bad.lan:443',
  ]);
  expect(has(root, 'trust-prompt')).toBe(false);
  expect(has(root, 'server-error')).toBe(true);
  await act(async () => root.unmount());
});

test('without platform TLS support a failed connect just shows the error', async () => {
  const platform = testPlatform();
  expect(platform.tls).toBeUndefined();
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={platform} connector={new MockConnector()} />,
    );
  });
  await flush(10);
  await typeAddress(root, 'https://bad.lan');
  expect(has(root, 'server-error')).toBe(true);
  expect(has(root, 'trust-prompt')).toBe(false);
  await act(async () => root.unmount());
});
