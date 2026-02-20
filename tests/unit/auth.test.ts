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
  });
});
