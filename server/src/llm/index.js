// llm/index.js — provider registry. Selection is driven by the LLM_PROVIDER
// env var. anthropic uses its own Messages API; every other provider (openai,
// google, groq, ollama, or any custom LLM_BASE_URL) routes through the shared
// OpenAI-compatible client (chat.js) using the presets in config.js — so
// switching is a config change, not a code change. registerProvider() is a
// test hook only, it is never used at runtime.
import { config, openAICompatiblePresets, resolveOpenAICompatible } from '../config.js';
import * as anthropic from './anthropic.js';
import { createOpenAICompatibleProvider } from './chat.js';

const overrides = new Map();

export function registerProvider(name, adapter) {
  overrides.set(name, adapter);
}

export function getProvider() {
  const name = config.llmProvider;
  if (overrides.has(name)) return overrides.get(name);

  if (name === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY (env only)');
    }
    return anthropic;
  }

  const resolved = resolveOpenAICompatible(name);
  if (!resolved) {
    throw new Error(
      `Unknown LLM provider "${name}" — set LLM_PROVIDER to one of: ` +
        `anthropic, ${Object.keys(openAICompatiblePresets).join(', ')}`,
    );
  }
  if (resolved.keyEnv && !resolved.apiKey) {
    throw new Error(`LLM_PROVIDER=${name} requires ${resolved.keyEnv} (or LLM_API_KEY) from env`);
  }

  return createOpenAICompatibleProvider({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    providerKey: name,
    providerLabel: name,
    jsonMode: resolved.jsonMode,
  });
}

export async function generateDraft(patientData, specialtyConfig) {
  return getProvider().generateDraft(patientData, specialtyConfig);
}

export async function regenerateSection(sectionId, patientData, specialtyConfig, existingDraft) {
  return getProvider().regenerateSection(sectionId, patientData, specialtyConfig, existingDraft);
}