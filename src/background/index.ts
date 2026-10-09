import { loadConfig } from '@/shared/storage';
import type { TranslateRequest, TranslateResult } from '@/shared/types';
import { buildPrompt, parseModelOutput } from './prompt';
import { callModel } from './providers';
import type { RpcMessage, TranslateRpcRequest } from '@/shared/messages';

console.info('[wa-translate][sw] service worker loaded');

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wa-translate') return;
  console.info('[wa-translate][sw] translation port connected');
  port.onMessage.addListener(async (msg: TranslateRpcRequest) => {
    if (!msg || msg.kind !== 'TRANSLATE_REQUEST') return;
    const startedAt = performance.now();
    console.info('[wa-translate][sw] request received', {
      requestId: msg.id,
      source: msg.payload.source ?? 'auto',
      target: msg.payload.target,
      textChars: msg.payload.text?.length ?? 0,
    });
    try {
      const result = await translate(msg.payload, msg.id);
      console.info('[wa-translate][sw] response ready', {
        requestId: msg.id,
        source: result.source,
        target: result.target,
        translatedChars: result.translated.length,
        elapsedMs: elapsedMs(startedAt),
      });
      const reply: RpcMessage = {
        __waTrans: true,
        kind: 'TRANSLATE_RESULT',
        id: msg.id,
        ok: true,
        result,
      };
      port.postMessage(reply);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[wa-translate][sw] translate failed', {
        requestId: msg.id,
        elapsedMs: elapsedMs(startedAt),
        error: message,
      });
      const reply: RpcMessage = {
        __waTrans: true,
        kind: 'TRANSLATE_RESULT',
        id: msg.id,
        ok: false,
        error: message,
      };
      try {
        port.postMessage(reply);
      } catch {}
    }
  });
});

async function translate(req: TranslateRequest, requestId?: string): Promise<TranslateResult> {
  const text = (req.text ?? '').trim();
  if (!text) {
    console.info('[wa-translate][sw] empty text skipped', { requestId });
    return { translated: '', source: 'unknown', target: req.target };
  }
  const config = await loadConfig();
  console.info('[wa-translate][sw] config loaded', {
    requestId,
    provider: config.provider,
    model: config.model[config.provider],
    nativeLang: config.nativeLang,
    targetLang: config.targetLang,
    hasApiKey: Boolean(config.apiKeys[config.provider]),
    enabled: config.enabled,
  });
  const prompt = buildPrompt(req, config);
  console.info('[wa-translate][sw] prompt built', {
    requestId,
    expectsSourcePrefix: prompt.expectsSourcePrefix,
    systemChars: prompt.system.length,
    userChars: prompt.user.length,
  });

  const raw = await callModel(config, {
    system: prompt.system,
    user: prompt.user,
    requestId,
  });

  const fallbackSource = req.source && req.source !== 'auto' ? req.source : 'unknown';
  const parsed = parseModelOutput(raw, prompt.expectsSourcePrefix, fallbackSource);
  console.info('[wa-translate][sw] output parsed', {
    requestId,
    rawChars: raw.length,
    translatedChars: parsed.translated.length,
    source: parsed.source,
    target: req.target,
    changed: parsed.translated.trim() !== text,
  });
  return {
    translated: parsed.translated,
    source: parsed.source as TranslateResult['source'],
    target: req.target,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'PING_CONFIG') {
    loadConfig().then((c) => {
      sendResponse({
        provider: c.provider,
        hasKey: !!c.apiKeys[c.provider],
        nativeLang: c.nativeLang,
      });
    });
    return true;
  }
  return false;
});

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
