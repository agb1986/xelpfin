import { BASELINE_CAPABILITIES } from '../../src/player/capabilities';
import { createVegaPlatform } from '../../src/platform/vega';

jest.mock('@react-native-async-storage/async-storage', () => ({}));

const caps = { ...BASELINE_CAPABILITIES, audio: ['aac'] };

describe('createVegaPlatform capabilities', () => {
  it('reports the baseline when no query is given', async () => {
    expect(await createVegaPlatform().capabilities()).toBe(
      BASELINE_CAPABILITIES,
    );
  });

  it('uses the queried capabilities and queries once', async () => {
    const query = jest.fn().mockResolvedValue(caps);
    const platform = createVegaPlatform(query);
    expect(await platform.capabilities()).toBe(caps);
    expect(await platform.capabilities()).toBe(caps);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('falls back to the baseline when the query rejects', async () => {
    const platform = createVegaPlatform(() => Promise.reject(new Error('x')));
    expect(await platform.capabilities()).toBe(BASELINE_CAPABILITIES);
  });
});
