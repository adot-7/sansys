import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, openAICompatiblePresets, resolveOpenAICompatible } from './config.js';
import { initStore } from './store.js';
import { apiRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function llmStartupWarning() {
  const name = config.llmProvider;
  if (name === 'anthropic') return config.anthropicApiKey ? null : 'ANTHROPIC_API_KEY';
  const resolved = resolveOpenAICompatible(name);
  if (!resolved) return `unknown provider (valid: anthropic, ${Object.keys(openAICompatiblePresets).join(', ')})`;
  return resolved.keyEnv && !resolved.apiKey ? `${resolved.keyEnv} (or LLM_API_KEY)` : null;
}

initStore();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Request log: every incoming request logs method, path, status and duration.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(1)}ms)`);
  });
  next();
});

app.use('/api', apiRouter);

// Serve the built React client, if present.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run `npm run build` in client/.');
  });
});

app.listen(config.port, () => {
  console.log(`Discharge summary prototype listening on http://localhost:${config.port}`);
  console.log(`LLM provider: ${config.llmProvider} (LLM_PROVIDER=${config.llmProvider})`);
  const missing = llmStartupWarning();
  if (missing) {
    console.warn(`LLM_PROVIDER=${config.llmProvider}: ${missing} not set — draft/regenerate endpoints will fail.`);
  }
});
