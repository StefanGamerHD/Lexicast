import type { Config } from '../config.ts';
import { t, type Locale } from '../i18n.ts';
import { inline, type Mailer } from './mailer.ts';

export type DigestItem =
  | { kind: 'suggestion_open'; project: string; count: number; languages: string[] }
  | { kind: 'suggestion_rejected'; project: string; count: number }
  | { kind: 'release_published'; project: string; numbers: number[] }
  | { kind: 'source_changed'; project: string; count: number; languages: string[] };

// The mails of the server. Plain text only; every user-controlled value goes through inline().
export function createOutbound(mailer: Mailer, config: Pick<Config, 'baseUrl'>) {
  const host = new URL(config.baseUrl).host;
  const link = (path: string, token: string) => `${config.baseUrl}/${path}/${token}`;
  const INVITE_DAYS = 7;

  return {
    sendInvitation(o: { to: string; token: string; inviter: string; locale: Locale; project?: string; role?: string; language?: string }): Promise<void> {
      const params = { host, inviter: inline(o.inviter), days: INVITE_DAYS, link: link('invite', o.token) };
      if (o.project) {
        const role = t(o.locale, `role.${o.role ?? 'translator'}`);
        const language = o.language ? ` (${inline(o.language, 20)})` : '';
        return mailer.send({ to: o.to, subject: t(o.locale, 'mail.inviteProject.subject', { project: inline(o.project) }), text: t(o.locale, 'mail.inviteProject.body', { ...params, project: inline(o.project), role, language }) });
      }
      return mailer.send({ to: o.to, subject: t(o.locale, 'mail.invite.subject', params), text: t(o.locale, 'mail.invite.body', params) });
    },
    sendPasswordReset(o: { to: string; token: string; locale: Locale }): Promise<void> {
      return mailer.send({ to: o.to, subject: t(o.locale, 'mail.reset.subject'), text: t(o.locale, 'mail.reset.body', { minutes: 60, link: link('reset', o.token) }) });
    },
    sendPasswordChanged(o: { to: string; locale: Locale }): Promise<void> {
      return mailer.send({ to: o.to, subject: t(o.locale, 'mail.passwordChanged.subject'), text: t(o.locale, 'mail.passwordChanged.body', { link: `${config.baseUrl}/reset` }) });
    },
    sendDigest(o: { to: string; name: string; locale: Locale; items: DigestItem[] }): Promise<void> {
      const lines = o.items.map((i) => {
        const project = inline(i.project);
        switch (i.kind) {
          case 'suggestion_open': return t(o.locale, 'mail.digest.suggestion_open', { project, count: i.count, languages: i.languages.join(', ') });
          case 'suggestion_rejected': return t(o.locale, 'mail.digest.suggestion_rejected', { project, count: i.count });
          case 'release_published': return t(o.locale, 'mail.digest.release_published', { project, numbers: i.numbers.join(', ') });
          case 'source_changed': return t(o.locale, 'mail.digest.source_changed', { project, count: i.count, languages: i.languages.join(', ') });
        }
      });
      const text = t(o.locale, 'mail.digest.intro', { name: inline(o.name) }) + lines.join('\n') + '\n' + t(o.locale, 'mail.digest.outro', { link: config.baseUrl });
      return mailer.send({ to: o.to, subject: t(o.locale, 'mail.digest.subject'), text });
    },
  };
}
export type Outbound = ReturnType<typeof createOutbound>;
