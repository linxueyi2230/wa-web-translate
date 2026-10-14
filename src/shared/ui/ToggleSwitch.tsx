import { useId } from 'react';
import './toggle-switch.css';

interface Props {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function ToggleSwitch({ id, label, checked, onChange, description, compact = false, disabled = false }: Props) {
  const generatedId = useId();
  const descriptionId = `${id ?? generatedId}-description`;
  return <button id={id} type="button" role="switch" aria-label={label} aria-checked={checked}
    aria-describedby={description ? descriptionId : undefined} disabled={disabled}
    className={`wa-setting-switch${compact ? ' wa-setting-switch-compact' : ''}`} data-on={checked} onClick={() => onChange(!checked)}>
    <span className="wa-setting-switch-track" aria-hidden="true"><span /></span>
    <span className="wa-setting-switch-copy"><span className="wa-setting-switch-label">{label}</span>
      <strong className="wa-setting-switch-state">{checked ? '已开启' : '已关闭'}</strong>
      {description && <span id={descriptionId} className="wa-setting-switch-description">{description}</span>}
    </span>
  </button>;
}
