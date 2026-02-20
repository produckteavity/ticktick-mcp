import { execFile } from 'node:child_process';

export class Keychain {
  constructor(private readonly service: string) {}

  async get(account: string): Promise<string | null> {
    try {
      const stdout = await this.execSecurity([
        'find-generic-password',
        '-s', this.service,
        '-a', account,
        '-w',
      ]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async set(account: string, password: string): Promise<void> {
    // Delete first (may not exist, ignore errors)
    try {
      await this.execSecurity([
        'delete-generic-password',
        '-s', this.service,
        '-a', account,
      ]);
    } catch {
      // Key didn't exist, that's fine
    }

    await this.execSecurity([
      'add-generic-password',
      '-s', this.service,
      '-a', account,
      '-w', password,
    ]);
  }

  async remove(account: string): Promise<void> {
    await this.execSecurity([
      'delete-generic-password',
      '-s', this.service,
      '-a', account,
    ]);
  }

  private execSecurity(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('security', args, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
