import { useEffect, useState } from 'react';
import { LANGUAGES } from '@/shared/languages';
import { DEFAULT_CONFIG, type Config, type Provider } from '@/shared/types';
import { DEFAULT_TRANSLATION_PROMPT, translationScenePrompt } from '@/shared/translation-policy';

const PROVIDERS: { id: Provider; label: string; keyHint: string }[] = [
  { id: 'deepseek', label: 'deepseek', keyHint: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI (GPT)', keyHint: 'sk-...' },
  { id: 'google', label: 'Google (Gemini)', keyHint: 'AIza...' },
];

export function TranslationSettings({ config, onSave }: { config: Config; onSave: (patch: Partial<Config>) => Promise<boolean> }) {
  const savedPrompt = typeof config.translationPrompt === 'string' ? config.translationPrompt : DEFAULT_TRANSLATION_PROMPT;
  const [promptDraft, setPromptDraft] = useState(savedPrompt);
  const [savingPrompt, setSavingPrompt] = useState(false);
  useEffect(() => { setPromptDraft(savedPrompt); }, [savedPrompt]);
  const setAndSave = onSave;
  const setApiKey = (provider: Provider, key: string) => onSave({ apiKeys: { ...config.apiKeys, [provider]: key } });
  const setModel = (provider: Provider, model: string) => onSave({ model: { ...config.model, [provider]: model } });
  return <>
      <section className="opts-section">
        <h2>Language settings</h2>
        <div className="opts-row">
          <label htmlFor="native-lang">我的母语</label>
          <select
            id="native-lang"
            value={config.nativeLang}
            onChange={(e) => setAndSave({ nativeLang: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native} ({l.name})
              </option>
            ))}
          </select>
          <div className="opts-help">
            Used as the source for outbound translation. Inbound messages always auto-detect.
          </div>
        </div>
        <div className="opts-row">
          <label htmlFor="target-lang">对方的母语</label>
          <select
            id="target-lang"
            value={config.targetLang}
            onChange={(e) => setAndSave({ targetLang: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native} ({l.name})
              </option>
            ))}
          </select>
          <div className="opts-help">
            Outgoing messages are translated into this language. Incoming messages are translated into 我的母语.
          </div>
        </div>
      </section>

      <section className="opts-section">
        <h2>AI provider</h2>
        <div className="opts-providers">
          {PROVIDERS.map((p) => (
            <div
              key={p.id}
              className="opts-provider"
              data-active={config.provider === p.id ? 'true' : 'false'}
              onClick={() => setAndSave({ provider: p.id })}
            >
              {p.label}
            </div>
          ))}
        </div>
        {PROVIDERS.map((p) => (
          <div key={p.id} style={{ display: config.provider === p.id ? 'block' : 'none' }}>
            <div className="opts-row">
              <label htmlFor={`apikey-${p.id}`}>{p.label} API key</label>
              <input
                id={`apikey-${p.id}`}
                type="password"
                placeholder={p.keyHint}
                value={config.apiKeys[p.id] ?? ''}
                onChange={(e) => setApiKey(p.id, e.target.value)}
              />
              <div className="opts-help">
                Stored locally in <code>chrome.storage.local</code>. Never synced.
              </div>
            </div>
            <div className="opts-row">
              <label htmlFor={`model-${p.id}`}>Model</label>
              <input
                id={`model-${p.id}`}
                type="text"
                value={config.model[p.id] ?? DEFAULT_CONFIG.model[p.id] ?? ''}
                onChange={(e) => setModel(p.id, e.target.value)}
              />
            </div>
          </div>
        ))}
      </section>

      <section className="opts-section">
        <h2>翻译场景与提示词</h2>
        <div className="opts-row">
          <label htmlFor="translation-prompt">外贸翻译场景</label>
          <textarea
            id="translation-prompt"
            rows={8}
            value={promptDraft}
            disabled={savingPrompt}
            onChange={(e) => setPromptDraft(e.target.value)}
            aria-describedby="translation-prompt-help"
          />
          <div id="translation-prompt-help" className="opts-help">
            默认用于中文卖家与墨西哥客户的外贸沟通。可补充行业术语、客户常用说法和付款表达。
            翻译方向仍按上方语言设置，西班牙语和英语都适用。
          </div>
          <div className="opts-prompt-actions">
            <button type="button" className="opts-primary" disabled={savingPrompt || promptDraft === savedPrompt}
              onClick={async () => {
                setSavingPrompt(true);
                try { await onSave({ translationPrompt: promptDraft }); }
                finally { setSavingPrompt(false); }
              }}>{savingPrompt ? '保存中…' : '保存提示词'}</button>
            <button type="button" className="opts-secondary" disabled={savingPrompt || promptDraft === DEFAULT_TRANSLATION_PROMPT}
              onClick={() => setPromptDraft(DEFAULT_TRANSLATION_PROMPT)}>恢复外贸默认</button>
            <span className="opts-help">{promptDraft === savedPrompt ? '与当前保存内容一致' : '修改尚未保存'}</span>
          </div>
          <div className="opts-help">
            保存后应用于新的翻译请求，旧译文缓存不再复用。编辑过程中不会调用 AI。
            恢复默认后也需点击保存；清空并保存则只保留基本翻译规则。
          </div>
        </div>
        <div className="opts-row">
          <label htmlFor="personality">翻译风格补充</label>
          <textarea
            id="personality"
            value={config.personality}
            onChange={(e) => setAndSave({ personality: e.target.value })}
          />
          <div className="opts-help">
            原有风格提示词继续生效，例如“自然礼貌，保持原文语气”。翻译始终保留原意，不额外回答客户问题或添加承诺。
          </div>
        </div>
        <details className="opts-help opts-prompt-rules">
          <summary>查看内置翻译规则</summary>
          <p>只输出目标语言的译文，保留否定、时间、原因、换行和表情；银行账号、金额、币种与链接保持原样。</p>
          <p>“无法支付”保持中性，账号太长、银行报错等原因必须保留。只有明确说钱不够或负担不起时才翻成“付不起”。场景与风格提示不能覆盖这些原意保留规则。</p>
          <p>{translationScenePrompt({ translationPrompt: savedPrompt }) ? '当前已启用场景提示词。' : '当前未设置额外场景，使用基本翻译规则。'}</p>
        </details>
      </section>

      <section className="opts-section">
        <h2>Enable</h2>
        <div className="opts-toggle">
          <input
            id="enabled"
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setAndSave({ enabled: e.target.checked })}
          />
          <label htmlFor="enabled">Enable translation hooks</label>
        </div>
        <div className="opts-help">
          Reload web.whatsapp.com after toggling.
        </div>
      </section>

  </>;
}
