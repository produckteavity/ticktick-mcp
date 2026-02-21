import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager, AuthError } from '../../src/auth.js';

describe('TokenManager', () => {
  const mockKeychain = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  };

  const mockFetch = vi.fn();
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tokenManager = new TokenManager(
      mockKeychain as any,
      'test-client-id',
      mockFetch as any
    );
  });

  describe('getValidAccessToken', () => {
    it('returns cached token when not expired', async () => {
      const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'valid-token';
        if (key === 'expires_at') return futureExpiry;
        return null;
      });

      const token = await tokenManager.getValidAccessToken();
      expect(token).toBe('valid-token');
    });

    it('refreshes token when expired', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });

      const token = await tokenManager.getValidAccessToken();
      expect(token).toBe('new-token');
      expect(mockKeychain.set).toHaveBeenCalledWith('access_token', 'new-token');
      expect(mockKeychain.set).toHaveBeenCalledWith('refresh_token', 'new-refresh-token');
    });

    it('refreshes proactively when within 60 seconds of expiry', async () => {
      const nearExpiry = String(Math.floor(Date.now() / 1000) + 30);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'almost-expired-token';
        if (key === 'expires_at') return nearExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
        }),
      });

      const token = await tokenManager.getValidAccessToken();
      expect(token).toBe('fresh-token');
    });

    it('throws AuthError when no token exists', async () => {
      mockKeychain.get.mockResolvedValue(null);
      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
    });

    it('throws AuthError when refresh fails', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'bad-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });

      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
    });

    it('throws AuthError when refresh response is malformed JSON', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(
        /re-authorize/
      );
      // Ensure nothing was stored in keychain
      expect(mockKeychain.set).not.toHaveBeenCalled();
    });

    it('throws AuthError when refresh response is missing access_token', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          expires_in: 3600,
        }),
      });

      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(
        /re-authorize/
      );
      expect(mockKeychain.set).not.toHaveBeenCalled();
    });

    it('throws AuthError when refresh response is missing expires_in', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
        }),
      });

      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(
        /re-authorize/
      );
      expect(mockKeychain.set).not.toHaveBeenCalled();
    });

    it('throws AuthError when refresh response has non-number expires_in', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          expires_in: 'not-a-number',
        }),
      });

      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(AuthError);
      await expect(tokenManager.getValidAccessToken()).rejects.toThrow(
        /re-authorize/
      );
      expect(mockKeychain.set).not.toHaveBeenCalled();
    });

    it('forceRefresh refreshes token even when current token has not expired', async () => {
      const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'still-valid-token';
        if (key === 'expires_at') return futureExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'force-refreshed-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });

      // getValidAccessToken would return the cached token without refreshing
      const cachedToken = await tokenManager.getValidAccessToken();
      expect(cachedToken).toBe('still-valid-token');
      expect(mockFetch).not.toHaveBeenCalled();

      // forceRefresh should bypass expiry check and actually refresh
      const freshToken = await tokenManager.forceRefresh();
      expect(freshToken).toBe('force-refreshed-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockKeychain.set).toHaveBeenCalledWith('access_token', 'force-refreshed-token');
    });

    it('stores tokens correctly when refresh response is valid', async () => {
      const pastExpiry = String(Math.floor(Date.now() / 1000) - 100);
      mockKeychain.get.mockImplementation((key: string) => {
        if (key === 'access_token') return 'expired-token';
        if (key === 'expires_at') return pastExpiry;
        if (key === 'refresh_token') return 'my-refresh-token';
        if (key === 'client_secret') return 'my-client-secret';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_in: 7200,
        }),
      });

      const token = await tokenManager.getValidAccessToken();
      expect(token).toBe('new-token');
      expect(mockKeychain.set).toHaveBeenCalledWith('access_token', 'new-token');
      expect(mockKeychain.set).toHaveBeenCalledWith('refresh_token', 'new-refresh-token');

      // Verify expires_at was stored as a valid number string (not NaN)
      const expiresAtCall = mockKeychain.set.mock.calls.find(
        (call: string[]) => call[0] === 'expires_at'
      );
      expect(expiresAtCall).toBeDefined();
      const storedExpiry = Number(expiresAtCall![1]);
      expect(Number.isNaN(storedExpiry)).toBe(false);
      expect(storedExpiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });
});
