import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TickTickClient, TickTickApiError, TickTickRateLimitError } from '../../src/ticktick-client.js';

describe('TickTickClient', () => {
  const mockTokenManager = {
    getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
    forceRefresh: vi.fn().mockResolvedValue('refreshed-token'),
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
      expect(mockTokenManager.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(mockTokenManager.forceRefresh).toHaveBeenCalledTimes(1);
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

    it('createTask sends repeatFlag in API body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 't1', title: 'Recurring', repeatFlag: 'RRULE:FREQ=MONTHLY;INTERVAL=1' })),
      });

      await client.createTask({ title: 'Recurring', repeatFlag: 'RRULE:FREQ=MONTHLY;INTERVAL=1' });
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.repeatFlag).toBe('RRULE:FREQ=MONTHLY;INTERVAL=1');
    });

    it('updateTask sends repeatFlag in API body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 't1', title: 'Updated', repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=2' })),
      });

      await client.updateTask('t1', { repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=2' });
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.repeatFlag).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2');
    });

    it('throws TickTickApiError on 500', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(client.getProjects()).rejects.toThrow(TickTickApiError);
    });

    it('returns null for 200 response with empty body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await client.getProjects();
      expect(result).toBeNull();
    });

    it('throws TickTickApiError when 200 response has invalid JSON', async () => {
      const invalidBody = '<html><body>Bad Gateway</body></html>';
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(invalidBody),
      });

      await expect(client.getProjects()).rejects.toThrow(TickTickApiError);
      await expect(client.getProjects()).rejects.toThrow(/Bad Gateway/);
    });

    it('truncates long invalid response body in error message', async () => {
      const longBody = 'X'.repeat(500);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(longBody),
      });

      try {
        await client.getProjects();
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TickTickApiError);
        expect(err.status).toBe(200);
        // Message should contain at most ~200 chars of body, not the full 500
        expect(err.message.length).toBeLessThan(500);
        expect(err.message).toContain('...');
      }
    });

    it('calls forceRefresh before retrying on 401', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve('[]') });
      });

      await client.getProjects();

      // forceRefresh should have been called before the retry
      expect(mockTokenManager.forceRefresh).toHaveBeenCalledTimes(1);
      // getValidAccessToken is called for the initial request, then forceRefresh for the retry
      expect(mockTokenManager.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws with re-auth guidance on double 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(client.getProjects()).rejects.toThrow(TickTickApiError);
      await expect(client.getProjects()).rejects.toThrow(/ticktick-mcp-auth/);
    });
  });
});
