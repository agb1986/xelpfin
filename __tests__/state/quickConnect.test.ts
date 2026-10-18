import type { QuickConnectState } from '../../src/backend/types';
import { watchQuickConnect } from '../../src/state/quickConnect';

const pending: QuickConnectState = { status: 'pending', code: '123456', secret: 's' };

describe('watchQuickConnect', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const callbacks = () => ({ onAuthorized: jest.fn(), onExpired: jest.fn(), onError: jest.fn() });

  it('waits for each poll to answer before sending the next', async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const poll = async () => {
      calls++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>(r => setTimeout(() => r(), 5000));
      inFlight--;
      return pending;
    };
    const stop = watchQuickConnect(poll, callbacks(), { intervalMs: 1000, ttlMs: 60_000 });
    await jest.advanceTimersByTimeAsync(20_000);
    stop();
    expect(peak).toBe(1);
    expect(calls).toBe(4);
  });

  it('reports approval once', async () => {
    const cb = callbacks();
    const poll = jest.fn<Promise<QuickConnectState>, []>().mockResolvedValueOnce(pending).mockResolvedValue({ status: 'authorized', secret: 's' });
    watchQuickConnect(poll, cb, { intervalMs: 1000, ttlMs: 60_000 });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(cb.onAuthorized).toHaveBeenCalledTimes(1);
  });

  it('gives up when the code expires', async () => {
    const cb = callbacks();
    const poll = jest.fn(async () => pending);
    watchQuickConnect(poll, cb, { intervalMs: 1000, ttlMs: 5000 });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(cb.onExpired).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it('reports a failed poll and stops', async () => {
    const cb = callbacks();
    const poll = jest.fn(async (): Promise<QuickConnectState> => {
      throw new Error('down');
    });
    watchQuickConnect(poll, cb, { intervalMs: 1000, ttlMs: 60_000 });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith(new Error('down'));
  });

  it('runs no callback once stopped, even for a poll already in flight', async () => {
    const cb = callbacks();
    let answer!: (s: QuickConnectState) => void;
    const poll = () => new Promise<QuickConnectState>(r => (answer = r));
    const stop = watchQuickConnect(poll, cb, { intervalMs: 1000, ttlMs: 60_000 });
    await jest.advanceTimersByTimeAsync(1000);
    stop();
    answer({ status: 'authorized', secret: 's' });
    await jest.advanceTimersByTimeAsync(5000);
    expect(cb.onAuthorized).not.toHaveBeenCalled();
  });
});
