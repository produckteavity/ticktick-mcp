export class TtlCache<T> {
  private data: T | null = null;
  private fetchedAt = 0;

  constructor(private readonly ttlMs: number) {}

  async get(fetcher: () => Promise<T>, forceRefresh = false): Promise<T> {
    if (!forceRefresh && this.data !== null && Date.now() - this.fetchedAt < this.ttlMs) {
      return this.data;
    }
    this.data = await fetcher();
    this.fetchedAt = Date.now();
    return this.data;
  }

  invalidate(): void {
    this.data = null;
    this.fetchedAt = 0;
  }
}
