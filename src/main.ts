import './styles/index.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';

const app = new App();
app.start().catch((err) => {
  console.error(err);
  document.getElementById('splash')?.classList.add('is-done');
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
