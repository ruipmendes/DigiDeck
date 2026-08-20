#!/usr/bin/env node
/**
 * Scaffold a new Digi Deck integration.
 *
 *   node scripts/scaffold-integration.mjs <name> [--oauth] [--display "Nice Name"]
 *
 * Creates server/src/integrations/<name>.ts with a working stub that already
 * compiles and registers via the central integration registry. Also patches
 * config.ts (adds the field + default) and index.ts (adds the getter call)
 * using the `scaffold-integration:` sentinel comments those files carry.
 *
 * After running, the routes /api/integrations/<name>/{,config,reconnect,...}
 * are live from the moment the server rebuilds — you fill in the protocol
 * logic in the marked TODO blocks.
 *
 * Client-side scaffolding (Panel, api helpers, IntegrationsPanel wiring,
 * ActionEditor entry) is still manual — see CONTRIBUTING.md for the checklist.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = path.join(REPO_ROOT, 'server', 'src');
const INTEGRATIONS_DIR = path.join(SERVER_SRC, 'integrations');
const CONFIG_FILE = path.join(SERVER_SRC, 'config.ts');
const INDEX_FILE = path.join(SERVER_SRC, 'index.ts');

// ── argv parsing ──────────────────────────────────────────────

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('Usage: node scripts/scaffold-integration.mjs <name> [--oauth] [--display "Display Name"]');
  console.error('  name       kebab-case identifier, matches the config key and API path segment');
  console.error('  --oauth    scaffold OAuth (authorize + callback + disconnect) stubs');
  console.error('  --display  human-facing display name (defaults to PascalCased <name>)');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { name: null, oauth: false, display: null };
  const rest = argv.slice(2);
  while (rest.length) {
    const a = rest.shift();
    if (a === '--oauth') out.oauth = true;
    else if (a === '--display' || a === '--display-name') out.display = rest.shift();
    else if (a === '-h' || a === '--help') usage();
    else if (!out.name && !a.startsWith('-')) out.name = a;
    else usage(`unexpected arg: ${a}`);
  }
  return out;
}

// ── casing helpers ────────────────────────────────────────────

const pascal = (s) => s.split(/[-_]/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const upperSnake = (s) => s.toUpperCase().replace(/-/g, '_');

// ── template ──────────────────────────────────────────────────

function template({ name, Name, UPPER, display, oauth }) {
  const oauthImports = oauth ? ', type CallbackOutcome' : '';
  const oauthBlock = oauth ? `

  // ─── OAuth ─────────────────────────────────────────────────
  //
  // Digi Deck's auto-router calls these three methods when the integration
  // manifest sets hasOAuth: true. Fill them in with the protocol specifics.

  buildAuthorizeUrl(): string {
    if (!this.cfg.clientId || !this.cfg.clientSecret) throw new Error('${display} Client ID + Secret required');
    // TODO: build the provider's authorize URL. State token in this.pendingStates
    // for CSRF protection is the pattern used by twitch.ts / kick.ts.
    throw new Error('TODO: buildAuthorizeUrl not implemented');
  }

  async handleCallback(code: string, state: string): Promise<CallbackOutcome> {
    // TODO: exchange \`code\` for tokens (verify \`state\` first), persist via
    // this.persistCfg(), then return a success message for the callback HTML page.
    void code; void state;
    throw new Error('TODO: handleCallback not implemented');
  }

  async disconnectIntegration(): Promise<void> {
    // TODO: clear refresh tokens + any cached identity, then persist.
    this.cfg.refreshToken = '';
    await this.persistCfg();
    this.emitChange();
  }

  private async persistCfg(): Promise<void> {
    if (this.serverConfig) this.serverConfig.integrations.${name} = { ...this.cfg };
    if (this.saveFn) await this.saveFn();
  }
` : '';

  const oauthCfgFields = oauth ? `
  clientId: string;
  clientSecret: string;
  refreshToken: string;` : '';

  const oauthCfgDefaults = oauth ? `
  clientId: '',
  clientSecret: '',
  refreshToken: '',` : '';

  const oauthPubFields = oauth ? `
  clientId: string;
  hasSecret: boolean;
  hasRefreshToken: boolean;` : '';

  const oauthPubValues = oauth ? `
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,` : '';

  const oauthValidatedFields = oauth ? `
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    refreshToken: existing.refreshToken,` : '';

  const oauthUnusedExistingHack = oauth ? '' : ' _existing:';
  const existingArgName = oauth ? 'existing' : '_existing';

  return `import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest${oauthImports} } from './base.js';

// ─── Config ────────────────────────────────────────────────

export type ${Name}Config = {
  enabled: boolean;${oauthCfgFields}
  // TODO: add integration-specific fields (host, port, apiKey, etc.)
};

export const DEFAULT_${UPPER}_CONFIG: ${Name}Config = {
  enabled: false,${oauthCfgDefaults}
};

// ─── Public config (redact secrets in API responses) ───────

export type Public${Name}Config = {
  enabled: boolean;${oauthPubFields}
};

export function public${Name}Config(cfg: ${Name}Config): Public${Name}Config {
  return {
    enabled: cfg.enabled,${oauthPubValues}
  };
}

// ─── Incoming config validation ────────────────────────────

export function validate${Name}Config(input: unknown, ${existingArgName}: ${Name}Config): ${Name}Config {
  if (!input || typeof input !== 'object') throw new Error('invalid ${display} config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,${oauthValidatedFields}
    // TODO: validate + coerce remaining fields
  };
}

// ─── Status ────────────────────────────────────────────────

export type ${Name}State = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ${Name}Status = {
  state: ${Name}State;
  error?: string;
  // TODO: add integration-specific status fields
};

// ─── Manifest ──────────────────────────────────────────────

export const ${UPPER}_MANIFEST: IntegrationManifest = {
  name: '${name}',
  displayName: '${display}',
  actionTypes: [], // TODO: add action \`type\` strings this integration owns
  hasOAuth: ${oauth},
};

// ─── Client ────────────────────────────────────────────────

class ${Name}Client implements IntegrationLifecycle {
  readonly manifest = ${UPPER}_MANIFEST;

  private cfg: ${Name}Config = { ...DEFAULT_${UPPER}_CONFIG };
  private state: ${Name}State = 'disabled';
  private err: string | undefined;
  private onChangeCb: (() => void) | null = null;
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;${oauth ? `
  private pendingStates = new Map<string, number>();` : ''}

  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.${name}); }

  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
  }

  onChange(cb: () => void): void { this.onChangeCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }

  publicConfig(): Public${Name}Config { return public${Name}Config(this.cfg); }

  status(): ${Name}Status {
    return {
      state: this.state,
      error: this.state === 'error' ? this.err : undefined,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validate${Name}Config(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('${display} integration not attached');
    this.serverConfig.integrations.${name} = validated;
    await this.saveFn();
    this.setConfig(validated);
    await this.restart();
  }

  setConfig(cfg: ${Name}Config): void {
    this.cfg = { ...cfg };
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) {
      this.state = 'disabled';
      this.emitChange();
      return;
    }
    // TODO: connect to the ${display} service. Set this.state = 'connected' on
    // success or this.state = 'error' + this.err = <message> on failure.
    this.state = 'connecting';
    this.emitChange();
  }

  async stop(): Promise<void> {
    this.state = 'disabled';
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }${oauthBlock}

  // TODO: additional integration-specific methods (execute, etc.) go here.
  // Wire them into server/src/actions/types.ts once you add an action type
  // owned by this integration.
}

// ─── Singleton + registration ──────────────────────────────

let _instance: ${Name}Client | null = null;
export function get${Name}(): ${Name}Client {
  if (!_instance) {
    _instance = new ${Name}Client();
    registerIntegration(_instance);
  }
  return _instance;
}
`;
}

// ── file patching ─────────────────────────────────────────────

const CONFIG_SENTINELS = {
  imports:  '// scaffold-integration: additional imports inserted above this line',
  fields:   '// scaffold-integration: additional fields inserted above this line',
  defaults: '// scaffold-integration: additional defaults inserted above this line',
};

const INDEX_SENTINELS = {
  imports:    '// scaffold-integration: additional integration imports inserted above this line',
  singletons: '// scaffold-integration: additional singleton calls inserted above this line',
};

async function insertBefore(filePath, sentinel, lineToInsert) {
  const src = await fs.readFile(filePath, 'utf8');
  const idx = src.indexOf(sentinel);
  if (idx === -1) throw new Error(`sentinel not found in ${filePath}: "${sentinel}"`);
  // Find the start of the line the sentinel sits on so we insert BEFORE that line.
  const lineStart = src.lastIndexOf('\n', idx) + 1;
  // Match the indentation of the sentinel line so the inserted line lines up.
  const indentMatch = /^(\s*)/.exec(src.slice(lineStart, idx));
  const indent = indentMatch ? indentMatch[1] : '';
  if (src.includes(indent + lineToInsert)) {
    // Already inserted — idempotent no-op.
    return false;
  }
  const before = src.slice(0, lineStart);
  const after = src.slice(lineStart);
  await fs.writeFile(filePath, before + indent + lineToInsert + '\n' + after, 'utf8');
  return true;
}

async function patchConfig({ name, Name, UPPER }) {
  const ok1 = await insertBefore(CONFIG_FILE, CONFIG_SENTINELS.imports,
    `import { DEFAULT_${UPPER}_CONFIG, type ${Name}Config } from './integrations/${name}.js';`);
  const ok2 = await insertBefore(CONFIG_FILE, CONFIG_SENTINELS.fields,
    `${name}: ${Name}Config;`);
  const ok3 = await insertBefore(CONFIG_FILE, CONFIG_SENTINELS.defaults,
    `${name}: { ...DEFAULT_${UPPER}_CONFIG, ...parsed?.integrations?.${name} },`);
  return { imports: ok1, fields: ok2, defaults: ok3 };
}

async function patchIndex({ name, Name }) {
  const ok1 = await insertBefore(INDEX_FILE, INDEX_SENTINELS.imports,
    `import { get${Name} } from './integrations/${name}.js';`);
  const ok2 = await insertBefore(INDEX_FILE, INDEX_SENTINELS.singletons,
    `const ${name} = get${Name}();`);
  return { imports: ok1, singletons: ok2 };
}

// ── main ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) usage('name is required');
  const name = args.name.toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) usage(`invalid name "${name}" — use kebab-case (letters, digits, hyphens; must start with a letter)`);
  if (['obs', 'streamlabs', 'twitch', 'kick', 'base'].includes(name)) usage(`"${name}" is reserved`);

  const Name = pascal(name);
  const UPPER = upperSnake(name);
  const display = args.display || Name;
  const oauth = args.oauth;

  const target = path.join(INTEGRATIONS_DIR, `${name}.ts`);
  try {
    await fs.access(target);
    console.error(`error: ${path.relative(REPO_ROOT, target)} already exists — pick a different name or delete it first`);
    process.exit(1);
  } catch { /* file does not exist — good */ }

  await fs.writeFile(target, template({ name, Name, UPPER, display, oauth }), 'utf8');
  const configPatch = await patchConfig({ name, Name, UPPER });
  const indexPatch = await patchIndex({ name, Name });

  const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

  console.log('');
  console.log(`  ✓ ${rel(target)}`);
  console.log(`  ✓ ${rel(CONFIG_FILE)} — added import, field, and default (imports=${configPatch.imports}, fields=${configPatch.fields}, defaults=${configPatch.defaults})`);
  console.log(`  ✓ ${rel(INDEX_FILE)} — added import and singleton call (imports=${indexPatch.imports}, singletons=${indexPatch.singletons})`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Fill in the TODO blocks in ${rel(target)}`);
  console.log(`  2. If this integration adds action types, register them in server/src/actions/types.ts and dispatch them in executeStep().`);
  console.log(`  3. Client side (still manual): add a ${Name}Panel.tsx, wire it into IntegrationsPanel, add API helpers, add the action type to lib/types.ts + ActionEditor.tsx.`);
  console.log(`  4. Restart the server — /api/integrations/${name}/{,config,reconnect${oauth ? ',authorize,callback,disconnect' : ''}} routes are live.`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
