import { useState } from "react";
function InputIcon({
  name,
}: {
  name: "account" | "lock" | "clear" | "eye" | "hidden";
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "account" ? (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      ) : name === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="3" />
          <path d="M8 10V6a4 4 0 0 1 8 0v4" />
        </>
      ) : name === "clear" ? (
        <>
          <path d="m7 7 10 10M17 7 7 17" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {name === "hidden" && <path d="m3 3 18 18" />}
        </>
      )}
    </svg>
  );
}
export function AccountField({
  label,
  value,
  onChange,
  password = false,
  code = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  password?: boolean;
  code?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="hm-field">
      <span>{label}</span>
      <div>
        {!code && (
          <i>
            <InputIcon name={password ? "lock" : "account"} />
          </i>
        )}
        <input
          aria-label={label}
          type={password && !visible ? "password" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={password ? "current-password" : "off"}
        />
        {!code && value && (
          <button
            type="button"
            aria-label={`清空${label}`}
            onClick={() => onChange("")}
          >
            <InputIcon name="clear" />
          </button>
        )}
        {password && (
          <button
            type="button"
            aria-label={visible ? "隐藏密码" : "显示密码"}
            onClick={() => setVisible(!visible)}
          >
            <InputIcon name={visible ? "eye" : "hidden"} />
          </button>
        )}
      </div>
    </label>
  );
}
