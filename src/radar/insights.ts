/** Turns numeric forecasts into the plain-language lines the UI shows. */
import { NOWCAST_STEPS } from '../config';
import { compassName, compassPoint } from '../lib/geo';
import { CLASS_LABEL, CLASS_SHORT, RAIN_THRESHOLD, rateClass, type IntensityClass } from './palette';
import type { PointForecast, WindEstimate } from './types';

export type NextKind = 'start' | 'stop' | 'continue' | 'dry' | 'chance';
export type OutlookKind = 'incoming' | 'clearing' | 'persist' | 'later' | 'clear' | 'unknown';
export type Tone = 'calm' | 'watch' | 'wet';

export interface Insights {
  raining: boolean;
  cls: IntensityClass;
  title: string;
  label: string;
  rateText: string;
  tone: Tone;
  next: { kind: NextKind; minutes: number | null; prob: number; text: string; detail: string };
  outlook: { kind: OutlookKind; minutes: number | null; text: string; detail: string };
  headline: string;
}

const timeFmt = new Intl.DateTimeFormat('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' });

export function clock(epoch: number): string {
  return timeFmt.format(new Date(epoch));
}

export function duration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function rateText(rate: number): string {
  if (rate < RAIN_THRESHOLD) return '0 mm/h';
  if (rate < 1) return `${rate.toFixed(1)} mm/h`;
  return `${Math.round(rate)} mm/h`;
}

