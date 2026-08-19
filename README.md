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

## API

See `server/src/contracts.md` for the frozen REST contract, the normalized
patient object, specialty config schema, and the LLM provider interface. See
`server/src/sansys-api.md` for the actual external Sansys test API shapes —
that is the document to keep updated when the upstream API changes.

## Deploy on Fly.io (free, Mumbai region)

The Sansys test API is a local test server exposed over the internet. Free hosts
in the US/EU (Render, Vercel, …) often can't reach it reliably, while a host in
India mirrors the network path your own browser uses. Fly.io's free allowance
runs this app in **Mumbai (`bom`)** with a persistent SQLite volume.

The repo already ships `fly.toml`, a `Dockerfile` and `.dockerignore`.

```bash
fly auth login
fly launch --name sansys-discharge --no-deploy   # rename if taken; creates the app + data volume
# set secrets (keys live only in Fly's encrypted store, never in code):
fly secrets set LLM_PROVIDER=google
fly secrets set GOOGLE_API_KEY=<your key>
fly secrets set SANSYS_BASE_URL=http://182.70.249.137:3030
fly deploy
```

Then open the printed `https://sansys-discharge.fly.dev` URL. The volume
(`/data/summaries.db`) persists approved summaries across redeploys.

Notes:
- If `fly launch` didn't create the volume, run
  `fly volumes create data --region bom --size 1` once, then `fly deploy`.
- Check current free-tier limits at https://fly.io/docs/about/pricing/ — the
  app fits the smallest shared-cpu plan; the machine may auto-stop when idle and
  cold-start (~5s) on the next request.
- `force_https = true` handles TLS; no external service needed.

## Tests

```bash
cd server && npm test
```

## Safety properties

- Read-only toward Sansys: only the 11 documented data endpoints are ever called.
- Approved summaries are stored locally (SQLite) and never sent anywhere else.
- No authentication, per the brief (sandbox/demo only).
- Adding a specialty = adding a JSON file in `server/src/specialties/`.
