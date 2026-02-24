import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TickTickClient } from '../../src/ticktick-client.js';

function createMockKeychain() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (account: string) => store.get(account) ?? null),
    set: vi.fn(async (account: string, value: string) => { store.set(account, value); }),
    remove: vi.fn(async (account: string) => { store.delete(account); }),
    _store: store,
  };
}

function createMockTokenManager() {
  return {
    getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
    forceRefresh: vi.fn().mockResolvedValue('refreshed-token'),
  };
}

describe('TickTickClient.getInboxProjectId', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockKeychain: ReturnType<typeof createMockKeychain>;
  let mockTokenManager: ReturnType<typeof createMockTokenManager>;
  let client: TickTickClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    mockKeychain = createMockKeychain();
    mockTokenManager = createMockTokenManager();
    client = new TickTickClient(mockTokenManager as any, mockKeychain, mockFetch as any);
  });

  it('returns cached inbox ID from memory on subsequent calls', async () => {
    // First call: keychain has it
    mockKeychain._store.set('inbox_id', 'inbox123');
    const first = await client.getInboxProjectId();
    const second = await client.getInboxProjectId();

    expect(first).toBe('inbox123');
    expect(second).toBe('inbox123');
    // Keychain.get should only be called once (first call), second uses memory cache
    expect(mockKeychain.get).toHaveBeenCalledTimes(1);
  });

  it('reads inbox ID from keychain when not in memory', async () => {
    mockKeychain._store.set('inbox_id', 'inbox456');

    const result = await client.getInboxProjectId();
    expect(result).toBe('inbox456');
    expect(mockKeychain.get).toHaveBeenCalledWith('inbox_id');
    // No API calls needed
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('discovers inbox ID via probe task when not cached', async () => {
    // First call: create task (returns inbox ID in projectId)
    // Second call: complete the probe task
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: 'probe-task-id',
          title: '__ticktick_mcp_inbox_probe__',
          projectId: 'inbox789',
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

    const result = await client.getInboxProjectId();

    expect(result).toBe('inbox789');
    // Should have created a probe task
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.ticktick.com/open/v1/task',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('__ticktick_mcp_inbox_probe__'),
      }),
    );
    // Should have completed the probe task
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.ticktick.com/open/v1/project/inbox789/task/probe-task-id/complete',
      expect.objectContaining({ method: 'POST' }),
    );
    // Should have persisted to keychain
    expect(mockKeychain.set).toHaveBeenCalledWith('inbox_id', 'inbox789');
  });

  it('caches discovered inbox ID in keychain for persistence', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: 'probe-id',
          projectId: 'inbox999',
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

    await client.getInboxProjectId();

    expect(mockKeychain.set).toHaveBeenCalledWith('inbox_id', 'inbox999');
  });

  it('still caches inbox ID even if probe task cleanup fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: 'probe-id',
          projectId: 'inbox555',
        })),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: () => Promise.resolve('Internal Server Error'),
      });

    // Should NOT throw — cleanup failure is non-fatal
    const result = await client.getInboxProjectId();
    expect(result).toBe('inbox555');
    expect(mockKeychain.set).toHaveBeenCalledWith('inbox_id', 'inbox555');
  });

  it('throws when probe task creation fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(client.getInboxProjectId()).rejects.toThrow();
  });

  it('throws when probe task response has no projectId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        id: 'probe-id',
        title: '__ticktick_mcp_inbox_probe__',
        // no projectId field
      })),
    });

    await expect(client.getInboxProjectId()).rejects.toThrow(/inbox/i);
  });

  it('deduplicates concurrent calls — only one probe task is created', async () => {
    // Mock: first call creates probe task, second call completes it
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: 'probe-id',
          projectId: 'inbox-concurrent',
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

    // Fire two calls concurrently before either resolves
    const [result1, result2] = await Promise.all([
      client.getInboxProjectId(),
      client.getInboxProjectId(),
    ]);

    expect(result1).toBe('inbox-concurrent');
    expect(result2).toBe('inbox-concurrent');

    // POST /task (probe creation) should only be called ONCE
    const postTaskCalls = mockFetch.mock.calls.filter(
      (call: any[]) =>
        call[0] === 'https://api.ticktick.com/open/v1/task' &&
        call[1]?.method === 'POST' &&
        call[1]?.body?.includes('__ticktick_mcp_inbox_probe__'),
    );
    expect(postTaskCalls).toHaveLength(1);
  });

  it('still returns discovered ID when keychain.set fails', async () => {
    // Mock probe task creation and completion
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: 'probe-id',
          projectId: 'inbox-keychain-fail',
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

    // Make keychain.set reject
    mockKeychain.set.mockRejectedValueOnce(new Error('keychain write failed'));

    const result = await client.getInboxProjectId();

    // Should still return the discovered ID despite keychain failure
    expect(result).toBe('inbox-keychain-fail');
    expect(mockKeychain.set).toHaveBeenCalledWith('inbox_id', 'inbox-keychain-fail');
  });
});
