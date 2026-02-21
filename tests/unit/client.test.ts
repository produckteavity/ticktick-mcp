import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TickTickClient, TickTickApiError, TickTickRateLimitError } from '../../src/ticktick-client.js';

describe('TickTickClient', () => {
  const mockTokenManager = {
    getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
  };
  const mockFetch = vi.fn();
  let client: TickTickClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TickTickClient(mockTokenManager as any, mockFetch as any);
  });

  describe('request', () => {
    it('sends GET with Bearer token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([{ id: 'p1', name: 'Inbox' }])),
      });

      const result = await client.getProjects();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.ticktick.com/open/v1/project',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
      expect(result).toEqual([{ id: 'p1', name: 'Inbox' }]);
    });

    it('sends POST with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 't1', title: 'New task' })),
      });

      await client.createTask({ title: 'New task' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.ticktick.com/open/v1/task',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"title":"New task"'),
        }),
      );
    });

    it('retries once on 401 after token refresh', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve('[]') });
      });

      const result = await client.getProjects();
      expect(mockTokenManager.getValidAccessToken).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });

    it('throws TickTickRateLimitError on 429', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => '30' },
        text: () => Promise.resolve('Rate limited'),
      });

      await expect(client.getProjects()).rejects.toThrow(TickTickRateLimitError);
    });

    it('getTask uses /project/{pid}/task/{tid} endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 't1', title: 'Test', projectId: 'inbox123' })),
      });

      await client.getTask('inbox123', 't1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.ticktick.com/open/v1/project/inbox123/task/t1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws TickTickApiError on 500', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(client.getProjects()).rejects.toThrow(TickTickApiError);
    });
  });
});
