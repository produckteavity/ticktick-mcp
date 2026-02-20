#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Keychain } from './keychain.js';

const REDIRECT_PORT = 19876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const AUTH_URL = 'https://ticktick.com/oauth/authorize';
const TOKEN_URL = 'https://ticktick.com/oauth/token';
const SCOPE = 'tasks:read tasks:write';
const TIMEOUT_MS = 120_000;

async function main() {
  const clientId = process.env.TICKTICK_CLIENT_ID;
  const clientSecret = process.env.TICKTICK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Required environment variables: TICKTICK_CLIENT_ID, TICKTICK_CLIENT_SECRET');
    process.exit(1);
  }

  const state = randomBytes(32).toString('hex');
  const keychain = new Keychain('ticktick-mcp');

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('state', state);

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      httpServer.close();
      reject(new Error('Authorization timed out after 120 seconds'));
    }, TIMEOUT_MS);

    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const returnedState = url.searchParams.get('state');
      const authCode = url.searchParams.get('code');
      const errorParam = url.searchParams.get('error');

      if (errorParam) {
        res.writeHead(400);
        res.end(`Authorization error: ${errorParam}`);
        clearTimeout(timeout);
        httpServer.close();
        reject(new Error(`Authorization error: ${errorParam}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch — possible CSRF attack. Please try again.');
        clearTimeout(timeout);
        httpServer.close();
        reject(new Error('State mismatch'));
        return;
      }

      if (!authCode) {
        res.writeHead(400);
        res.end('No authorization code received');
        clearTimeout(timeout);
        httpServer.close();
        reject(new Error('No authorization code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>');
      clearTimeout(timeout);
      httpServer.close();
      resolve(authCode);
    });

    httpServer.listen(REDIRECT_PORT, '127.0.0.1', () => {
      console.log(`Listening on http://127.0.0.1:${REDIRECT_PORT}/callback`);
      console.log('Opening browser for authorization...');
      execFile('open', [authUrl.toString()]);
    });
  });

  console.log('Exchanging authorization code for tokens...');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Token exchange failed (${response.status}): ${text}`);
    process.exit(1);
  }

  const data = await response.json();

  const now = Math.floor(Date.now() / 1000);
  await keychain.set('client_secret', clientSecret);
  await keychain.set('access_token', data.access_token);
  if (data.refresh_token) {
    await keychain.set('refresh_token', data.refresh_token);
  }
  await keychain.set('expires_at', String(now + (data.expires_in ?? 15552000)));

  console.log('Authorization complete! Tokens stored in macOS Keychain.');
  console.log(`Access token expires in ${Math.round((data.expires_in ?? 15552000) / 86400)} days.`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
