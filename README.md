# ICD-10-CM AI Coding Agent

Convert clinical text into ICD-10-CM codes ranked dynamically (Primary / Secondary / Supplemental) with RAG validation, 7th-character checks, and structured LLM outputs.

**Languages:** English (LTR, default) / Arabic (RTL) — remember your choice
**Stack:** Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + NextAuth.js + Z.ai GLM
**PWA:** Installable on Android, iOS, and Desktop

---

## 🆕 What's new in v0.3

- **English is now the default language** (device language respected; choice persists)
- **Mobile-first redesign** — sticky Analyze action bar, horizontal sample-case scroller, 44px touch targets, no-zoom inputs, safe-area padding, compact header
- **Smarter offline coder** — 111 clinical patterns + 35 chronic-condition matchers, negation-aware matching ("no fever" never codes fever), body-part-scoped laterality ("bilateral knee OA" no longer makes a wrist fracture bilateral), acuity & encounter-timing detection driving the 7th character (A/D/S)
- **Secondary Diagnoses fixed** — per UHDDS / ICD-10-CM Official Guidelines Section III, the Secondary slot now captures ALL co-existing conditions affecting care (chronic AND acute), with a new `SECONDARY_MISSING` validation warning when a documented condition was not coded. External-cause codes (V/W/X/Y) stay supplemental (last) per Chapter 20 — and a new `EXTERNAL_CAUSE_IN_SECONDARY` error catches misplacement
- **Expanded offline ICD-10 database** — ~400 curated codes across all chapters (was ~70), with BM25 retrieval, medical synonym expansion ("htn" → hypertension), light stemming, and fuzzy trigram matching
- **Combination-code intelligence** — diabetic foot ulcer → E11.621 code-first; HTN + CKD → I12.- + N18.-; diabetes refined by complication (E11.40/E11.65/E11.22…)
- **6 color themes** (Emerald, Ocean, Violet, Rose, Amber, Slate Mono) + light/dark/system mode + 4 text sizes — all persisted
- **Larger fonts everywhere** + per-code copy buttons and a mobile code-summary strip with "copy all codes"

---

## ❓ Secondary vs Supplemental — what goes where?

| Slot | Contents | Guideline |
|------|----------|-----------|
| **Primary** | The principal diagnosis — the main reason for the encounter (injury S/T code for injuries, never V/W/X/Y) | OGCR Section II |
| **Secondary** | ALL co-existing conditions affecting care this encounter — chronic (diabetes, HTN, CKD, COPD…) AND acute (dehydration, anemia). External causes do **NOT** belong here | OGCR Section III + UHDDS |
| **Supplemental** | External cause codes (how it happened), place (Y92), activity (Y93), status (Y99) — reported AFTER all diagnosis codes | OGCR Chapter 20 |

---

## 🚀 One-Click Deploy

After pushing this repo to GitHub, click one of the buttons below:

### Vercel (recommended — Next.js native, generous free tier)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/icd10-coder&env=NEXTAUTH_SECRET,NEXTAUTH_URL,ZAI_BASE_URL,ZAI_API_KEY,ZAI_TOKEN&envDescription=NextAuth%20secret%20%2B%20Z.ai%20API%20credentials&project-name=icd10-coder&repository-name=icd10-coder)

### Netlify
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

### Cloudflare Pages
[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)

> Replace `YOUR_USERNAME` in the Vercel button URL with your actual GitHub username after you push the repo (see Step 6 below).

---

## 📦 Quick Deploy Guide (5 minutes)

### Step 1 — Unzip the project
```bash
unzip icd10-coder.zip -d icd10-coder
cd icd10-coder
```

