import type { Config, Provider } from '@/shared/types';

export class MissingApiKeyError extends Error {
  constructor(public provider: Provider) {
    super(`Missing API key for ${provider}. Configure it in the extension options.`);
  }
}

export class ProviderError extends Error {
  constructor(public provider: Provider, public status: number, public body: string) {
    super(`${provider} API error ${status}: ${body.slice(0, 200)}`);
  }
}

export interface CallArgs {
  system: string;
  user: string;
  requestId?: string;
}

export async function callModel(config: Config, args: CallArgs): Promise<string> {
  const provider = config.provider;
  const apiKey = config.apiKeys[provider];
  if (!apiKey) throw new MissingApiKeyError(provider);
  const model = config.model[provider] ?? defaultModel(provider);

  const startedAt = performance.now();
  console.info('[wa-translate][provider] request start', {
    requestId: args.requestId,
    provider,
    model,
    systemChars: args.system.length,
    userChars: args.user.length,
  });

  try {
    let output: string;
    switch (provider) {
      case 'deepseek':
        output = await callDeepseek(apiKey, model, args);
        break;
      case 'anthropic':
        output = await callAnthropic(apiKey, model, args);
        break;
      case 'openai':
        output = await callOpenAI(apiKey, model, args);
        break;
      case 'google':
        output = await callGoogle(apiKey, model, args);
        break;
    }
    console.info('[wa-translate][provider] request success', {
      requestId: args.requestId,
      provider,
      model,
      outputChars: output.length,
      elapsedMs: elapsedMs(startedAt),
    });
    return output;
  } catch (err) {
    console.error('[wa-translate][provider] request failed', {
      requestId: args.requestId,
      provider,
      model,
      elapsedMs: elapsedMs(startedAt),
      error: err instanceof Error ? err.message : String(err),
      status: err instanceof ProviderError ? err.status : undefined,
    });
    throw err;
  }
}

function defaultModel(provider: Provider): string {
  switch (provider) {
    case 'deepseek':
      return 'deepseek-flash';
    case 'anthropic':
      return 'claude-sonnet-4-6';
    case 'openai':
      return 'gpt-4o-mini';
    case 'google':
      return 'gemini-2.0-flash';
  }
}

async function callDeepseek(apiKey: string, model: string, args: CallArgs): Promise<string> {
  const startedAt = performance.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      "thinking": {"type": "enabled"},
      "reasoning_effort": "high",
      "stream": false
    }),
  });
  console.info('[wa-translate][provider] DeepSeek response', {
    requestId: args.requestId,
    status: res.status,
    ok: res.ok,
    elapsedMs: elapsedMs(startedAt),
  });
  if (!res.ok) throw new ProviderError('deepseek', res.status, await safeText(res));
  const data: any = await res.json();
  const output = String(data?.choices?.[0]?.message?.content ?? '');
  console.info('[wa-translate][provider] DeepSeek output parsed', {
    requestId: args.requestId,
    outputChars: output.length,
    finishReason: data?.choices?.[0]?.finish_reason,
  });
  return output;
}

async function callAnthropic(apiKey: string, model: string, args: CallArgs): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: args.system,
      messages: [{ role: 'user', content: args.user }],
    }),
  });
  if (!res.ok) throw new ProviderError('anthropic', res.status, await safeText(res));
  const data: any = await res.json();
  const text = data?.content?.find?.((c: any) => c.type === 'text')?.text ?? '';
  return String(text);
}

async function callOpenAI(apiKey: string, model: string, args: CallArgs): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new ProviderError('openai', res.status, await safeText(res));
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? '');
}

async function callGoogle(apiKey: string, model: string, args: CallArgs): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: 'user', parts: [{ text: args.user }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new ProviderError('google', res.status, await safeText(res));
  const data: any = await res.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
