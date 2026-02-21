import type { TokenManager } from './auth.js';
import type { CreateTaskInputType, UpdateTaskInputType } from './types.js';

const BASE_URL = 'https://api.ticktick.com/open/v1';
const TIMEOUT_MS = 10_000;

export class TickTickApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`TickTick API error (${status}): ${message}`);
    this.name = 'TickTickApiError';
  }
}

export class TickTickRateLimitError extends TickTickApiError {
  constructor(public readonly retryAfter: number) {
    super(429, `Rate limited. Retry after ${retryAfter} seconds.`);
    this.name = 'TickTickRateLimitError';
  }
}

type FetchFn = typeof globalThis.fetch;

export class TickTickClient {
  constructor(
    private readonly tokenManager: TokenManager,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  async getProjects(): Promise<unknown[]> {
    return this.request('GET', '/project');
  }

  async createProject(data: { name: string }): Promise<unknown> {
    return this.request('POST', '/project', data);
  }

  async getProjectData(projectId: string): Promise<unknown> {
    return this.request('GET', `/project/${encodeURIComponent(projectId)}/data`);
  }

  async createTask(data: CreateTaskInputType): Promise<unknown> {
    return this.request('POST', '/task', data);
  }

  async getTask(projectId: string, taskId: string): Promise<unknown> {
    return this.request(
      'GET',
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    );
  }

  async updateTask(taskId: string, data: Omit<UpdateTaskInputType, 'taskId'>): Promise<unknown> {
    return this.request('POST', `/task/${encodeURIComponent(taskId)}`, data);
  }

  async completeTask(projectId: string, taskId: string): Promise<unknown> {
    return this.request(
      'POST',
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    );
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false,
  ): Promise<any> {
    const token = isRetry
      ? await this.tokenManager.forceRefresh()
      : await this.tokenManager.getValidAccessToken();

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    const response = await this.fetchFn(`${BASE_URL}${path}`, options);

    if (response.ok) {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        const snippet = text.length > 200 ? text.slice(0, 200) + '...' : text;
        throw new TickTickApiError(
          response.status,
          `Response is not valid JSON: ${snippet}`,
        );
      }
    }

    if (response.status === 401 && !isRetry) {
      return this.request(method, path, body, true);
    }

    if (response.status === 401 && isRetry) {
      throw new TickTickApiError(
        401,
        'Authentication failed after token refresh. Run `ticktick-mcp-auth` to re-authorize.',
      );
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '60');
      throw new TickTickRateLimitError(retryAfter);
    }

    const errorText = await response.text();
    throw new TickTickApiError(response.status, errorText);
  }
}
