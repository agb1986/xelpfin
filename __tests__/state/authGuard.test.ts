import { MockBackend, MOCK_SERVER } from '../../src/backend/mock/MockBackend';
import { BackendError } from '../../src/backend/types';
import { guardBackend, isSessionExpired } from '../../src/state/authGuard';

describe('auth guard', () => {
  it('only treats HTTP 401 auth failures as an expired session', () => {
    expect(isSessionExpired(new BackendError('x', 'auth', 401))).toBe(true);
    expect(isSessionExpired(new BackendError('x', 'auth', 403))).toBe(false);
    expect(isSessionExpired(new BackendError('x', 'network'))).toBe(false);
    expect(isSessionExpired(new Error('401'))).toBe(false);
  });

  it('reports expiry once, passes results and other errors through', async () => {
    const inner = new MockBackend({ server: MOCK_SERVER, userId: 'u1', userName: 'xelpfin', accessToken: 't', isAdmin: true });
    const onExpired = jest.fn();
    const b = guardBackend(inner, onExpired);
    expect((await b.libraries()).length).toBe(2);
    expect(b.imageUrl('m1', 'poster', 300)).toContain('/img/m1/');
    expect(b.session).toBe(inner.session);
    inner.search = async () => {
      throw new BackendError('down', 'network');
    };
    await expect(b.search('x')).rejects.toThrow('down');
    expect(onExpired).not.toHaveBeenCalled();
    inner.resume = async () => {
      throw new BackendError('Unauthorized', 'auth', 401);
    };
    await expect(b.resume()).rejects.toThrow('Unauthorized');
    await expect(b.resume()).rejects.toThrow('Unauthorized');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
