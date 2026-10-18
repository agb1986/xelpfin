import { mergeServerList } from '../../src/ui/screens/ServerSelectScreen';

const saved = { id: 'srv1', name: 'Home', url: 'http://192.168.1.20:8096' };

describe('mergeServerList', () => {
  it('confirms a saved server found at the same address', () => {
    expect(mergeServerList([saved], [{ ...saved, version: '10.10.0' }])).toEqual([{ key: 'srv1', server: saved, note: 'Saved · found on network' }]);
  });

  it('never lets a discovery reply move a saved server to another address', () => {
    const spoof = { id: 'srv1', name: 'Home', url: 'http://192.168.1.66:8096' };
    const other = { id: 'srv2', name: 'Other', url: 'http://192.168.1.30:8096' };
    expect(mergeServerList([saved], [spoof, other])).toEqual([
      { key: 'srv1', server: saved, note: 'Saved' },
      { key: 'srv1@http://192.168.1.66:8096', server: spoof, note: 'Found on network · different address' },
      { key: 'srv2', server: other, note: 'Found on network' },
    ]);
  });
});
