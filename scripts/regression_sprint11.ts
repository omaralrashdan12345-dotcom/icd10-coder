/**
 * Sprint-11 regression harness — v0.11.1 Z.ai runtime config remediation.
 *
 * The z-ai-web-dev-sdk (0.0.18) resolves credentials ONLY by reading a JSON
 * file at `cwd/.z-ai-config`, `homedir/.z-ai-config`, `/etc/.z-ai-config`
 * (no env fallback). Serverless platforms (Vercel/Netlify) can't ship the
 * file and their filesystem is read-only outside /tmp — so `@/lib/zai`
 * materializes it from env vars at cold boot (instrumentation.ts + module
 * load). This suite guards that behavior HERMETICALLY (temp dirs only, the
 * real repo `.z-ai-config` is never touched) plus the wiring and hygiene:
 *
 *  C — Config bootstrap: no-op without creds, first-writable-path write,
 *      usable-file short-circuit, unusable-file replacement, placeholder /
 *      short-key / non-URL rejection, optional field passthrough, temp-dir
 *      fallback with HOME pinning, throw-safety, dependency hygiene.
 *  I — Instrumentation: src/instrumentation.ts exists, exports async
 *      register(), invokes the installer.
 *  W — Wiring: pipeline.ts and glm.ts use the shared installer, SDK import +
 *      gate pins (CONF_MIN/GAP_MIN/MODEL/term caps) intact, matcher stays
 *      SDK/network-free, coding route guards intact.
 *  S — Secret hygiene: `.z-ai-config` stays gitignored; installer source has
 *      no hardcoded key literal and never logs config; generated file
 *      contains exactly the expected keys.
 *
 * Run: npx tsx scripts/regression_sprint11.ts   (from repo cwd)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installZaiConfigFromEnv } from "../src/lib/zai";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = process.cwd();
const readRepo = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CONFIG = ".z-ai-config";
const REAL_CREDS = { ZAI_BASE_URL: "https://internal-api.z.ai/v1", ZAI_API_KEY: "sk-0123456789abcdef" };
const NO_CREDS: Record<string, string | undefined> = { ZAI_BASE_URL: undefined, ZAI_API_KEY: undefined };

function makeDirs(dirMap?: { root?: string }) {
  const root = dirMap?.root ?? mkdtempSync(join(tmpdir(), "sprint11-"));
  const cwd = join(root, "cwd");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  for (const d of [cwd, home, tmp]) mkdirSync(d, { recursive: true });
  return { root, cwd, home, tmp };
}

function cfgAt(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  /* ================= C — config bootstrap (hermetic) ================= */
  console.log("================ C — config bootstrap ================");
  {
    console.log("\n▶ C1 — no env creds → complete no-op (nothing created, no throw)");
    const d = makeDirs();
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: NO_CREDS });
    check("cwd/.z-ai-config NOT created", !existsSync(join(d.cwd, CONFIG)));
    check("home/.z-ai-config NOT created", !existsSync(join(d.home, CONFIG)));
    check("tmp/.z-ai-config NOT created", !existsSync(join(d.tmp, CONFIG)));
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C2 — real creds → written to first writable SDK path (cwd), keyset exact");
    const d = makeDirs();
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: REAL_CREDS });
    const cfg = cfgAt(join(d.cwd, CONFIG));
    check("cwd/.z-ai-config created", !!cfg);
    check("baseUrl carried through", cfg?.baseUrl === REAL_CREDS.ZAI_BASE_URL);
    check("apiKey carried through", cfg?.apiKey === REAL_CREDS.ZAI_API_KEY);
    check("exact key set (baseUrl + apiKey only)", JSON.stringify(Object.keys(cfg ?? {}).sort()) === JSON.stringify(["apiKey", "baseUrl"]));
    check("home/.z-ai-config NOT created (first writable path wins)", !existsSync(join(d.home, CONFIG)));
    check("tmp/.z-ai-config NOT created", !existsSync(join(d.tmp, CONFIG)));
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C3 — existing usable file is authoritative (no overwrite)");
    const d = makeDirs();
    const pre = { baseUrl: "https://old.example/v1", apiKey: "sk-preexisting", token: "preserve-me" };
    writeFileSync(join(d.cwd, CONFIG), JSON.stringify(pre));
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: REAL_CREDS });
    const cfg = cfgAt(join(d.cwd, CONFIG));
    check("preexisting baseUrl preserved", cfg?.baseUrl === pre.baseUrl);
    check("preexisting apiKey preserved", cfg?.apiKey === pre.apiKey);
    check("preexisting token preserved", cfg?.token === pre.token);
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C4 — unusable existing file (missing apiKey) replaced from env");
    const d = makeDirs();
    writeFileSync(join(d.cwd, CONFIG), JSON.stringify({ baseUrl: "https://broken.example/v1" }));
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: REAL_CREDS });
    const cfg = cfgAt(join(d.cwd, CONFIG));
    check("file now carries REAL apiKey", cfg?.apiKey === REAL_CREDS.ZAI_API_KEY);
    check("file now carries env baseUrl", cfg?.baseUrl === REAL_CREDS.ZAI_BASE_URL);
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C5 — placeholder apiKey rejected (nothing written)");
    const d = makeDirs();
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: { ...REAL_CREDS, ZAI_API_KEY: "your-zai-api-key" } });
    check("no file created under any SDK path", !existsSync(join(d.cwd, CONFIG)) && !existsSync(join(d.home, CONFIG)) && !existsSync(join(d.tmp, CONFIG)));
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C6 — degenerate creds rejected (short key, non-URL base)");
    const d = makeDirs();
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: { ...REAL_CREDS, ZAI_API_KEY: "abc" } });
    check("short apiKey → no write", !existsSync(join(d.cwd, CONFIG)));
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env: { ...REAL_CREDS, ZAI_BASE_URL: "not-a-url" } });
    check("non-URL baseUrl → no write", !existsSync(join(d.cwd, CONFIG)));
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C7 — optional token/chatId/userId carried through");
    const d = makeDirs();
    const env = { ...REAL_CREDS, ZAI_TOKEN: "tok-abc", ZAI_CHAT_ID: "chat-1", ZAI_USER_ID: "user-1" };
    installZaiConfigFromEnv({ cwd: d.cwd, home: d.home, tmp: d.tmp, env });
    const cfg = cfgAt(join(d.cwd, CONFIG));
    check("token present", cfg?.token === "tok-abc");
    check("chatId present", cfg?.chatId === "chat-1");
    check("userId present", cfg?.userId === "user-1");
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C8 — temp-dir fallback + HOME pinning when cwd/home unreachable");
    const d = makeDirs();
    const prevHome = process.env.HOME;
    try {
      const deadCwd = join(d.root, "no-such-cwd");
      const deadHome = join(d.root, "no-such-home");
      installZaiConfigFromEnv({ cwd: deadCwd, home: deadHome, tmp: d.tmp, env: REAL_CREDS });
      const cfg = cfgAt(join(d.tmp, CONFIG));
      check("tmp/.z-ai-config created as fallback", !!cfg);
      check("HOME pinned to tmp (SDK homedir search now resolves)", process.env.HOME === d.tmp, String(process.env.HOME));
      check("fallback file carries apiKey", cfg?.apiKey === REAL_CREDS.ZAI_API_KEY);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
    rmSync(d.root, { recursive: true, force: true });
  }
  {
    console.log("\n▶ C9 — throw-safety on adversarial calls");
    let threw = false;
    try {
      installZaiConfigFromEnv({ cwd: "", home: "/nonexistent-nope", tmp: "/nonexistent-nope", env: { ...NO_CREDS, ZAI_API_KEY: "y" } });
      installZaiConfigFromEnv({});
      installZaiConfigFromEnv({ cwd: join(ROOT, "..", "no-such-dir"), home: "x", tmp: "y", env: { ZAI_BASE_URL: "", ZAI_API_KEY: "sk-short" } });
    } catch (e) {
      threw = true;
      console.log("  unexpected throw:", e);
    }
    check("never throws on missing/degenerate input", !threw);
  }
  {
    console.log("\n▶ C10 — installer dependency hygiene (server-only, no SDK, no network)");
    const zaiSrc = readRepo("src/lib/zai.ts");
    check("no z-ai-web-dev-sdk import in installer", !/from\s+["']z-ai-web-dev-sdk/.test(zaiSrc));
    check("no fetch / network calls in installer", !/(\b|\.)fetch\s*\(/.test(zaiSrc));
    check("no console/log output from installer", !/console\./.test(zaiSrc));
    check("imports are node builtins only", zaiSrc.includes("node:fs") && zaiSrc.includes("node:path") && zaiSrc.includes("node:os"));
    let clientHits = 0;
    const walk = (p: string): void => {
      for (const ent of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(ent.name) && readFileSync(full, "utf8").includes("lib/zai")) clientHits++;
      }
    };
    walk(join(ROOT, "src", "components"));
    walk(join(ROOT, "src", "hooks"));
    check("no client module imports the installer", clientHits === 0, `${clientHits} hits`);
    check("page.tsx does not import the installer", !readRepo("src/app/page.tsx").includes("lib/zai"));
  }

  /* ================= I — instrumentation hook ================= */
  console.log("================ I — instrumentation hook ================");
  {
    console.log("\n▶ I1 — instrumentation hook wired at cold boot");
    const ip = join(ROOT, "src", "instrumentation.ts");
    check("src/instrumentation.ts exists", existsSync(ip));
    const src = existsSync(ip) ? readFileSync(ip, "utf8") : "";
    check("exports async register()", /export async function register/.test(src));
    check("calls the shared installer", src.includes("installZaiConfigFromEnv"));
  }

  /* ================= W — wiring ================= */
  console.log("================ W — wiring ================");
  {
    console.log("\n▶ W1 — pipeline uses installer, keeps SDK import + gate pins");
    const p = readRepo("src/lib/snomed/pipeline.ts");
    check("pipeline imports the shared installer", p.includes("from '@/lib/zai'"));
    check("pipeline runs installer at module load", p.includes("installZaiConfigFromEnv();"));
    check("pipeline still imports the SDK (Stage 1/3)", p.includes("from 'z-ai-web-dev-sdk'"));
    check("CONF_MIN stays 0.5", /const CONF_MIN = 0\.5;/.test(p));
    check("GAP_MIN stays 0.12", /const GAP_MIN = 0\.12;/.test(p));
    check("MODEL pinned", /const MODEL = /.test(p));
    check("extraction capped at 12 terms", /\.slice\(0, 12\)/.test(p));
    check("note input capped at 4000", /text\.slice\(0, 4000\)/.test(p));
  }
  {
    console.log("\n▶ W2 — glm provider uses installer; no Vercel bail / no legacy helper");
    const g = readRepo("src/lib/llm/glm.ts");
    check("glm imports the shared installer", g.includes('from "@/lib/zai"'));
    check("glm runs installer at module load", g.includes("installZaiConfigFromEnv();"));
    check("legacy ensureZaiConfig removed", !g.includes("ensureZaiConfig"));
    check("no serverless early-return blocks setup", !g.includes("NETLIFY) return;"));
    check("isZaiConfigured kept for Auto-provider gating", g.includes("isZaiConfigured"));
  }
  {
    console.log("\n▶ W3 — matcher purity + coding route guards intact");
    const m = readRepo("src/lib/snomed/matcher.ts");
    check("matcher stays SDK/network-free", !m.includes("z-ai-web-dev-sdk") && !/fetch\(/.test(m));
    const c = readRepo("src/app/api/snomed/coding/route.ts");
    check("coding route: nodejs runtime + maxDuration 60", c.includes("nodejs") && c.includes("maxDuration = 60"));
    check("coding route: 8000-char cap with 413", c.includes("8000") && c.includes("413"));
    check("coding route: empty-text 400 guard", c.includes("400"));
  }

  /* ================= S — secret hygiene ================= */
  console.log("================ S — secret hygiene ================");
  {
    console.log("\n▶ S1 — .z-ai-config stays out of version control");
    const gi = readRepo(".gitignore");
    check(".gitignore covers .z-ai-config", gi.includes(".z-ai-config"));
  }
  {
    console.log("\n▶ S2 — installer source: no hardcoded key literal, no secret logging");
    const z = readRepo("src/lib/zai.ts");
    check("no hardcoded apiKey assignment", !/apiKey\s*=\s*["']/.test(z));
    check("no ZAI_API_KEY literal value assigned", !/ZAI_API_KEY\s*=\s*["']/.test(z));
    check("apiKey never logged", !z.includes("console"));
  }

  /* ================= summary ================= */
  console.log("\n==============================================================");
  console.log(`SPRINT 11 RESULT: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("sprint11 crashed:", e);
  process.exit(1);
});