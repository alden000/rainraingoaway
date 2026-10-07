/**
 * Tactile feedback across platforms.
 *  - Android / Chromium: Vibration API with tuned micro-patterns.
 *  - iOS Safari 18+: toggling a native <input type="checkbox" switch> fires
 *    the system "selection" haptic — we keep a hidden one and click it.
 *  - Optional sound: a synthesised, ultra-short "tick" via WebAudio.
 */

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 18,
  heavy: 30,
  success: [12, 60, 18],
  warning: [20, 80, 20],
  error: [30, 60, 30, 60, 30]
};

let enabled = true;
let soundOn = false;
let iosLabel: HTMLLabelElement | null = null;
let audio: AudioContext | null = null;

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

function ensureIOSSwitch() {
  if (iosLabel || !isIOS) return;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  iosLabel = label;
}

function tick(kind: HapticKind) {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const freq = kind === 'heavy' || kind === 'error' ? 140 : kind === 'success' ? 880 : kind === 'medium' ? 320 : 520;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.04);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === 'selection' ? 0.03 : 0.06, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch {
    /* audio unavailable */
  }
}

export function haptic(kind: HapticKind = 'light'): void {
  if (soundOn) tick(kind);
  if (!enabled) return;
  // Browsers only allow haptics after the user has interacted with the page.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  if (canVibrate) {
    try {
      navigator.vibrate(PATTERNS[kind]);
      return;
    } catch {
      /* ignore */
    }
  }
  if (isIOS) {
    ensureIOSSwitch();
    iosLabel?.click();
    if (kind === 'success' || kind === 'warning' || kind === 'error' || kind === 'heavy') {
      setTimeout(() => iosLabel?.click(), 90);
    }
  }
}

export function configureHaptics(opts: { haptics: boolean; sound: boolean }): void {
  enabled = opts.haptics;
  soundOn = opts.sound;
}

/**
 * Wire up press feedback for every element marked [data-press] (or buttons):
 * a springy scale-down on pointerdown plus a haptic tap.
 */
export function installPressFeedback(root: HTMLElement = document.body): void {
  const sel = 'button, [data-press], .chip, a.btn';
  root.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (!el || el.hasAttribute('disabled')) return;
      el.classList.add('is-pressed');
      const kind = (el.dataset.haptic as HapticKind) || 'light';
      haptic(kind);
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--press-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--press-y', `${e.clientY - rect.top}px`);
      const release = () => {
        el.classList.remove('is-pressed');
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    },
    { passive: true }
  );
}
