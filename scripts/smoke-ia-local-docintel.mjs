#!/usr/bin/env node

const provider = process.env.AI_PROVIDER || 'ialocal';
const externalAllowed = process.env.AI_ALLOW_EXTERNAL || 'false';
const baseUrl = (process.env.IA_LOCAL_BASE_URL || 'http://ia-local-gateway:8443/v1').replace(/\/+$/, '');
const apiKey = process.env.IA_LOCAL_API_KEY;
const model = process.env.IA_LOCAL_MODEL || 'unico-docintel';
const embeddingModel = process.env.IA_LOCAL_EMBED_MODEL || 'bge-m3';
const timeoutMs = Number(process.env.IA_LOCAL_SMOKE_TIMEOUT_MS || 90_000);
const generationRepeats = Number(process.env.IA_LOCAL_SMOKE_GENERATION_REPEATS || 1);
const numPredict = Number(process.env.IA_LOCAL_NUM_PREDICT || 1536);
const numCtx = Number(process.env.IA_LOCAL_NUM_CTX || 8192);

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function assertConfig() {
  if (provider !== 'ialocal') fail(`AI_PROVIDER deve ser ialocal, atual=${provider}`);
  if (externalAllowed !== 'false') fail('AI_ALLOW_EXTERNAL deve permanecer false');
  if (model !== 'unico-docintel') fail(`IA_LOCAL_MODEL deve ser unico-docintel, atual=${model}`);
  if (!apiKey) fail('IA_LOCAL_API_KEY ausente');
}

function includesModel(ids, name) {
  return ids.has(name) || ids.has(`${name}:latest`);
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    const ms = Math.round(performance.now() - start);
    if (!response.ok) {
      throw new Error(`${path} HTTP ${response.status}`);
    }

    return { ms, json: JSON.parse(text) };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(check, samplesMs, extra = {}) {
  const avgMs = Math.round(samplesMs.reduce((sum, ms) => sum + ms, 0) / samplesMs.length);
  console.log(JSON.stringify({ check, ok: true, avg_ms: avgMs, samples_ms: samplesMs, ...extra }));
}

assertConfig();

const models = [];
for (let i = 0; i < 3; i += 1) {
  models.push(await request('/models'));
}

const ids = new Set(models.at(-1).json.data?.map((entry) => entry.id) || []);
if (!includesModel(ids, model)) fail(`${model} indisponivel em /v1/models`);
if (!includesModel(ids, embeddingModel)) fail(`${embeddingModel} indisponivel em /v1/models`);
summarize(
  'models',
  models.map((sample) => sample.ms),
  { has_unico_docintel: true, has_embedding_model: true },
);

const generations = [];
for (let i = 0; i < generationRepeats; i += 1) {
  const result = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Responda somente JSON valido e curto.' },
        { role: 'user', content: 'Retorne exatamente estes campos: ok=true, ncm=85044010.' },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      options: { temperature: 0, num_predict: numPredict, num_ctx: numCtx },
    }),
  });

  const content = result.json.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail('/v1/chat/completions nao retornou JSON valido');
  }
  if (parsed.ok !== true || parsed.ncm !== '85044010') {
    fail('/v1/chat/completions retornou JSON fora do contrato');
  }
  generations.push(result.ms);
}
summarize('generation', generations, { valid_json: true, model });

const embedding = await request('/embeddings', {
  method: 'POST',
  body: JSON.stringify({
    model: embeddingModel,
    input: 'fixture sanitizada de importacao para validar embeddings locais',
  }),
});

const dimensions = embedding.json.data?.[0]?.embedding?.length || 0;
if (dimensions <= 0) fail('/v1/embeddings nao retornou vetor valido');
summarize('embeddings', [embedding.ms], { dimensions, model: embeddingModel });
