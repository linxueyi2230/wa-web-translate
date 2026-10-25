export const PASSWORD_MAX_BYTES = 72;

export function passwordError(value: string, label = "密码"): string {
  if (!value.trim()) return `请输入${label}`;
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES)
    return `${label}不能超过 ${PASSWORD_MAX_BYTES} 字节`;
  return "";
}
