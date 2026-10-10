import { LANGUAGES } from '@/shared/languages';
import { DEFAULT_CONFIG, type Config, type Provider } from '@/shared/types';

const PROVIDERS: { id: Provider; label: string; keyHint: string }[] = [
  { id: 'deepseek', label: 'deepseek', keyHint: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI (GPT)', keyHint: 'sk-...' },
  { id: 'google', label: 'Google (Gemini)', keyHint: 'AIza...' },
];

export function TranslationSettings({ config, onSave }: { config: Config; onSave: (patch: Partial<Config>) => void }) {
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
        <h2>Style &amp; personality</h2>
        <div className="opts-row">
          <label htmlFor="personality">Translation style guidance</label>
          <textarea
            id="personality"
            value={config.personality}
            onChange={(e) => setAndSave({ personality: e.target.value })}
          />
          <div className="opts-help">
            Applied as a system prompt. E.g. "Match the casual tone of the source. Use UK spelling."
          </div>
        </div>
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
