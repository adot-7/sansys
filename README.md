# AI-Assisted Discharge Summary Generator (Prototype)

Prototype screen for the Sansys IPD module: pulls a patient's clinical data,
generates a sectioned discharge summary draft with an LLM, lets the doctor
edit/regenerate per section, and approves + stores the final summary locally.
Built to the spec in `discharge-summary-full-product-brief.md`, with a
Node.js/Express backend and React frontend.

## Quick start

```bash
# one-time
cd server && npm install
cd ../client && npm install

# build the client into server/public
cd client && npm run build

# run everything (backend + built frontend) on http://localhost:3001
cd ../server && npm start
```

When running locally, put the non-secret provider settings and the secret key
in the repository-root `.env` file. `npm start` loads that file automatically:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-nano
LLM_API_KEY=your-openai-key
```

Never commit `.env` or paste the key into source files or chat.

Open http://localhost:3001, use the default patient `PAT123456`, pick a
specialty (General / Dermatology / CTVS). The first draft generates
automatically on load.

## Configuration (environment variables)

### LLM provider

Set `LLM_PROVIDER` to switch providers — no code changes needed. All of them
use the same OpenAI-compatible chat completions wire format except `anthropic`.
Defaults are cheap/small models since the tasks are simple.

| `LLM_PROVIDER` | API key env | Default model | Notes |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | |
| `google` | `GOOGLE_API_KEY` | `gemini-3.6-flash` | Gemini key from Google AI Studio |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Fast + free tier |
| `ollama` | none | `gemma3:4b` | Local. Run `ollama pull gemma3:4b` and keep the daemon up |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | Native API, not OpenAI-compatible |

Model overrides, per provider: `OPENAI_MODEL`, `GOOGLE_MODEL`, `GROQ_MODEL`,
`OLLAMA_MODEL`, `ANTHROPIC_MODEL`.

Generic overrides that work with any OpenAI-compatible provider (including a
custom one — e.g. a different Ollama port or a proxy):
`LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`.

Example:
```bash
export LLM_PROVIDER=groq
export GROQ_API_KEY=gsk_...
# or locally:
export LLM_PROVIDER=ollama
export OLLAMA_MODEL=gemma2   # whatever you pulled
```

### Other

| Variable | Default | Purpose |
|---|---|---|
| `SANSYS_BASE_URL` | `http://182.70.249.137:3030` | Sansys test API base. |
| `SANSYS_TIMEOUT_MS` | `30000` | Per-endpoint request timeout. A timeout fails that request — there is no fallback data. |
| `DB_FILE` | `server/data/summaries.db` | SQLite location for approved summaries. |
| `PORT` | `3001` | Backend port. |

## Failure behavior

There is no mock/fallback data anymore. Every patient endpoint is fetched
straight from the Sansys test API and normalized (see `server/src/sansys-api.md`
for the exact request/response shapes). If an endpoint is unreachable, times
out, or returns a non-2xx status, the whole patient fetch fails with a clear
error and the UI shows it in the patient banner — nothing is fabricated.

> **Deploying to a cloud host (Render, Fly, Railway, …):** the Sansys test
> server (`http://182.70.249.137:3030`) responds in well under a second from
> local/Indian networks but may be slow or outright blocked from foreign or
> cloud egress IPs, producing `Sansys request timed out after …ms` errors. If
> that happens, deploy to a region near the test server, or ask the Sansys team
> to whitelist the host's outbound IPs. Raising `SANSYS_TIMEOUT_MS` only helps
> with slowness, not with a blocked connection.
>
> **Proving it from the deployed host:** hit `GET /api/diag/sansys` on your
> deployed server. It probes demographics, vitals, and problems straight from
> that host and reports status + latency, or on failure the OS-level cause:
> `ETIMEDOUT`/`ENETUNREACH` = firewalled/IP-blocked, `ECONNREFUSED` = the
> server is up but rejecting the connection, `ECONNRESET` = connection reset.
> A `200` here proves the API is reachable from that host. You can also check
> port 3030 reachability from many global locations at https://check-host.net.

LLM failures (wrong key, unreachable Ollama, model not pulled, provider
4xx/5xx) surface the provider's actual error message in the UI **and** are
logged to the server console (`[api] ... -> 500: <message>`), so you can see
exactly what went wrong.

### Use Claude on Render

In the Render service, open **Environment** and add/update these variables:

```text
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=claude-haiku-4-5
```

Save the changes and redeploy. The API key is read only by the server and is
never sent to the browser. The pinned model ID is
`claude-haiku-4-5-20251001`; use that instead of the alias if you prefer a fixed
version. If Anthropic rejects either model name for your account, use the exact
current Haiku model ID shown in the Anthropic Console instead.
The app also supports the default model `claude-sonnet-4-20250514` when
`ANTHROPIC_MODEL` is omitted.

## API

See `server/src/contracts.md` for the frozen REST contract, the normalized
patient object, specialty config schema, and the LLM provider interface. See
`server/src/sansys-api.md` for the actual external Sansys test API shapes —
that is the document to keep updated when the upstream API changes.

## Deploy for free (no pay-as-you-go)

The Sansys test API is a local test server exposed over the internet. Free
cloud PaaS tiers (Render, Koyeb, Vercel) all run in the US/EU, and their
network path to that server is flaky/blocked (the app's retries help but can't
fix a path that doesn't exist). Two free options actually reach it:

**Option 1 — Cloudflare Tunnel from your machine (recommended, no account/card).**
The API calls go out from *your* network — the path that already works.

```bash
npm install -g cloudflared        # one-time
scripts/tunnel.sh                 # boots the server if needed, prints a public URL
```

You get a `https://<random>.trycloudflare.com` URL (free, no Cloudflare account
needed). With your own Cloudflare account you can instead run a named tunnel
(`cloudflared tunnel create …`) with a stable hostname. Downside: your machine
must stay online, and the quick URL changes each restart (fine for a demo).

**Option 2 — Oracle Cloud Always Free (recommended for a real deploy).** A
free-forever VM, ideally in Mumbai (`ap-mumbai-1`) next to the Sansys server.
Full step-by-step guide: [`docs/deploy-oracle.md`](docs/deploy-oracle.md).

## Tests

```bash
cd server && npm test
```

## Safety properties

- Read-only toward Sansys: only the 11 documented data endpoints are ever called.
- Approved summaries are stored locally (SQLite) and never sent anywhere else.
- No authentication, per the brief (sandbox/demo only).
- Adding a specialty = adding a JSON file in `server/src/specialties/`.
