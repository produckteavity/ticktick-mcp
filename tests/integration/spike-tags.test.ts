/**
 * Integration spike: TickTick tag support
 *
 * COMPLETED 2026-02-21:
 * - Tags confirmed working via Open API
 * - Refresh tokens are NOT issued (token lasts ~180 days)
 * - See design doc spike results for full details
 *
 * Prerequisites:
 *   1. Register app at https://developer.ticktick.com/manage
 *   2. Build: npx tsc
 *   3. Run: TICKTICK_CLIENT_ID=xxx TICKTICK_CLIENT_SECRET=yyy node dist/auth-cli.js
 *   4. Complete browser authorization
 *
 * Run: TICKTICK_CLIENT_ID=xxx npx vitest run tests/integration/spike-tags.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Keychain } from '../../src/keychain.js';
import { TokenManager } from '../../src/auth.js';
import { TickTickClient } from '../../src/ticktick-client.js';

const SKIP = !process.env.TICKTICK_CLIENT_ID;

describe.skipIf(SKIP)('Integration: Tag Support Spike', () => {
  const clientId = process.env.TICKTICK_CLIENT_ID!;
  const keychain = new Keychain('ticktick-mcp');
  const tokenManager = new TokenManager(keychain, clientId);
  const client = new TickTickClient(tokenManager);

  let createdTaskId: string | undefined;
  let projectId: string | undefined;

  it('creates a task with tags', async () => {
    const task = await client.createTask({
      title: `[SPIKE] Tag test ${Date.now()}`,
      tags: ['@test-spike', '@computer'],
    }) as any;

    expect(task.id).toBeDefined();
    createdTaskId = task.id;
    projectId = task.projectId;
  });

  it('retrieves task and verifies tags persisted', async () => {
    expect(createdTaskId).toBeDefined();
    expect(projectId).toBeDefined();

    const task = await client.getTask(projectId!, createdTaskId!) as any;

    expect(task.tags).toBeDefined();
    expect(task.tags).toContain('@test-spike');
    expect(task.tags).toContain('@computer');
  });

  it('cleans up: completes the test task', async () => {
    expect(createdTaskId).toBeDefined();
    expect(projectId).toBeDefined();

    await client.completeTask(projectId!, createdTaskId!);
  });
});
