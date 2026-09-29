import en from "./messages/en.json";
import ru from "./messages/ru.json";
import uz from "./messages/uz.json";

export const LOCALES = ["uz", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "uz";

const dictionaries = { uz, ru, en } satisfies Record<Locale, typeof uz>;
export type MessageKey = keyof typeof uz;

export function getT(locale: Locale = DEFAULT_LOCALE) {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  return (key: MessageKey) => dict[key] ?? uz[key] ?? key;
}
