// Central environment config. Keys are read from env only, never hardcoded, never logged.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 3001),
  sansysBaseUrl: process.env.SANSYS_BASE_URL || 'http://182.70.249.137:5050',
  // Per-endpoint live fetch timeout (ms). On timeout the request fails — there
  // is no fallback data anymore. Generous default: the test server can be slow
  // from cloud/foreign hosts (e.g. Render), where it may take >10s to respond.
  sansysTimeoutMs: Number(process.env.SANSYS_TIMEOUT_MS || 30000),
  llmProvider: process.env.LLM_PROVIDER || 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'summaries.db'),
};

// OpenAI-compatible provider presets — all reuse the same chat completions
// client (llm/chat.js). `keyEnv: null` means no API key is required (local
// Ollama). Default models are cheap/small since the tasks are simple; override
// per provider with <NAME>_MODEL or globally with LLM_MODEL. `jsonMode` toggles
// the OpenAI response_format hint (Ollama's compatibility layer ignores it).
export const openAICompatiblePresets = {
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini', jsonMode: true },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GOOGLE_API_KEY', defaultModel: 'gemini-3.6-flash', jsonMode: true },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', jsonMode: true },
  ollama: { baseUrl: 'http://localhost:11434/v1', keyEnv: null, defaultModel: 'gemma3:4b', jsonMode: false },
};

// Resolve a provider preset to concrete settings. Generic LLM_BASE_URL /
// LLM_API_KEY / LLM_MODEL override any preset, so any OpenAI-compatible
// endpoint works without a code change.
export function resolveOpenAICompatible(providerName) {
  const preset = openAICompatiblePresets[providerName];
  if (!preset) return null;
  return {
    baseUrl: process.env.LLM_BASE_URL || preset.baseUrl,
    apiKey: process.env.LLM_API_KEY || (preset.keyEnv ? process.env[preset.keyEnv] || '' : ''),
    model: process.env.LLM_MODEL || process.env[`${providerName.toUpperCase()}_MODEL`] || preset.defaultModel,
    keyEnv: preset.keyEnv,
    jsonMode: preset.jsonMode,
  };
}
