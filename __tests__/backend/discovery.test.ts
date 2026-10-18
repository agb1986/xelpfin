import { parseDiscoveryReplies } from '../../src/backend/jellyfin/discovery';
import { JellyfinConnector } from '../../src/backend/jellyfin/JellyfinBackend';
import { CLIENT, fakeFetch } from '../../test-utils/fakeFetch';

const reply = (Address: string, Id = 'srv1', Name = 'Home') => JSON.stringify({ Address, Id, Name, EndpointAddress: null });

describe('parseDiscoveryReplies', () => {
  it('prefers the datagram source IP with the advertised port', () => {
    const r = parseDiscoveryReplies([{ address: '192.168.1.20', payload: reply('http://172.17.0.2:8096') }]);
    expect(r).toEqual([{ id: 'srv1', name: 'Home', candidates: ['http://192.168.1.20:8096', 'http://172.17.0.2:8096'] }]);
  });

  it('merges duplicate answers from several interfaces and ignores junk', () => {
    const r = parseDiscoveryReplies([
      { address: '192.168.1.20', payload: reply('http://192.168.1.20:8096') },
      { address: '10.0.0.5', payload: reply('http://192.168.1.20:8096') },
      { address: '10.0.0.9', payload: 'not json' },
      { address: '10.0.0.9', payload: JSON.stringify({ Name: 'no id' }) },
      { address: '10.0.0.7', payload: reply('https://media.lan:8920/jf', 'srv2', 'Other') },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].candidates).toEqual(['http://192.168.1.20:8096', 'http://10.0.0.5:8096']);
    expect(r[1].candidates).toEqual(['https://10.0.0.7:8920/jf', 'https://media.lan:8920/jf']);
  });
});

describe('JellyfinConnector.discover', () => {
  it('probes candidates and returns reachable servers', async () => {
    const f = fakeFetch({
      'GET http://172.17.0.2:8096/System/Info/Public': () => Promise.reject(new TypeError('unreachable')),
      'GET http://192.168.1.20:8096/System/Info/Public': { Id: 'srv1', ServerName: 'Home', Version: '12.1.0' },
    });
    const udp = {
      broadcast: jest.fn(async () => [{ address: '192.168.1.20', payload: reply('http://172.17.0.2:8096') }]),
    };
    const c = new JellyfinConnector({ client: CLIENT, fetch: f.fetch, udp });
    const servers = await c.discover(100, ['192.168.1.20']);
    expect(udp.broadcast).toHaveBeenCalledWith('who is JellyfinServer?', 7359, 100, ['192.168.1.20']);
    expect(servers).toEqual([
      {
        id: 'srv1',
        name: 'Home',
        url: 'http://192.168.1.20:8096',
        version: '12.1.0',
        candidates: ['http://192.168.1.20:8096', 'http://172.17.0.2:8096'],
      },
    ]);
  });

  it('returns nothing without a UDP transport', async () => {
    await expect(new JellyfinConnector({ client: CLIENT, fetch: fakeFetch({}).fetch }).discover()).resolves.toEqual([]);
  });
});

describe('parseDiscoveryReplies scheme filter', () => {
  it('drops advertised addresses that are not http or https', () => {
    const r = parseDiscoveryReplies([
      {
        address: '192.168.1.20',
        payload: JSON.stringify({ Id: 'srv1', Name: 'Home', Address: 'file:///etc/passwd', EndpointAddress: 'smb://192.168.1.20/media' }),
      },
      { address: '192.168.1.21', payload: JSON.stringify({ Id: 'srv2', Name: 'Ok', Address: 'http://192.168.1.21:8096', EndpointAddress: 'ftp://x' }) },
    ]);
    expect(r).toEqual([
      { id: 'srv1', name: 'Home', candidates: [] },
      { id: 'srv2', name: 'Ok', candidates: ['http://192.168.1.21:8096'] },
    ]);
  });
});

describe('parseDiscoveryReplies limits', () => {
  it('ignores replies beyond the cap', () => {
    const replies = Array.from({ length: 200 }, (_, i) => ({ address: `10.0.${Math.floor(i / 256)}.${i % 256}`, payload: reply(`http://10.0.0.1:8096`, `srv${i}`) }));
    expect(parseDiscoveryReplies(replies)).toHaveLength(64);
  });
});
