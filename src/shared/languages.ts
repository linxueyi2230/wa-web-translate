export type LanguageCode = string;

export interface Language {
  code: LanguageCode;
  name: string;
  native: string;
  label: string;
}

export const LANGUAGES: Language[] = [
  { code: 'es', name: '西班牙语', native: 'Español', label: '西班牙语' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文', label: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文', label: '繁体中文' },
  { code: 'en', name: '英语', native: 'English', label: '英语' },
  { code: 'fr', name: '法语', native: 'Français', label: '法语' },
  { code: 'de', name: '德语', native: 'Deutsch', label: '德语' },
  { code: 'it', name: '意大利语', native: 'Italiano', label: '意大利语' },
  { code: 'pt', name: '葡萄牙语', native: 'Português', label: '葡萄牙语' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', label: '荷兰语' },
  { code: 'pl', name: 'Polish', native: 'Polski', label: '波兰语' },
  { code: 'ru', name: 'Russian', native: 'Русский', label: '俄语' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', label: '乌克兰语' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', label: '土耳其语' },
  { code: 'ar', name: 'Arabic', native: 'العربية', label: '阿拉伯语' },
  { code: 'he', name: 'Hebrew', native: 'עברית', label: '希伯来语' },
  { code: 'fa', name: 'Persian', native: 'فارسی', label: '波斯语' },
  { code: 'ur', name: 'Urdu', native: 'اردو', label: '乌尔都语' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', label: '印地语' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', label: '孟加拉语' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', label: '泰米尔语' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', label: '泰卢固语' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', label: '马拉雅拉姆语' },
  { code: 'th', name: 'Thai', native: 'ไทย', label: '泰语' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', label: '越南语' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', label: '印度尼西亚语' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', label: '马来语' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog', label: '他加禄语' },
  { code: 'ja', name: 'Japanese', native: '日本語', label: '日语' },
  { code: 'ko', name: 'Korean', native: '한국어', label: '韩语' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', label: '瑞典语' },
  { code: 'no', name: 'Norwegian', native: 'Norsk', label: '挪威语' },
  { code: 'da', name: 'Danish', native: 'Dansk', label: '丹麦语' },
  { code: 'fi', name: 'Finnish', native: 'Suomi', label: '芬兰语' },
  { code: 'cs', name: 'Czech', native: 'Čeština', label: '捷克语' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', label: '希腊语' },
  { code: 'ro', name: 'Romanian', native: 'Română', label: '罗马尼亚语' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', label: '匈牙利语' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', label: '斯瓦希里语' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: LanguageCode): Language | undefined {
  return BY_CODE.get(code);
}

export function languageLabel(code: LanguageCode): string {
  const l = BY_CODE.get(code);
  return l ? l.label : code;
}