export function deriveInsights(pf: PointForecast, now = Date.now()): Insights {
  const raining = pf.nowRate >= RAIN_THRESHOLD;
  const cls = rateClass(pf.nowRate);
  // Leads are relative to the scan; convert to "minutes from now".
  const fromNow = (lead: number) => Math.max(0, (pf.issued + lead * 60_000 - now) / 60_000);
  const near = pf.steps.slice(1, NOWCAST_STEPS + 1);
  const far = pf.steps.slice(NOWCAST_STEPS + 1);
  const maxNear = Math.max(0, ...near.map((s) => s.prob));

  let next: Insights['next'];
  let outlook: Insights['outlook'];

  if (raining) {
    const stop = near.find((s) => s.prob < 0.35);
    if (stop) {
      const m = fromNow(stop.lead);
      next = {
        kind: 'stop', minutes: m, prob: 1 - stop.prob,
        text: m < 3 ? 'Easing off now' : `Easing in ~${duration(m)}`,
        detail: `Should clear around ${clock(now + m * 60_000)}.`
      };
    } else {
      next = {
        kind: 'continue', minutes: null, prob: Math.min(...near.map((s) => s.prob)),
        text: 'Rain continues for 30+ min',
        detail: 'No break expected in the next half hour.'
      };
    }
    const clear = (stop ? [] : far).find((s) => s.prob < 0.35);
    if (stop) {
      const again = pf.steps.slice(pf.steps.indexOf(stop) + 1).find((s) => s.prob >= 0.5);
      outlook = again
        ? { kind: 'incoming', minutes: fromNow(again.lead), text: `More rain around ${clock(now + fromNow(again.lead) * 60_000)}`, detail: `Another band may arrive in ~${duration(fromNow(again.lead))}.` }
        : { kind: 'clear', minutes: null, text: 'Then dry for the next few hours', detail: 'No further rain tracked on the way in.' };
    } else if (clear) {
      const m = fromNow(clear.lead);
      outlook = { kind: 'clearing', minutes: m, text: `Clearing around ${clock(now + m * 60_000)}`, detail: `Rain likely to ease in ~${duration(m)}.` };
    } else {
      outlook = { kind: 'persist', minutes: null, text: 'A prolonged wet spell', detail: 'Rain may linger for 3 hours or more.' };
    }
  } else {
    const start = near.find((s) => s.prob >= 0.5);
    if (start) {
      const m = fromNow(start.lead);
      next = {
        kind: 'start', minutes: m, prob: start.prob,
        text: m < 3 ? 'Rain arriving now' : `Rain in ~${duration(m)}`,
        detail: `${CLASS_LABEL[rateClass(start.rate)]} expected around ${clock(now + m * 60_000)}.`
      };
    } else if (maxNear >= 0.2) {
      next = {
        kind: 'chance', minutes: null, prob: maxNear,
        text: `${Math.round(maxNear * 100)}% chance of a shower`,
        detail: 'Rain is nearby — it may brush past within 30 min.'
      };
    } else {
      next = { kind: 'dry', minutes: null, prob: maxNear, text: 'Dry for the next 30 min', detail: 'No rain tracked heading your way.' };
    }

    const later = far.find((s) => s.prob >= 0.5);
    const up = pf.upstream;
    if (start) {
      outlook = { kind: 'later', minutes: null, text: 'Then watch the radar', detail: 'Showers can develop and fade quickly.' };
      const end = pf.steps.slice(pf.steps.indexOf(start) + 1).find((s) => s.prob < 0.35);
      if (end) {
        const m = fromNow(end.lead);
        outlook = { kind: 'clearing', minutes: m, text: `Passing by ${clock(now + m * 60_000)}`, detail: `Expected to last about ${duration(m - fromNow(start.lead))}.` };
      }
    } else if (later) {
      const m = fromNow(later.lead);
      outlook = {
        kind: 'incoming', minutes: m,
        text: `Rain likely around ${clock(now + m * 60_000)}`,
        detail: `Tracked rain should reach you in ~${duration(m)}${up ? `, from the ${compassName(up.bearingDeg)}` : ''}.`
      };
    } else if (up && up.etaMin !== null) {
      const m = fromNow(up.etaMin);
      outlook = {
        kind: 'incoming', minutes: m,
        text: `Rain ${Math.round(up.distanceKm)} km ${compassPoint(up.bearingDeg)}, heading your way`,
        detail: `If it holds together it could arrive in ~${duration(m)} (low confidence).`
      };
    } else if (Math.max(0, ...far.map((s) => s.prob)) >= 0.2) {
      outlook = { kind: 'later', minutes: null, text: 'Isolated showers possible later', detail: 'Low odds of rain over the next 3 hours.' };
    } else if (pf.nearest) {
      outlook = {
        kind: 'clear', minutes: null, text: 'Nothing heading your way',
        detail: `Nearest rain is ${pf.nearest.distanceKm < 10 ? pf.nearest.distanceKm.toFixed(1) : Math.round(pf.nearest.distanceKm)} km ${compassPoint(pf.nearest.bearingDeg)}, not tracking towards you.`
      };
    } else {
      outlook = { kind: 'clear', minutes: null, text: 'Clear skies on radar', detail: 'No rain anywhere within 240 km.' };
    }
  }

  const tone: Tone = raining ? 'wet' : next.kind === 'start' || next.kind === 'chance' ? 'watch' : 'calm';
  const headline = raining
    ? next.kind === 'stop' ? next.text : 'Rain overhead'
    : next.kind === 'dry' && outlook.kind === 'incoming' ? outlook.text : next.text;

  return {
    raining,
    cls,
    title: pf.clutter ? 'Dry' : CLASS_SHORT[cls],
    label: CLASS_LABEL[cls],
    rateText: rateText(pf.nowRate),
    tone,
    next,
    outlook,
    headline
  };
}

export function windDescriptor(kmh: number): string {
  if (kmh < 2) return 'Calm';
  if (kmh < 6) return 'Light air';
  if (kmh < 12) return 'Light breeze';
  if (kmh < 20) return 'Gentle breeze';
  if (kmh < 29) return 'Moderate breeze';
  if (kmh < 39) return 'Fresh breeze';
  if (kmh < 50) return 'Strong breeze';
  return 'Near gale';
}

export function confidenceLabel(c: number): string {
  return c >= 0.65 ? 'High' : c >= 0.35 ? 'Moderate' : c > 0 ? 'Low' : '—';
}

export function windSentence(w: WindEstimate): string {
  if (w.source === 'none' || w.confidence === 0) return 'Too few rain echoes to track the wind right now.';
  const dir = compassName(w.fromDeg);
  return `${windDescriptor(w.speedKmh)} from the ${dir}, steering showers ${compassName(w.fromDeg + 180)}wards.`;
}
