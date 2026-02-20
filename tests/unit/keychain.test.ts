import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keychain } from '../../src/keychain.js';

// Mock child_process.execFile (safe: no shell injection)
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

describe('Keychain', () => {
  const SERVICE = 'ticktick-mcp';
  let keychain: Keychain;

  beforeEach(() => {
    vi.clearAllMocks();
    keychain = new Keychain(SERVICE);
  });

  describe('get', () => {
    it('returns stored password', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: null, stdout: string) => void) => {
          cb(null, 'my-secret-token\n');
        }
      );
      const result = await keychain.get('access_token');
      expect(result).toBe('my-secret-token');
      expect(mockExecFile).toHaveBeenCalledWith(
        'security',
        expect.arrayContaining(['find-generic-password', '-s', SERVICE, '-a', 'access_token', '-w']),
        expect.any(Function)
      );
    });

    it('returns null when key not found', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error) => void) => {
          cb(new Error('security: SecKeychainSearchCopyNext: The specified item could not be found'));
        }
      );
      const result = await keychain.get('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores a password', async () => {
      // delete first (may not exist), then add
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: null, stdout: string) => void) => {
          cb(null, '');
        }
      );
      await keychain.set('access_token', 'new-token');
      // Should call delete then add
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    it('deletes a password', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: null, stdout: string) => void) => {
          cb(null, '');
        }
      );
      await keychain.remove('access_token');
      expect(mockExecFile).toHaveBeenCalledWith(
        'security',
        expect.arrayContaining(['delete-generic-password', '-s', SERVICE, '-a', 'access_token']),
        expect.any(Function)
      );
    });
  });
});
