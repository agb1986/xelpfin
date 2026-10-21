import type { ServerInfo } from '../../src/backend/types';
import { MemoryStore, type TlsInspection } from '../../src/platform/types';
import {
  assessCertificate,
  fingerprintLines,
  isFingerprint,
  loadServers,
  pinForUrl,
  pinsFor,
  sameTlsEndpoint,
  tlsEndpoint,
  tlsTargets,
  withCertificate,
} from '../../src/state/servers';

const fp = (byte: string) => Array(32).fill(byte).join(':');
const A = fp('AA');
const B = fp('BB');

const server = (id: string, url: string, certSha256?: string): ServerInfo => ({
  id,
  name: id,
  url,
  ...(certSha256 ? { certSha256 } : {}),
});

const inspection = (sha256: string, trusted = false): TlsInspection => ({
  host: 'jf.lan',
  port: 8920,
  trusted,
  chain: [
    {
      sha256,
      subject: 'CN=jf.lan',
      issuer: 'CN=jf.lan',
      notBefore: 0,
      notAfter: 1,
      selfSigned: true,
    },
  ],
});

describe('tlsEndpoint', () => {
  it('reads host and port of https URLs only', () => {
    expect(tlsEndpoint('https://JF.lan:8920/jellyfin')).toEqual({
      host: 'jf.lan',
      port: 8920,
    });
    expect(tlsEndpoint('https://jf.lan')).toEqual({
      host: 'jf.lan',
      port: 443,
    });
    expect(tlsEndpoint('https://[FD00::1]:8920')).toEqual({
      host: 'fd00::1',
      port: 8920,
    });
    expect(tlsEndpoint('http://jf.lan:8096')).toBeUndefined();
    expect(tlsEndpoint('https://jf.lan:99999')).toBeUndefined();
    expect(tlsEndpoint('nonsense')).toBeUndefined();
  });

  it('compares endpoints, not URLs', () => {
    expect(sameTlsEndpoint('https://jf.lan/a', 'https://JF.LAN:443/b')).toBe(
      true,
    );
    expect(sameTlsEndpoint('https://jf.lan', 'https://jf.lan:8920')).toBe(
      false,
    );
    expect(sameTlsEndpoint('http://jf.lan', 'http://jf.lan')).toBe(false);
  });
});

describe('tlsTargets', () => {
  it('follows the addresses the connector tries', () => {
    expect(tlsTargets('https://jf.lan:9443/x')).toEqual([
      { host: 'jf.lan', port: 9443 },
    ]);
    expect(tlsTargets('http://jf.lan:8096')).toEqual([]);
    expect(tlsTargets('jf.lan:8443')).toEqual([{ host: 'jf.lan', port: 8443 }]);
    expect(tlsTargets('192.168.1.5')).toEqual([
      { host: '192.168.1.5', port: 8920 },
      { host: '192.168.1.5', port: 443 },
    ]);
    expect(tlsTargets('')).toEqual([]);
  });
});

describe('pins', () => {
  it('collects one valid pin per https endpoint, later sources winning', () => {
    const pins = pinsFor([
      server('old', 'https://jf.lan:8920', A),
      undefined,
      server('plain', 'http://jf.lan:8096', A),
      server('bad', 'https://other.lan', 'not-a-fingerprint'),
      server('new', 'https://JF.lan:8920/jellyfin', B),
    ]);
    expect(pins).toEqual([{ host: 'jf.lan', port: 8920, sha256: B }]);
    expect(pinForUrl(pins, 'https://jf.lan:8920')).toBe(B);
    expect(pinForUrl(pins, 'https://jf.lan')).toBeUndefined();
    expect(pinForUrl(pins, 'http://jf.lan:8920')).toBeUndefined();
  });

  it('updates every saved server on the endpoint and nothing else', () => {
    const list = [
      server('a', 'https://jf.lan:8920', A),
      server('b', 'https://jf.lan:8920/other'),
      server('c', 'https://jf.lan:443', A),
    ];
    const next = withCertificate(list, 'https://jf.lan:8920', B);
    expect(next.map(s => s.certSha256)).toEqual([B, B, A]);
    expect(
      withCertificate(next, 'https://jf.lan:8920', undefined).map(
        s => 'certSha256' in s,
      ),
    ).toEqual([false, false, true]);
  });

  it('drops malformed stored pins on load', async () => {
    const store = new MemoryStore();
    await store.set(
      'xelpfin.servers',
      JSON.stringify([
        server('a', 'https://jf.lan', A),
        server('b', 'https://jf.lan', 'aa:bb'),
      ]),
    );
    const list = await loadServers(store);
    expect(list[0].certSha256).toBe(A);
    expect('certSha256' in list[1]).toBe(false);
  });

  it('validates fingerprints strictly', () => {
    expect(isFingerprint(A)).toBe(true);
    expect(isFingerprint(A.toLowerCase())).toBe(false);
    expect(isFingerprint(A.slice(3))).toBe(false);
    expect(isFingerprint(undefined)).toBe(false);
  });
});

describe('assessCertificate', () => {
  it('asks for unknown and changed certificates only', () => {
    expect(assessCertificate(inspection(A, true), undefined)).toBe('trusted');
    expect(assessCertificate(inspection(A, true), B)).toBe('trusted');
    expect(assessCertificate(inspection(A), undefined)).toBe('new');
    expect(assessCertificate(inspection(A), A)).toBe('pinned');
    expect(assessCertificate(inspection(A), B)).toBe('changed');
    expect(assessCertificate(inspection('junk'), undefined)).toBe('invalid');
    expect(assessCertificate({ ...inspection(A), chain: [] }, undefined)).toBe(
      'invalid',
    );
  });

  it('splits a fingerprint into two lines of 16 bytes', () => {
    const lines = fingerprintLines(A);
    expect(lines).toHaveLength(2);
    expect(lines[0].split(':')).toHaveLength(16);
    expect(lines.join(':')).toBe(A);
  });
});
