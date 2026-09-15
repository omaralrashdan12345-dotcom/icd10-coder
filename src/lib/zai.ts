/**
 * Boot-time config materialization for z-ai-web-dev-sdk on deployments
 * where `.z-ai-config` cannot be shipped as a file.
 *
 * The SDK (v0.0.18) resolves credentials ONLY by reading a JSON file at
 * `process.cwd()/.z-ai-config`, `os.homedir()/.z-ai-config`, or
 * `/etc/.z-ai-config` (fixed order, no env fallback, private constructor).
 * Serverless platforms (Vercel/Netlify) ship no such file and their runtime
 * filesystem is read-only except for the temp dir — so we materialize the
 * file from env vars at cold boot, into the first SDK-reachable, writable
 * path. As a last resort the temp dir is used and `process.env.HOME` is
 * pinned there so the SDK's `os.homedir()` search finds the file.
 *
 * Secrets are never logged or committed: this only writes when a real
 * (non-placeholder) `ZAI_API_KEY` and a URL-shaped `ZAI_BASE_URL` exist in
 * env, never when an existing config file is already usable, and never
 * inside a client bundle (import graph is server-only).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ZaiInstallOptions {
  cwd?: string;
  home?: string;
  tmp?: string;
  env?: Record<string, string | undefined>;
}

const CONFIG_FILE = '.z-ai-config';
const placeholder = (v?: string) => !v || v.includes('your-') || v.includes('replace-with') || v.trim().length < 8;

function sdkPaths(cwd: string, home: string): string[] {
  return [join(cwd, CONFIG_FILE), join(home, CONFIG_FILE), '/etc/.z-ai-config'];
}

function readExisting(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function usable(cfg: unknown): boolean {
  const c = cfg as { baseUrl?: unknown; apiKey?: unknown };
  return typeof c?.baseUrl === 'string' && c.baseUrl.length > 0 && typeof c?.apiKey === 'string' && c.apiKey.length > 0;
}

function buildConfig(env: Record<string, string | undefined>): Record<string, string> | null {
  const baseUrl = env.ZAI_BASE_URL;
  const apiKey = env.ZAI_API_KEY;
  if (!apiKey || placeholder(apiKey) || !baseUrl || !/^https?:\/\//.test(baseUrl)) return null;
  const cfg: Record<string, string> = { baseUrl, apiKey };
  if (env.ZAI_TOKEN) cfg.token = env.ZAI_TOKEN;
  if (env.ZAI_CHAT_ID) cfg.chatId = env.ZAI_CHAT_ID;
  if (env.ZAI_USER_ID) cfg.userId = env.ZAI_USER_ID;
  return cfg;
}

export function installZaiConfigFromEnv(opts: ZaiInstallOptions = {}): void {
  try {
    const env = opts.env ?? (process.env as Record<string, string | undefined>);
    const cwd = opts.cwd ?? process.cwd();
    const home = opts.home ?? homedir();
    const tmp = opts.tmp ?? process.env.TMPDIR ?? '/tmp';
    for (const p of sdkPaths(cwd, home)) {
      if (existsSync(p) && usable(readExisting(p))) return;
    }
    const cfg = buildConfig(env);
    if (!cfg) return;
    const candidates: string[] = sdkPaths(cwd, home);
    const tmpPath = join(tmp, CONFIG_FILE);
    const pinHome = tmp !== home && !candidates.includes(tmpPath);
    if (pinHome) candidates.push(tmpPath);
    for (const p of candidates) {
      try {
        writeFileSync(p, JSON.stringify(cfg, null, 2) /* turbopackIgnore: true */, { mode: 0o600 });
        if (pinHome && p === tmpPath) process.env.HOME = tmp;
        return;
      } catch {
        /* try the next SDK-reachable path */
      }
    }
  } catch {
    /* boot must never crash on config setup */
  }
}