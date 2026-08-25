/**
 * Client-side interpolator for dynamic tile labels.
 *
 * Recognised template variables:
 *   {obs.recordingTime}   → "01:23:45" or empty when not recording
 *   {obs.streamingTime}   → same shape for streaming
 *   {obs.droppedFrames}   → number as string
 *   {obs.currentScene}    → active OBS scene name
 *   {discord.channel}     → current voice channel name (or empty)
 *   {discord.mute}        → "muted" while self-muted, else empty
 *   {discord.deaf}        → "deafened" while self-deafened, else empty
 *
 * Anything else is left as-is (`{foo.bar}` stays visible so misspellings are
 * obvious rather than silently blank). The renderer is called at every tile
 * paint and again on every local tick — server broadcasts refresh the seed
 * values, but the seconds counter ticks locally.
 */
import type { LiveMeta } from '../ws';

export function renderLabel(label: string, meta: LiveMeta, nowMs: number = Date.now()): string {
  if (!label || !label.includes('{')) return label;
  return label.replace(/\{([a-z]+)\.([a-zA-Z]+)\}/g, (raw, ns, key) => {
    if (ns === 'obs' && meta.obs) {
      const o = meta.obs;
      if (key === 'recordingTime') return o.recordingStartedAtMs ? formatDuration(nowMs - o.recordingStartedAtMs) : '';
      if (key === 'streamingTime') return o.streamingStartedAtMs ? formatDuration(nowMs - o.streamingStartedAtMs) : '';
      if (key === 'droppedFrames') return String(o.droppedFrames ?? 0);
      if (key === 'currentScene') return o.currentScene ?? '';
    }
    if (ns === 'discord' && meta.discord) {
      const d = meta.discord;
      if (key === 'channel') return d.currentVoiceChannelName ?? '';
      if (key === 'mute')    return d.mute ? 'muted' : '';
      if (key === 'deaf')    return d.deaf ? 'deafened' : '';
    }
    return raw;
  });
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** True when the label contains any `{ns.key}` sequence — used by tile views
 *  to decide whether to run a local re-render tick (avoids setting up a
 *  useEffect just to re-render a static "Copy" label). */
export function isDynamicLabel(label: string): boolean {
  return /\{[a-z]+\.[a-zA-Z]+\}/.test(label);
}
