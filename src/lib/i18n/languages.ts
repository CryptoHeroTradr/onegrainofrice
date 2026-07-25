/**
 * Languages offered by the translate switcher.
 *
 * `code` values are the ones Google Translate accepts (note the odd ones:
 * Chinese is zh-CN / zh-TW, Hebrew is "iw", Filipino is "tl", Javanese "jw").
 * `native` is what we SHOW — a visitor looking for their language scans for
 * "Español", not "Spanish" — with the English name kept alongside so the search
 * box matches either.
 */
export interface Language {
  code: string;
  native: string;
  english: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", native: "English", english: "English" },
  { code: "es", native: "Español", english: "Spanish" },
  { code: "zh-CN", native: "简体中文", english: "Chinese (Simplified)" },
  { code: "zh-TW", native: "繁體中文", english: "Chinese (Traditional)" },
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "ar", native: "العربية", english: "Arabic" },
  { code: "pt", native: "Português", english: "Portuguese" },
  { code: "ru", native: "Русский", english: "Russian" },
  { code: "ja", native: "日本語", english: "Japanese" },
  { code: "ko", native: "한국어", english: "Korean" },
  { code: "fr", native: "Français", english: "French" },
  { code: "de", native: "Deutsch", english: "German" },
  { code: "id", native: "Bahasa Indonesia", english: "Indonesian" },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese" },
  { code: "tr", native: "Türkçe", english: "Turkish" },
  { code: "it", native: "Italiano", english: "Italian" },
  { code: "th", native: "ไทย", english: "Thai" },
  { code: "pl", native: "Polski", english: "Polish" },
  { code: "nl", native: "Nederlands", english: "Dutch" },
  { code: "uk", native: "Українська", english: "Ukrainian" },
  { code: "fa", native: "فارسی", english: "Persian" },
  { code: "ms", native: "Bahasa Melayu", english: "Malay" },
  { code: "tl", native: "Filipino", english: "Filipino" },
  { code: "bn", native: "বাংলা", english: "Bengali" },
  { code: "ur", native: "اردو", english: "Urdu" },
  { code: "ta", native: "தமிழ்", english: "Tamil" },
  { code: "te", native: "తెలుగు", english: "Telugu" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada" },
  { code: "ml", native: "മലയാളം", english: "Malayalam" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
  { code: "sw", native: "Kiswahili", english: "Swahili" },
  { code: "ha", native: "Hausa", english: "Hausa" },
  { code: "yo", native: "Yorùbá", english: "Yoruba" },
  { code: "ig", native: "Igbo", english: "Igbo" },
  { code: "am", native: "አማርኛ", english: "Amharic" },
  { code: "zu", native: "isiZulu", english: "Zulu" },
  { code: "af", native: "Afrikaans", english: "Afrikaans" },
  { code: "he", native: "עברית", english: "Hebrew" },
  { code: "el", native: "Ελληνικά", english: "Greek" },
  { code: "sv", native: "Svenska", english: "Swedish" },
  { code: "no", native: "Norsk", english: "Norwegian" },
  { code: "da", native: "Dansk", english: "Danish" },
  { code: "fi", native: "Suomi", english: "Finnish" },
  { code: "is", native: "Íslenska", english: "Icelandic" },
  { code: "cs", native: "Čeština", english: "Czech" },
  { code: "sk", native: "Slovenčina", english: "Slovak" },
  { code: "hu", native: "Magyar", english: "Hungarian" },
  { code: "ro", native: "Română", english: "Romanian" },
  { code: "bg", native: "Български", english: "Bulgarian" },
  { code: "sr", native: "Српски", english: "Serbian" },
  { code: "hr", native: "Hrvatski", english: "Croatian" },
  { code: "bs", native: "Bosanski", english: "Bosnian" },
  { code: "sl", native: "Slovenščina", english: "Slovenian" },
  { code: "mk", native: "Македонски", english: "Macedonian" },
  { code: "sq", native: "Shqip", english: "Albanian" },
  { code: "lt", native: "Lietuvių", english: "Lithuanian" },
  { code: "lv", native: "Latviešu", english: "Latvian" },
  { code: "et", native: "Eesti", english: "Estonian" },
  { code: "ka", native: "ქართული", english: "Georgian" },
  { code: "hy", native: "Հայերեն", english: "Armenian" },
  { code: "az", native: "Azərbaycan", english: "Azerbaijani" },
  { code: "kk", native: "Қазақ", english: "Kazakh" },
  { code: "uz", native: "Oʻzbek", english: "Uzbek" },
  { code: "mn", native: "Монгол", english: "Mongolian" },
  { code: "ne", native: "नेपाली", english: "Nepali" },
  { code: "si", native: "සිංහල", english: "Sinhala" },
  { code: "km", native: "ខ្មែរ", english: "Khmer" },
  { code: "lo", native: "ລາວ", english: "Lao" },
  { code: "my", native: "မြန်မာ", english: "Burmese" },
  { code: "ca", native: "Català", english: "Catalan" },
  { code: "gl", native: "Galego", english: "Galician" },
  { code: "eu", native: "Euskara", english: "Basque" },
  { code: "cy", native: "Cymraeg", english: "Welsh" },
  { code: "ga", native: "Gaeilge", english: "Irish" },
  { code: "be", native: "Беларуская", english: "Belarusian" },
  { code: "so", native: "Soomaali", english: "Somali" },
  { code: "ps", native: "پښتو", english: "Pashto" },
  { code: "ku", native: "Kurdî", english: "Kurdish" },
  { code: "jw", native: "Basa Jawa", english: "Javanese" },
  { code: "su", native: "Basa Sunda", english: "Sundanese" },
  { code: "ht", native: "Kreyòl Ayisyen", english: "Haitian Creole" },
  { code: "la", native: "Latina", english: "Latin" },
  { code: "eo", native: "Esperanto", english: "Esperanto" },
];

/** The site's source language — what the copy is authored in. */
export const SOURCE_LANG = "en";

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
