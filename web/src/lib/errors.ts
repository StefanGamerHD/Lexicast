import { ApiError } from './api.ts';
import { hasText, t } from './i18n.svelte.ts';

// Server messages are English and technical; show our own text per error code.
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'internal';
  return hasText(`error.${code}`) ? t(`error.${code}`) : t('error.generic', { code });
}
