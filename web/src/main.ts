import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { i18n } from './lib/i18n.svelte.ts';
import { startRouter } from './lib/router.svelte.ts';
import { applyTheme, loadSession, session } from './lib/session.svelte.ts';

applyTheme(session.theme);
document.documentElement.lang = i18n.locale;
startRouter();
void loadSession();
mount(App, { target: document.getElementById('app')! });
