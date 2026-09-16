// chat.js — shared OpenAI-compatible Chat Completions client (plain fetch, no
// SDK). Used by the openai.js and google.js providers: Google exposes Gemini
// through the same wire format at /v1beta/openai/chat/completions.
import { buildSystemPrompt, buildDraftUserPrompt, buildRegenerateUserPrompt } from './prompts.js';
import { parseJsonReply } from './anthropic.js';

async function callChatCompletions({ baseUrl, apiKey, model, providerLabel, userPrompt, jsonMode }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userPrompt },
      ],
      ...(model.startsWith('gpt-5') ? { reasoning_effort: 'low' } : {}),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${providerLabel} API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseJsonReply(text);
}

// Builds a provider adapter for any OpenAI-compatible endpoint. Only sections
// we requested are returned; everything else defaults to empty string.
export function createOpenAICompatibleProvider({ baseUrl, apiKey, model, providerKey, providerLabel, jsonMode = true }) {
  return {
    async generateDraft(patientData, specialtyConfig) {
      const parsed = await callChatCompletions({
        baseUrl,
        apiKey,
        model,
        providerLabel,
        userPrompt: buildDraftUserPrompt(patientData, specialtyConfig),
        jsonMode,
      });
      const sections = {};
      for (const section of specialtyConfig.sections) {
        const value = section.source === null && !Array.isArray(section.sources) ? '' : parsed?.[section.id];
        sections[section.id] = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
      }
      return { sections, provider: providerKey };
    },
    async regenerateSection(sectionId, patientData, specialtyConfig, existingDraft) {
      const parsed = await callChatCompletions({
        baseUrl,
        apiKey,
        model,
        providerLabel,
        userPrompt: buildRegenerateUserPrompt(sectionId, patientData, specialtyConfig, existingDraft),
        jsonMode: false,
      });
      const text = typeof parsed === 'string' ? parsed : parsed?.text ?? '';
      return { text: String(text), provider: providerKey };
    },
  };
}
