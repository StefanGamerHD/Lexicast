// UI texts of the server's own pages. Keys are dotted so they can later be managed with Lexicast itself (decision D7).
export type Locale = 'en' | 'de';

const messages: Record<Locale, Record<string, string>> = {
  en: {
    'progress.title': 'Translation progress',
    'progress.project': 'Project',
    'progress.language': 'Language',
    'progress.translated': '{done} of {total} texts',
    'progress.inReview': '{count} in review',
    'progress.outdated': '{count} outdated',
    'progress.source': 'Source language',
    'progress.live': 'Live release {number} from {date}',
    'progress.noRelease': 'No release published yet',
    'progress.empty': 'This project has no texts yet.',
    'progress.privacy': 'This page shows counts only. No texts and no names.',
  },
  de: {
    'progress.title': 'Übersetzungsfortschritt',
    'progress.project': 'Projekt',
    'progress.language': 'Sprache',
    'progress.translated': '{done} von {total} Texten',
    'progress.inReview': '{count} in Prüfung',
    'progress.outdated': '{count} veraltet',
    'progress.source': 'Quellsprache',
    'progress.live': 'Live-Release {number} vom {date}',
    'progress.noRelease': 'Noch kein Release veröffentlicht',
    'progress.empty': 'Dieses Projekt hat noch keine Texte.',
    'progress.privacy': 'Diese Seite zeigt nur Zahlen. Keine Texte und keine Namen.',
  },
};

export function t(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const raw = messages[locale][key] ?? messages.en[key] ?? key;
  return raw.replace(/\{([a-z]+)\}/g, (m, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : m));
}

// First supported language of the Accept-Language header, else English.
export function pickLocale(header: string | undefined): Locale {
  for (const part of (header ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase();
    if (tag === 'de' || tag.startsWith('de-')) return 'de';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}