### Step 2 — Create a new GitHub repo
1. Go to [github.com/new](https://github.com/new)
2. Repository name: `icd10-coder`
3. Set to **Public** (required for free Vercel/Netlify deploy)
4. **Do NOT** initialize with README/license/gitignore (the project already has them)
5. Click **Create repository**

### Step 3 — Init git and push
```bash
# Inside the icd10-coder/ directory
git init
git add .
git commit -m "Initial commit: ICD-10-CM AI Coding Agent"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/icd10-coder.git
git push -u origin main
```
(replace `YOUR_USERNAME` with your actual GitHub username)

### Step 4 — Deploy to Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Sign in with GitHub
3. Click **Import** next to your `icd10-coder` repo
4. Vercel auto-detects Next.js — keep the defaults
5. Open the **Environment Variables** section and add:

   | Name | Value | Where to get it |
   |------|-------|-----------------|
   | `NEXTAUTH_SECRET` | (random 32+ char string) | Run `openssl rand -base64 32` in terminal |
   | `NEXTAUTH_URL` | `https://your-app.vercel.app` | Use the Vercel-assigned domain (shown after deploy) |
   | `ZAI_BASE_URL` | `https://internal-api.z.ai/v1` | Z.ai API base |
   | `ZAI_API_KEY` | (your Z.ai API key) | From [chat.z.ai](https://chat.z.ai) |
   | `ZAI_TOKEN` | (your JWT token) | From [chat.z.ai](https://chat.z.ai) |

6. Click **Deploy** — wait 1-2 minutes
7. You get a public HTTPS URL like `https://icd10-coder.vercel.app`

### Step 5 — Set the production URL
After the first deploy:
1. Copy your Vercel URL (e.g. `https://icd10-coder.vercel.app`)
2. Go to Vercel → your project → **Settings** → **Environment Variables**
3. Update `NEXTAUTH_URL` to `https://icd10-coder.vercel.app` (no trailing slash)
4. **Redeploy** (Deployments → ⋮ menu → Redeploy)

### Step 6 — Install on Mobile / Desktop
Open your Vercel URL on your phone/desktop and follow the PWA install steps in §6 below.

---

## 🆓 Free Tier Limits (as of 2025)

| Provider | Free tier | Bandwidth | Build minutes |
|----------|-----------|-----------|---------------|
| **Vercel Hobby** | 100 GB bandwidth/month, unlimited deployments | ✅ generous | unlimited |
| **Netlify Free** | 100 GB bandwidth/month, 300 build minutes | ✅ generous | 300 min/month |
| **Cloudflare Pages** | Unlimited bandwidth, 500 builds/month | ✅ best | 500/month |

All three support Next.js 16 with PWA + HTTPS out of the box.

---

## 1. Prerequisites

- **Node.js 20+** (or **Bun 1.1+** — recommended, faster)
- **npm** / **pnpm** / **yarn** / **bun** — any package manager works
- Internet connection (for the Z.ai GLM API and the optional NLM ICD-10 API)

Verify Node:
```bash
node --version    # should be v20 or higher
```

Or install Bun:
```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

---

## 2. Install

Unzip the project, then from the project root:

```bash
# using bun (recommended)
bun install

# OR using npm
npm install

# OR using pnpm
pnpm install
```

---

## 3. Configure Z.ai GLM API

The app uses the Z.ai GLM SDK (`z-ai-web-dev-sdk`). You can configure it **two ways**:

### Option A — Config file (local dev only)
Create a file at one of:
- `./.z-ai-config` (project root — recommended for local dev)
- `~/.z-ai-config` (user home)
- `/etc/.z-ai-config` (system-wide, Linux/macOS)

```json
{
  "baseUrl": "https://internal-api.z.ai/v1",
  "apiKey": "YOUR_ZAI_API_KEY",
  "chatId": "optional-chat-id",
  "userId": "optional-user-id",
  "token": "YOUR_JWT_TOKEN"
}
```

### Option B — Environment variables (recommended for Vercel/Netlify)
Set these env vars in your deploy dashboard (see `.env.example`):
```
ZAI_BASE_URL=https://internal-api.z.ai/v1
ZAI_API_KEY=your-zai-api-key
ZAI_TOKEN=your-jwt-token
ZAI_CHAT_ID=optional
ZAI_USER_ID=optional
```

> The app auto-writes a `.z-ai-config` file from env vars at startup if no config file exists. **This means cloud deploys work without shipping the secret file.**
>
> Get your API key from [chat.z.ai](https://chat.z.ai). Without valid credentials, only the **Mock Coder** model will work (offline demo).

---

## 4. Run in Development

```bash
# using bun
bun run dev

# OR using npm
npm run dev
```

App starts on **http://localhost:3000**

Open it in your browser. You'll see the login page.

### Login credentials (demo)
- **Username:** `omar`
- **Password:** `omar123`

(Pre-filled on the form — just click the green Sign In button.)

---

## 5. Production Build (for deployment)

```bash
# using bun
bun run build
bun run start

# OR using npm
npm run build
npm run start
```

The build outputs to `.next/standalone/` (portable, suitable for Docker / VPS / Vercel / Netlify).

---

## 6. Install as an App on Mobile / Desktop (PWA)

The app is a **Progressive Web App** — once it's running (locally or deployed), you can install it as a native-like app.

### Android (Chrome / Edge)
1. Open the app URL in Chrome
2. Tap the **three-dot menu** (top-right)
3. Tap **"Add to Home screen"** (or "Install app")
4. Confirm — the app icon appears on your home screen
5. Launch it like any other app — fullscreen, no browser chrome

### iOS (Safari)
1. Open the app URL in **Safari** (must be Safari, not Chrome)
2. Tap the **Share button** (square with up-arrow, bottom of screen)
3. Tap **"Add to Home Screen"**
4. Tap **Add** — the app icon appears on your home screen
5. Launch it — it runs in its own window, not a tab

### Desktop (Chrome / Edge / Brave)
1. Open the app URL in Chrome or Edge
2. Look for the **install icon** in the address bar (⊕ or a monitor with down-arrow)
3. Click it → **Install**
4. The app opens in its own window, with a desktop shortcut

**Alternative method on desktop:** Click the three-dot menu → **"Cast, save, and share"** → **"Install page as app..."**

### Notes on PWA installation
- The app **must be served over HTTPS** for PWA install on mobile (use `http://localhost` for local testing — Chrome treats localhost as secure)
- After installation, the app works **offline for the UI shell** (cached) but API calls still need network
- On iOS, PWAs have some limitations (no push notifications from PWA until iOS 16.4+)

---

## 7. Deploy to Production (free options)

See the **Quick Deploy Guide** at the top of this README for the fastest path (Vercel, ~5 min).

### Option A: Vercel (recommended — Next.js native)
See Quick Deploy Guide §1–5 above. Free Hobby tier includes 100 GB bandwidth/month + HTTPS + auto PWA support.

### Option B: Netlify
1. Push to GitHub (see Quick Deploy Guide Step 1-3)
2. Import on [netlify.com](https://netlify.com)
3. Build command auto-detected from `netlify.toml`
4. Add the same env vars as Vercel (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ZAI_*`)
5. Deploy

### Option C: Cloudflare Pages
1. Push to GitHub
2. Go to [pages.cloudflare.com](https://pages.cloudflare.com) → Create project → Connect to Git
3. Framework preset: **Next.js**
4. Build command: `npm run build`
5. Add env vars
6. Deploy — unlimited bandwidth on free tier

### Option D: Self-host (VPS / Docker)
```bash
# Build (multi-stage Dockerfile recommended)
docker build -t icd10-coder .
# Run
docker run -p 3000:3000 \
  -e NEXTAUTH_SECRET=$(openssl rand -base64 32) \
  -e NEXTAUTH_URL=https://your-domain.com \
  -e ZAI_BASE_URL=https://internal-api.z.ai/v1 \
  -e ZAI_API_KEY=your-key \
  -e ZAI_TOKEN=your-token \
  icd10-coder
```

### Option E: Vercel CLI (without GitHub)
If you prefer not to use GitHub:
```bash
npm i -g vercel
cd icd10-coder
vercel          # follow prompts (first deploy)
vercel --prod   # promote to production
vercel env add NEXTAUTH_SECRET
vercel env add NEXTAUTH_URL
vercel env add ZAI_BASE_URL
vercel env add ZAI_API_KEY
vercel env add ZAI_TOKEN
vercel --prod   # redeploy with env vars
```

---

## 8. Project Structure

```
icd10-coder/
├── src/
│   ├── app/
│   │   ├── page.tsx                       ← Main UI (input + results + auth gate)
│   │   ├── layout.tsx                     ← PWA metadata, RTL/LTR, SessionProvider
│   │   ├── globals.css                    ← Tailwind + print + RTL styles
│   │   └── api/
│   │       ├── code/route.ts              ← POST /api/code  (RAG → LLM → Validation)
│   │       ├── icd-search/route.ts        ← GET /api/icd-search?q=...
│   │       └── auth/[...nextauth]/route.ts ← NextAuth handler
│   ├── lib/
│   │   ├── auth.ts                        ← NextAuth config (Credentials, user "omar")
│   │   ├── schemas/icd.ts                 ← Zod schemas (ICDCodeDetail, etc.)
│   │   ├── llm/
│   │   │   ├── types.ts                   ← LLMProvider interface
│   │   │   ├── glm.ts                     ← GLM-4.6 / GLM-4.5 (system prompt)
│   │   │   ├── mock.ts                    ← Offline deterministic coder
│   │   │   └── index.ts                   ← Factory: getLLMProvider(id)
│   │   ├── icd/
│   │   │   ├── data.ts                    ← Built-in ICD-10 dataset + Code-First rules
│   │   │   ├── vector.ts                  ← In-memory Vector DB (TF-IDF cosine)
│   │   │   ├── nlm.ts                     ← NLM Clinical Tables API client
│   │   │   ├── rag.ts                     ← Unified RAG search (NLM + Vector fallback)
│   │   │   └── validation.ts              ← Validation Engine (5 rules)
│   │   └── i18n/translations.ts           ← Arabic + English strings, sample cases
│   ├── components/
│   │   ├── icd/
│   │   │   ├── code-card.tsx              ← Primary/Secondary/Tertiary cards
│   │   │   ├── panels.tsx                 ← Validation + RAG context panels
│   │   │   └── login-card.tsx             ← Login form
│   │   ├── providers/session-provider.tsx ← NextAuth SessionProvider wrapper
│   │   └── ui/                            ← shadcn/ui components (already included)
│   └── hooks/
├── public/
│   ├── manifest.json                      ← PWA manifest
│   ├── icon.svg                           ← App icon (scalable)
│   └── robots.txt
├── prisma/schema.prisma                   ← Prisma schema (SQLite, optional)
├── .env.example                           ← Template for env vars (copy to .env.local)
├── .gitignore                             ← Ignores node_modules, .env*, .z-ai-config, etc.
├── .nvmrc                                 ← Pins Node 20 for cloud deploys
├── vercel.json                            ← Vercel deploy config
├── netlify.toml                           ← Netlify deploy config
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                        ← shadcn/ui config
└── README.md                              ← This file
```

---

## 9. Features

### Coding
- **RAG Layer:** NLM Clinical Tables API + in-memory Vector DB (TF-IDF cosine similarity over ~80 common ICD-10 codes)
- **LLM Reasoner:** Switchable between GLM-4.6 (best), GLM-4.5 (faster), Mock Coder (offline)
- **Structured Outputs:** Zod schemas mirror Pydantic models (ICDCodeDetail + ClinicalCodingResponse)
- **Validation Engine:** 5 rules
  - `SEVENTH_CHAR_REQUIRED` (error) — detects S/T/W/X/Y codes missing the 7th character
  - `EXTERNAL_CAUSE_AS_PRIMARY` (error) — blocks V/W/X/Y codes from being Primary
  - `CODE_FIRST_RULES` (warning/info) — 4 rules: diabetes+foot ulcer, diabetes+neuropathy, poisoning, HTN+CKD
  - `LOW_CONFIDENCE` (warning) — flags codes < 60% confidence
  - `DUPLICATE_CODE` (warning) — prevents same code at multiple levels
- **Confidence Score** per code (0-1) with colored progress bar
- **NER Display** — extracted clinical entities (disease, symptom, laterality, acuity, external_cause, etc.)
- **RAG Context Panel** — shows retrieved codes with source (NLM vs Vector DB) and similarity score
- **PDF Export** via print dialog (A4, RTL-aware, page-break-safe)
- **Copy JSON** — copy raw structured output to clipboard

### Auth
- **NextAuth.js v4** with Credentials provider
- **Single demo user:** `omar` / `omar123`
- JWT session (7-day expiry)
- User badge with avatar initial in header
- Logout button

### UI/UX
- **Bilingual:** Arabic (RTL, default) / English (LTR) — instant toggle
- **Responsive:** Mobile-first (verified on 390×844) + Desktop (1440×900)
- **PWA:** installable on Android, iOS, Desktop
- **Touch-friendly:** buttons ≥ 36px on mobile
- **Color scheme:** Emerald (Primary) + Amber (Secondary) + Slate (Tertiary)
- **Accessibility:** semantic HTML, ARIA labels, sticky footer

---

## 10. Sample Cases (try these)

The app includes 5 pre-loaded sample cases:

1. **Cat scratch + DM2** — `Patient came to ER with cat scratch on his right lower leg today, controlled type 2 diabetes.`
2. **DM2 foot ulcer** — `55-year-old male with long-standing type 2 diabetes presents with a non-healing ulcer on the right heel for 6 weeks...`
3. **COPD exacerbation** — `62-year-old female with COPD presenting with increased dyspnea, purulent sputum...`
4. **Dog bite, left hand** — `Patient presents with dog bite on left hand sustained this morning...`
5. **HTN + CKD follow-up** — `Follow-up visit for chronic kidney disease stage 3 and essential hypertension...`

Click any chip on the input panel to load it, then click **"تحليل وترميز" / "Analyze & Code"**.

---

## 10b. Free LLM Models (optional)

The app supports **10 LLM providers** out of the box. You can mix and match — set any combination of API keys below and the UI will auto-detect which providers are available.

| Provider | Model | Free tier | Sign-up | Env var |
|----------|-------|-----------|---------|---------|
| **Z.ai GLM** | GLM-4-Flash | ✅ free, very fast | (built-in) | `ZAI_API_KEY` |
| **Z.ai GLM** | GLM-4.5 / 4.6 | paid (better quality) | (built-in) | `ZAI_API_KEY` |
| **Groq** | Llama 3.3 70B | ✅ 30 RPM, 14400 RPD, 500+ tok/s | [console.groq.com/keys](https://console.groq.com/keys) | `GROQ_API_KEY` |
| **Groq** | Llama 3.1 8B Instant | ✅ same free tier | [console.groq.com/keys](https://console.groq.com/keys) | `GROQ_API_KEY` |
| **Google Gemini** | 1.5 Flash | ✅ 15 RPM, 1500 RPD, 1M context | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | `GEMINI_API_KEY` |
| **Google Gemini** | 2.0 Flash | ✅ same free tier | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | `GEMINI_API_KEY` |
| **OpenRouter** | Llama 3.3 70B `:free` | ✅ free models available | [openrouter.ai/keys](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` |
| **OpenRouter** | Gemma 2 9B `:free` | ✅ free models available | [openrouter.ai/keys](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` |
| **Mock** | (offline) | ✅ always available | (none) | (none) |

### How to enable a new provider
1. Sign up at the provider's link above (free, takes ~30 seconds)
2. Copy your API key
3. Add it to your `.env.local` (local dev) or Vercel/Netlify env vars (cloud)
4. Restart the dev server (or redeploy)
5. The provider will appear as **"ready"** in the model selector dropdown

### Recommended default
For free local dev: **GLM-4-Flash** (no extra sign-up needed if you already have a Z.ai key) or **Groq Llama 3.3 70B** (sign up takes 30s, runs at 500+ tok/s).

### Architecture
All providers share the same system prompt (`src/lib/llm/shared-prompt.ts`) and JSON schema (`src/lib/schemas/icd.ts`), so swapping models produces identical output shape — only the quality/speed varies.

```
src/lib/llm/
├── types.ts                  ← provider metadata + LLMProviderId union
├── shared-prompt.ts          ← system prompt + user msg builder (shared)
├── glm.ts                    ← Z.ai GLM (4.6, 4.5, 4-Flash) via SDK
├── openai-compatible.ts      ← Groq + OpenRouter (OpenAI API format)
├── gemini.ts                 ← Google Gemini (own API format)
├── mock.ts                   ← offline deterministic coder
└── index.ts                  ← factory: getLLMProvider(id) + isProviderConfigured(id)
```

---

## 11. Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot find module 'z-ai-web-dev-sdk'` | Run `bun install` (or `npm install`) again |
| GLM API returns 401/403 | Check `.z-ai-config` file — apiKey must be valid |
| `NEXTAUTH_SECRET` warning | Set the env var to any random 32+ char string |
| Login fails with "Invalid credentials" | Use `omar` / `omar123` (or any password ≥ 3 chars for the demo) |
| NLM API shows "unreachable" | Network firewall blocking `clinicaltables.nlm.nih.gov` — Vector DB fallback kicks in automatically |
| PWA install option missing | App must be served over HTTPS (or localhost). Try Chrome/Edge. iOS requires Safari. |
| Arabic text looks wrong | Make sure `dir="rtl"` is on `<html>` (it's set automatically based on language) |
| Model dropdown shows "set GROQ_API_KEY" etc. | Provider's API key is not set. Click the "How to get free API keys?" link below the dropdown, or use Mock Coder (always available). |
| `Groq API key not found` error | Sign up at console.groq.com/keys (free, 30 sec), then set `GROQ_API_KEY` env var and restart. |
| `Google Gemini API key not found` error | Sign up at aistudio.google.com/app/apikey (free), then set `GEMINI_API_KEY` env var and restart. |
| GLM API timeout (45s) | The GLM-4.6 model is slow. Switch to GLM-4-Flash (free, faster) or Groq (500+ tok/s). |

---

## 12. Production Checklist

Before deploying to production:

- [ ] Replace hardcoded user `omar` with a real user store (Prisma + bcrypt)
- [ ] Set `NEXTAUTH_SECRET` to a strong random string (`openssl rand -base64 32`)
- [ ] Set `NEXTAUTH_URL` to your production HTTPS URL
- [ ] Replace the demo password tolerance (currently accepts any password ≥ 3 chars)
- [ ] Add rate limiting on `/api/code` (GLM calls are expensive)
- [ ] Audit the LLM system prompt for your specific use case
- [ ] Add logging / monitoring (Sentry, Datadog, etc.)
- [ ] Review the medical disclaimer — this is for educational use only

---

## 13. Medical Disclaimer

This is an **experimental coding agent for educational purposes**. Do NOT use it for diagnosis, treatment, or billing without human review by a certified medical coder. The validation rules are a subset of the full ICD-10-CM convention; always cross-check against the official ICD-10-CM Tabular List.

---

## License

MIT — see `package.json`.
