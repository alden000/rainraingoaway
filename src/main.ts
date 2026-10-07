import './styles/index.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { watchForUpdates } from './lib/updates';

const app = new App();
// Opt-in handle for debugging/tests: add ?debug to the URL.
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __rainrain: App }).__rainrain = app;
app.start().catch((err) => {
  console.error(err);
  document.getElementById('splash')?.classList.add('is-done');
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
if (import.meta.env.PROD) watchForUpdates();
