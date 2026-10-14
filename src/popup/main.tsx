import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { languageLabel } from '@/shared/languages';
import { loadConfig, saveConfig } from '@/shared/storage';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import type { Config } from '@/shared/types';
import './styles.css';

function PopupApp() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  if (!config) return <div className="popup-shell">正在加载…</div>;

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
      <ToggleSwitch compact label="启用翻译插件" checked={config.enabled} onChange={(enabled) => {
        setConfig({ ...config, enabled });
        void saveConfig({ enabled });
      }} />
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
