import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Layout } from './layout.js';
import type { LayoutBundle } from './layout-bundle.js';
import { importBundle } from './layout-bundle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dev (tsx) we resolve relative to src/; in build (dist/), templates ship alongside the JS.
const TEMPLATE_DIRS = [
  resolve(__dirname, 'templates'),
  resolve(__dirname, '../src/templates'),
];

export type TemplateMeta = {
  name: string;
  title: string;
  description: string;
};

type TemplateFile = LayoutBundle & {
  title?: string;
  description?: string;
};

/** Find a readable templates dir; first existing one wins. */
async function templateDir(): Promise<string> {
  for (const dir of TEMPLATE_DIRS) {
    try { await fs.access(dir); return dir; } catch { /* keep looking */ }
  }
  throw new Error('no templates directory found');
}

export async function listTemplates(): Promise<TemplateMeta[]> {
  let dir: string;
  try { dir = await templateDir(); } catch { return []; }
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: TemplateMeta[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(join(dir, f), 'utf8');
      const parsed = JSON.parse(raw) as TemplateFile;
      const name = f.replace(/\.json$/, '');
      out.push({
        name,
        title: parsed.title ?? name,
        description: parsed.description ?? '',
      });
    } catch (err) {
      console.warn(`[templates] failed to load ${f}: ${(err as Error).message}`);
    }
  }
  return out;
}

export async function loadTemplate(name: string): Promise<TemplateFile> {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('invalid template name');
  const dir = await templateDir();
  const raw = await fs.readFile(join(dir, `${name}.json`), 'utf8');
  return JSON.parse(raw) as TemplateFile;
}

/**
 * Apply a template bundle as the layout we ship to clients via the broadcast helper.
 * The bundle's images are written to disk (deduped by content hash), and the layout
 * is validated. Returns the validated layout for the caller to set as preview / save.
 */
export async function materializeTemplate(bundle: unknown): Promise<Layout> {
  return importBundle(bundle);
}

// ─── Preview state ────────────────────────────────────────────────

type PreviewState = {
  layout: Layout;
  name: string;
  title: string;
  lastHeartbeat: number;
};

let preview: PreviewState | null = null;
let onChange: (() => void) | null = null;

export function setPreviewListener(cb: () => void): void { onChange = cb; }

export function getPreview(): PreviewState | null { return preview; }

export function isPreviewing(): boolean { return preview !== null; }

export function previewInfo(): { name: string; title: string } | null {
  return preview ? { name: preview.name, title: preview.title } : null;
}

export function startPreview(name: string, title: string, layout: Layout): void {
  preview = { name, title, layout, lastHeartbeat: Date.now() };
  onChange?.();
}

export function heartbeatPreview(): boolean {
  if (!preview) return false;
  preview.lastHeartbeat = Date.now();
  return true;
}

export function clearPreview(): boolean {
  if (!preview) return false;
  preview = null;
  onChange?.();
  return true;
}

/** Take the previewed layout, clearing the preview slot. Caller saves it. */
export function consumePreview(): Layout | null {
  if (!preview) return null;
  const out = preview.layout;
  preview = null;
  onChange?.();
  return out;
}

/**
 * Start a periodic check that clears preview state if no heartbeat
 * has been received recently. Returns a stop function.
 */
const PREVIEW_TIMEOUT_MS = 30_000;
const PREVIEW_TICK_MS = 5_000;

export function startPreviewWatchdog(): () => void {
  const t = setInterval(() => {
    if (!preview) return;
    if (Date.now() - preview.lastHeartbeat > PREVIEW_TIMEOUT_MS) {
      console.log('[preview] heartbeat timeout, reverting');
      clearPreview();
    }
  }, PREVIEW_TICK_MS);
  return () => clearInterval(t);
}
