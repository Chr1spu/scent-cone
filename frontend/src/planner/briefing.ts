/**
 * Spoken team briefings. The text is built only from the deployment results (no invented
 * content); it is spoken with Grok Voice through the server (/api/tts) when that is configured,
 * otherwise with the browser's own voice so it also works offline.
 */
import { apiBase } from '../api/server';
import type { DeploymentOut } from '../workers/protocol';

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** compass word for a bearing in degrees (0 = north, clockwise) */
const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** 17.5 -> "5:30 PM", 24 -> "midnight" (hours may run past 24 into the next day) */
export function spokenTime(t: number): string {
  const total = Math.round(t * 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  if (h24 === 0 && m === 0) return 'midnight';
  if (h24 === 12 && m === 0) return 'noon';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

function distance(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} metres`;
  return `${(m / 1000).toFixed(1)} kilometres`;
}

export interface BriefingInput {
  area: string;
  time: number;
  /** last known point, local metres (x east, y north) */
  lkp: [number, number];
  deployments: DeploymentOut[];
}

/** One paragraph per team, in the order a radio briefing would give them. */
export function briefingText({ area, time, lkp, deployments }: BriefingInput): string {
  const n = deployments.length;
  const parts = [`Scentline briefing for ${area}. ${n} ${n === 1 ? 'team' : 'teams'}, planned for ${spokenTime(time)}.`];
  for (const d of deployments) {
    const dx = d.x - lkp[0];
    const dy = d.y - lkp[1];
    const dist = Math.hypot(dx, dy);
    const where = dist < 150 ? 'at the last known point' : `${distance(dist)} ${compass((Math.atan2(dx, dy) * 180) / Math.PI)} of the last known point`;
    const heading = compass((Math.atan2(d.upwind[0], d.upwind[1]) * 180) / Math.PI);
    const pct = Math.round(d.coveredProb * 100);
    parts.push(
      `Team ${d.team}. Start ${where}. Work ${heading}, into a ${d.windSpeed.toFixed(1)} metre per second wind. ` +
        `Best window ${spokenTime(d.bestWindow[0])} to ${spokenTime(d.bestWindow[1])}. ` +
        `This start covers ${pct < 1 ? 'under 1' : pct} percent of the probability.`,
    );
  }
  parts.push('Scent conditions are modelled, not observed. Confirm the wind on site before you start.');
  return parts.join(' ');
}

// ---------------------------------------------------------------- playback

export type Voice = 'grok' | 'browser';
let current: { stop: () => void } | null = null;

export function stopBriefing() {
  current?.stop();
  current = null;
}

async function grokAudio(text: string, signal: AbortSignal): Promise<Blob | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio/')) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

/**
 * Speak `text`. Resolves with the voice used once playback starts; `onEnd` fires when it
 * finishes or is stopped. Grok Voice is tried first (8 s budget), then the browser voice.
 */
export async function speakBriefing(text: string, onEnd: () => void): Promise<Voice | null> {
  stopBriefing();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let ended = false;
  const done = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  current = { stop: () => (ctl.abort(), done()) };
  const blob = await grokAudio(text, ctl.signal);
  clearTimeout(timer);
  if (ctl.signal.aborted && !blob) {
    // stopped by the user while waiting (or timed out): fall through to the browser voice only on timeout
    if (ended) return null;
  }
  if (blob) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const finish = () => {
      URL.revokeObjectURL(url);
      done();
    };
    audio.onended = finish;
    audio.onerror = finish;
    current = { stop: () => (audio.pause(), finish()) };
    try {
      await audio.play();
      return 'grok';
    } catch {
      finish();
      return null;
    }
  }
  if (!('speechSynthesis' in window)) {
    done();
    return null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0;
  u.onend = done;
  u.onerror = done;
  current = { stop: () => (window.speechSynthesis.cancel(), done()) };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return 'browser';
}
