// anthropic.js — Anthropic Messages API adapter (plain fetch, no SDK).
// Errors throw; there is no silent fallback to another provider here.
import { config } from '../config.js';
import { buildSystemPrompt, buildDraftUserPrompt, buildRegenerateUserPrompt } from './prompts.js';

// Strip markdown code fences and extract the first JSON value found.
export function parseJsonReply(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.search(/[[{]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error('LLM reply was not valid JSON');
  }
}

async function callAnthropic(userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parseJsonReply(text);
}

export async function generateDraft(patientData, specialtyConfig) {
  const parsed = await callAnthropic(buildDraftUserPrompt(patientData, specialtyConfig));
  // Only sections we requested; everything else defaults to empty string.
  const sections = {};
  for (const section of specialtyConfig.sections) {
    const value = section.source === null && !Array.isArray(section.sources) ? '' : parsed?.[section.id];
    sections[section.id] = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  }
  return { sections, provider: 'anthropic' };
}

export async function regenerateSection(sectionId, patientData, specialtyConfig, existingDraft) {
  const parsed = await callAnthropic(buildRegenerateUserPrompt(sectionId, patientData, specialtyConfig, existingDraft));
  const text = typeof parsed === 'string' ? parsed : parsed?.text ?? '';
  return { text: String(text), provider: 'anthropic' };
}
