import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { languageLabel } from '@/shared/languages';
import { loadConfig, saveConfig } from '@/shared/storage';
import type { Config } from '@/shared/types';
import './styles.css';

function PopupApp() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  if (!config) return <div className="popup-shell">Loading…</div>;

  const hasKey = !!config.apiKeys[config.provider];
  return (
    <div className="popup-shell">
      <div className="popup-row">
        <strong>WhatsApp外贸助手</strong>
        <span className={hasKey ? 'popup-pill ok' : 'popup-pill warn'}>
          {hasKey ? '已配置AI' : '请设置AI API KEY'}
        </span>
      </div>
      <div className="popup-row">
        <span>AI</span>
        <span>{config.provider}</span>
      </div>
      <div className="popup-row">
        <span>我的母语</span>
        <span>{languageLabel(config.nativeLang)}</span>
      </div>
      <div className="popup-row">
        <span>对方的母语</span>
        <span>{languageLabel(config.targetLang)}</span>
      </div>
      <label className="popup-toggle">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => {
            const next = { ...config, enabled: e.target.checked };
            setConfig(next);
            saveConfig({ enabled: e.target.checked });
          }}
        />
        启用
      </label>
      <button
        type="button"
        className="popup-btn"
        onClick={() => chrome.runtime.openOptionsPage()}
      >
        设置
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
