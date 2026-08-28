import { useEffect, useState } from 'react';
import { Headphones, RefreshCw, ChevronDown, ChevronRight, Plug } from 'lucide-react';
import * as api from '../lib/api';
import type { DiscordPublicConfig, DiscordStatus } from '../lib/api';

export function DiscordPanel() {
  const [config, setConfig] = useState<DiscordPublicConfig | null>(null);
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [clientSecretDraft, setClientSecretDraft] = useState('');
  const [botTokenDraft, setBotTokenDraft] = useState('');
  const [guilds, setGuilds] = useState<Array<{ id: string; name: string }> | null>(null);

  async function refresh() {
    try {
      const data = await api.getDiscordState();
      setConfig(data.config);
      setStatus(data.status);
      setClientIdDraft((prev) => prev || data.config.clientId);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the guild list once the connection is up so the "primary server"
  // picker has options to show. Best-effort — silence errors (e.g. no `guilds`
  // scope) since the field still accepts a hand-pasted guild id.
  useEffect(() => {
    if (status?.state !== 'connected' || guilds !== null) return;
    api.getDiscordGuilds().then(setGuilds).catch(() => setGuilds([]));
  }, [status?.state, guilds]);

  async function savePrimaryGuild(id: string) {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putDiscordConfig({
        enabled: config.enabled,
        clientId: config.clientId,
        primaryGuildId: id,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBotToken(token: string) {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putDiscordConfig({
        enabled: config.enabled,
        clientId: config.clientId,
        botToken: token,
      });
      setConfig(data.config);
      setStatus(data.status);
      setBotTokenDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearBotToken() {
    if (!config) return;
    if (!confirm('Remove the bot token? Pull-user / move-user will stop working until you paste a new one.')) return;
    setBusy(true);
    try {
      // Explicit null tells the server "clear this field" — plain "" means
      // "keep whatever was saved before" for secret-style values.
      const data = await api.putDiscordConfig({
        enabled: config.enabled,
        clientId: config.clientId,
        botToken: null,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCredentials() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.putDiscordConfig({
        enabled: true,
        clientId: clientIdDraft.trim(),
        clientSecret: clientSecretDraft.trim() || undefined,
      });
      setConfig(data.config);
      setStatus(data.status);
      setClientSecretDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.connectDiscord();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from Discord? You\'ll need to re-authorize to control voice.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectDiscord();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const data = await api.reconnectDiscord();
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putDiscordConfig({
        enabled: !config.enabled,
        clientId: config.clientId,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;
  const needsSetup = state === 'not-configured' || (state === 'needs-auth' && (!config?.clientId || !config?.hasSecret));

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 14 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', background: 'transparent', border: 0, color: '#fff',
          padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Headphones size={18} style={{ color: '#5865f2' }} />
        <strong>Discord</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.username && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.username}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Discord integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected as <code style={codeStyle}>{status?.username}</code>. Live voice state:{' '}
              <span style={{ color: status?.mute ? '#f87171' : '#22c55e' }}>{status?.mute ? 'muted' : 'unmuted'}</span>
              {' · '}
              <span style={{ color: status?.deaf ? '#f87171' : '#22c55e' }}>{status?.deaf ? 'deafened' : 'listening'}</span>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                Channel: <code style={codeStyle}>{status?.currentVoiceChannelName ?? (status?.currentVoiceChannelId ? `id ${status.currentVoiceChannelId}` : '— not in a voice channel')}</code>
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                Mode: <code style={codeStyle}>{status?.voiceMode === 'PUSH_TO_TALK' ? 'push-to-talk' : 'voice activity'}</code>
                {' · '}
                Noise suppression: <code style={codeStyle}>{status?.noiseSuppression ? 'on' : 'off'}</code>
                {' · '}
                AGC: <code style={codeStyle}>{status?.automaticGainControl ? 'on' : 'off'}</code>
                {' · '}
                Echo cancel: <code style={codeStyle}>{status?.echoCancellation ? 'on' : 'off'}</code>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>
                <div style={{ marginBottom: 4 }}>
                  <strong style={{ color: '#d1d5db', fontWeight: 500 }}>Primary server</strong> — used by "Join voice channel" pickers to default to just your server.
                </div>
                {guilds && guilds.length > 0 ? (
                  <select
                    value={config.primaryGuildId}
                    onChange={(e) => void savePrimaryGuild(e.target.value)}
                    disabled={busy}
                    style={{ ...inp, width: '100%' }}
                  >
                    <option value="">— none (falls back to current voice channel's server) —</option>
                    {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                ) : (
                  <input
                    value={config.primaryGuildId}
                    onChange={(e) => setConfig({ ...config, primaryGuildId: e.target.value.trim() })}
                    onBlur={(e) => void savePrimaryGuild(e.target.value.trim())}
                    placeholder="Discord guild (server) id — optional"
                    spellCheck={false}
                    autoCapitalize="none"
                    style={{ ...inp, width: '100%' }}
                  />
                )}
              </div>
              <details style={{ marginTop: 12, fontSize: 12, color: '#9ca3af' }}>
                <summary style={{ cursor: 'pointer', color: '#d1d5db' }}>
                  <strong style={{ fontWeight: 500 }}>Bot token</strong> — optional, powers <em>Pull member</em> / <em>Move member</em>
                  {config.hasBotToken && <span style={{ marginLeft: 6, color: '#22c55e' }}>✓ set</span>}
                </summary>
                <div style={{ marginTop: 8, lineHeight: 1.5 }}>
                  User OAuth can't move other guild members — Discord requires a bot for that. Setup is one-time:
                  <ol style={{ paddingLeft: 20, marginTop: 6, color: '#9ca3af' }}>
                    <li>Visit <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>discord.com/developers/applications</a> → your Digi Deck app.</li>
                    <li><em>Bot</em> tab → <em>Reset Token</em> (or <em>Add Bot</em> first if the tab is empty). Copy the token.</li>
                    <li><em>OAuth2</em> → <em>URL Generator</em> → check the <code style={{ ...codeStyle, fontSize: 10 }}>bot</code> scope and the <code style={{ ...codeStyle, fontSize: 10 }}>Move Members</code> permission. Open the generated URL, invite the bot to your server.</li>
                    <li>Paste the token below.</li>
                  </ol>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <input
                      type="password"
                      value={botTokenDraft}
                      onChange={(e) => setBotTokenDraft(e.target.value)}
                      placeholder={config.hasBotToken ? '(saved — leave blank to keep)' : 'MT.xxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxx'}
                      autoComplete="off"
                      spellCheck={false}
                      style={{ ...inp, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => void saveBotToken(botTokenDraft.trim())}
                      disabled={busy || !botTokenDraft.trim()}
                      style={secondaryBtn}
                    >
                      Save
                    </button>
                    {config.hasBotToken && (
                      <button
                        type="button"
                        onClick={() => void clearBotToken()}
                        disabled={busy}
                        style={dangerBtn}
                        title="Remove the stored bot token"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
                    The bot doesn't need to be online. It just needs to be a member of the guild with the Move Members permission. Discord's role hierarchy applies — the bot can only move members whose highest role is below the bot's highest role.
                  </div>
                </div>
              </details>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
              </div>
            </div>
          )}

          {(state === 'connecting' || state === 'disconnected') && (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              {state === 'connecting' ? 'Connecting to Discord IPC…' : 'Disconnected. Retrying every few seconds — is Discord running?'}
              <div style={{ marginTop: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect now</button>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div style={{ fontSize: 13, color: '#f87171' }}>
              {status?.error || 'Unknown error'}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}>Retry</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Reset</button>
              </div>
            </div>
          )}

          {state === 'needs-auth' && !needsSetup && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Credentials saved. Click below to authorize — Discord will pop a dialog inside the app asking you to approve Digi Deck.
              <div style={{ marginTop: 10 }}>
                <button onClick={connect} disabled={busy} style={primaryBtn}>
                  <Plug size={14} /> {busy ? 'Waiting for approval…' : 'Connect to Discord'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                Discord must be running. If nothing appears, switch to the Discord app to see the "Authorize this application?" dialog.
                <br />
                The dialog will list two permissions: <code style={{ ...codeStyle, fontSize: 10 }}>rpc</code> (control your voice + read voice state — mute, deafen, current channel, volumes) and <code style={{ ...codeStyle, fontSize: 10 }}>guilds</code> (list your servers so the channel picker can populate). Digi Deck never sends messages or joins guilds on your behalf.
              </div>
            </div>
          )}

          {needsSetup && (
            <details open={state === 'not-configured'} style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: Discord Developer application</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Visit <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>discord.com/developers/applications</a> → <em>New Application</em>.</li>
                <li>Under <em>OAuth2</em> → add a redirect: <code style={{ ...codeStyle, userSelect: 'all' }}>http://127.0.0.1</code> (any registered URI works — this one is fine).</li>
                <li>Copy the <strong>Application ID</strong> (Client ID) from the General Information tab.</li>
                <li>Under <em>OAuth2</em> → <em>Reset Secret</em> and copy the <strong>Client Secret</strong>.</li>
                <li>Paste both below.</li>
              </ol>

              <div style={grid}>
                <label style={lbl}>Client ID</label>
                <input
                  value={clientIdDraft}
                  onChange={(e) => setClientIdDraft(e.target.value)}
                  style={inp}
                  placeholder="e.g. 123456789012345678"
                  autoComplete="off"
                />
                <label style={lbl}>Client Secret</label>
                <input
                  type="password"
                  value={clientSecretDraft}
                  onChange={(e) => setClientSecretDraft(e.target.value)}
                  style={inp}
                  placeholder={config.hasSecret ? '(saved — leave blank to keep)' : 'paste secret from OAuth2 tab'}
                  autoComplete="off"
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={saveCredentials}
                  disabled={busy || !clientIdDraft.trim() || (!config.hasSecret && !clientSecretDraft.trim())}
                  style={primaryBtn}
                >
                  {busy ? 'Saving…' : 'Save credentials'}
                </button>
              </div>
            </details>
          )}

          {state !== 'disabled' && (
            <button
              onClick={toggleEnabled}
              disabled={busy}
              style={{
                background: 'transparent', border: 0, color: '#6b7280', cursor: 'pointer',
                padding: 0, fontSize: 11, textDecoration: 'underline', alignSelf: 'flex-start',
              }}
            >
              disable integration
            </button>
          )}

          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ connecting' },
    disconnected:     { color: '#9ca3af', label: '× disconnected' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs setup' },
    'needs-auth':     { color: '#eab308', label: '○ needs auth' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return (
    <span style={{ marginLeft: 8, fontSize: 11, color: m.color, letterSpacing: 0.5 }}>{m.label}</span>
  );
}

const grid: React.CSSProperties = {
  marginTop: 10,
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 8,
  alignItems: 'center',
};
const lbl: React.CSSProperties = { fontSize: 12, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const codeStyle: React.CSSProperties = { color: '#fff', background: '#0a0a0a', padding: '1px 6px', borderRadius: 4, fontSize: 12 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#5865f2', color: '#fff',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const dangerBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#7f1d1d', color: '#fff',
  border: 0, borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
