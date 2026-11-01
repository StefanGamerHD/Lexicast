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
    'role.owner': 'owner',
    'role.reviewer': 'reviewer',
    'role.translator': 'translator',
    'mail.invite.subject': 'Invitation to Lexicast ({host})',
    'mail.invite.body': '{inviter} invited you to Lexicast ({host}).\n\nOpen this link to create your account. It is valid for {days} days and works once:\n{link}\n\nIf you did not expect this, ignore this email.',
    'mail.inviteProject.subject': 'Invitation: translate {project}',
    'mail.inviteProject.body': '{inviter} invited you to the project "{project}" as {role}{language}.\n\nOpen this link to create your account. It is valid for {days} days and works once:\n{link}\n\nIf you did not expect this, ignore this email.',
    'mail.reset.subject': 'Reset your Lexicast password',
    'mail.reset.body': 'Someone asked to reset the password of this account. Open this link within {minutes} minutes; it works once:\n{link}\n\nIf this was not you, ignore this email. Your password stays unchanged.',
    'mail.passwordChanged.subject': 'Your Lexicast password was changed',
    'mail.passwordChanged.body': 'The password of your account was just changed and all other sessions were signed out.\n\nIf this was not you, reset your password at once: {link}',
    'mail.digest.subject': 'Lexicast: news in your projects',
    'mail.digest.intro': 'Hello {name},\n\nsince the last message:\n',
    'mail.digest.suggestion_open': '- {project}: {count} new suggestion(s) to review ({languages})',
    'mail.digest.suggestion_rejected': '- {project}: {count} of your suggestion(s) were rejected. Open the project to read the reasons.',
    'mail.digest.release_published': '- {project}: release {numbers} was published',
    'mail.digest.source_changed': '- {project}: {count} translation(s) became outdated because the source text changed ({languages})',
    'mail.digest.outro': '\nOpen Lexicast: {link}\nTo stop these emails, turn off notifications in your account settings.',
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
    'role.owner': 'Owner',
    'role.reviewer': 'Prüfer',
    'role.translator': 'Übersetzer',
    'mail.invite.subject': 'Einladung zu Lexicast ({host})',
    'mail.invite.body': '{inviter} hat dich zu Lexicast ({host}) eingeladen.\n\nÖffne diesen Link, um dein Konto anzulegen. Er ist {days} Tage gültig und funktioniert nur einmal:\n{link}\n\nWenn du das nicht erwartet hast, ignoriere diese E-Mail.',
    'mail.inviteProject.subject': 'Einladung: {project} übersetzen',
    'mail.inviteProject.body': '{inviter} hat dich in das Projekt "{project}" eingeladen, als {role}{language}.\n\nÖffne diesen Link, um dein Konto anzulegen. Er ist {days} Tage gültig und funktioniert nur einmal:\n{link}\n\nWenn du das nicht erwartet hast, ignoriere diese E-Mail.',
    'mail.reset.subject': 'Lexicast-Passwort zurücksetzen',
    'mail.reset.body': 'Jemand hat darum gebeten, das Passwort dieses Kontos zurückzusetzen. Öffne diesen Link innerhalb von {minutes} Minuten; er funktioniert nur einmal:\n{link}\n\nWar das nicht deine Anfrage, ignoriere diese E-Mail. Dein Passwort bleibt unverändert.',
    'mail.passwordChanged.subject': 'Dein Lexicast-Passwort wurde geändert',
    'mail.passwordChanged.body': 'Das Passwort deines Kontos wurde gerade geändert, alle anderen Sitzungen wurden abgemeldet.\n\nWar das nicht deine Änderung, setze dein Passwort sofort zurück: {link}',
    'mail.digest.subject': 'Lexicast: Neuigkeiten in deinen Projekten',
    'mail.digest.intro': 'Hallo {name},\n\nseit der letzten Nachricht:\n',
    'mail.digest.suggestion_open': '- {project}: {count} neue(r) Vorschlag/Vorschläge zur Prüfung ({languages})',
    'mail.digest.suggestion_rejected': '- {project}: {count} deiner Vorschläge wurde(n) abgelehnt. Die Gründe stehen im Projekt.',
    'mail.digest.release_published': '- {project}: Release {numbers} wurde veröffentlicht',
    'mail.digest.source_changed': '- {project}: {count} Übersetzung(en) sind veraltet, weil sich der Quelltext geändert hat ({languages})',
    'mail.digest.outro': '\nLexicast öffnen: {link}\nUm diese E-Mails abzustellen, schalte die Benachrichtigungen in deinen Konto-Einstellungen aus.',
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
