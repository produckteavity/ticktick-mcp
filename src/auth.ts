import { TokenRefreshResponse } from './types.js';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface KeychainLike {
  get(account: string): Promise<string | null>;
  set(account: string, password: string): Promise<void>;
  remove(account: string): Promise<void>;
}

type FetchFn = typeof globalThis.fetch;

export class TokenManager {
  private static readonly TOKEN_URL = 'https://ticktick.com/oauth/token';
  private static readonly REFRESH_MARGIN_SECS = 60;

  constructor(
    private readonly keychain: KeychainLike,
    private readonly clientId: string,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  async forceRefresh(): Promise<string> {
    return this.refreshAccessToken();
  }

  async getValidAccessToken(): Promise<string> {
    const accessToken = await this.keychain.get('access_token');
    const expiresAt = await this.keychain.get('expires_at');

    if (!accessToken || !expiresAt) {
      throw new AuthError(
        'Not authenticated. Run `ticktick-mcp-auth` to set up.'
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < Number(expiresAt) - TokenManager.REFRESH_MARGIN_SECS) {
      return accessToken;
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const refreshToken = await this.keychain.get('refresh_token');
    const clientSecret = await this.keychain.get('client_secret');

    if (!refreshToken || !clientSecret) {
      throw new AuthError(
        'Token expired and cannot refresh. Run `ticktick-mcp-auth` to re-authorize.'
      );
    }

    const response = await this.fetchFn(TokenManager.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new AuthError(
        'Token refresh failed. Run `ticktick-mcp-auth` to re-authorize.'
      );
    }

    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch {
      throw new AuthError(
        'Token refresh returned malformed response. Run `ticktick-mcp-auth` to re-authorize.'
      );
    }

    const parsed = TokenRefreshResponse.safeParse(rawData);
    if (!parsed.success) {
      throw new AuthError(
        'Token refresh returned invalid data. Run `ticktick-mcp-auth` to re-authorize.'
      );
    }

    const data = parsed.data;
    const now = Math.floor(Date.now() / 1000);

    await this.keychain.set('access_token', data.access_token);
    if (data.refresh_token) {
      await this.keychain.set('refresh_token', data.refresh_token);
    }
    await this.keychain.set('expires_at', String(now + data.expires_in));

    return data.access_token;
  }
}
