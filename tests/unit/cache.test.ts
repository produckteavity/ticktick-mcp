import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../../src/cache.js';

describe('TtlCache', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns cached value within TTL', async () => {
    const cache = new TtlCache<string[]>(5 * 60 * 1000);
    const fetcher = vi.fn().mockResolvedValue(['a', 'b']);

    const result1 = await cache.get(fetcher);
    const result2 = await cache.get(fetcher);

    expect(result1).toEqual(['a', 'b']);
    expect(result2).toEqual(['a', 'b']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expires', async () => {
    const cache = new TtlCache<string[]>(5 * 60 * 1000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(['old'])
      .mockResolvedValueOnce(['new']);

    await cache.get(fetcher);
    vi.advanceTimersByTime(6 * 60 * 1000);
    const result = await cache.get(fetcher);

    expect(result).toEqual(['new']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('force refresh bypasses TTL', async () => {
    const cache = new TtlCache<string[]>(5 * 60 * 1000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(['old'])
      .mockResolvedValueOnce(['forced']);

    await cache.get(fetcher);
    const result = await cache.get(fetcher, true);

    expect(result).toEqual(['forced']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidate clears cache', async () => {
    const cache = new TtlCache<string[]>(5 * 60 * 1000);
    const fetcher = vi.fn().mockResolvedValue(['data']);

    await cache.get(fetcher);
    cache.invalidate();
    await cache.get(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
