import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Shield, Lock, Download, Check } from 'lucide-react';
import * as api from '../lib/api';

/**
 * The Security panel keeps two toggles as first-class controls and pushes all
 * per-device install prose behind a disclosure — first-time users see two
 * checkboxes with one-line descriptions and can safely ignore the rest.
 */
export function SecurityPanel() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<api.SecurityConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trustInstalled, setTrustInstalled] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getSecurityConfig()
      .then((c) => { if (alive) setCfg(c); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []);

  async function toggleShell() {
    if (!cfg) return;
    setBusy(true); setError(null);
    try {
      const c = await api.putSecurityConfig({ allowShellActions: !cfg.allowShellActions });
      setCfg(c);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function installTrust() {
    setBusy(true); setError(null);
    try {
      await api.installCertTrust();
      setTrustInstalled(true);
      setTimeout(() => setTrustInstalled(false), 4000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleHttps() {
    if (!cfg) return;
    const next = !cfg.httpsEnabled;
    if (next && !confirm(
      'Enable HTTPS?\n\n' +
      'After restart: phones re-pair via new https:// QR, browsers show a one-time cert warning per device, and any Twitch or Kick OAuth apps need the https:// redirect URI added.'
    )) return;
    if (!next && !confirm('Disable HTTPS? Phones will need to re-pair over http://.')) return;
    setBusy(true); setError(null);
    try {
      const c = await api.putSecurityConfig({ httpsEnabled: next });
      setCfg(c);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const shellOn = !!cfg?.allowShellActions;
  const httpsOn = !!cfg?.httpsEnabled;

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          background: 'transparent',
          border: 0,
          color: '#fff',
          cursor: 'pointer',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Shield size={16} />
        <strong style={{ fontSize: 14 }}>Security</strong>
        <span style={{ marginLeft: 12, fontSize: 12, color: '#9ca3af', display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusPill label="shell" on={shellOn} loading={cfg === null} />
          <StatusPill label="https" on={httpsOn} loading={cfg === null} />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px 40px', color: '#d1d5db', fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Defaults are fine for most setups. Change these only if you understand what each does.
          </div>

          <ToggleRow
            label="Allow shell actions"
            hint="Off = Launch and Run-PowerShell tiles refuse to fire."
            checked={shellOn}
            disabled={busy || cfg === null}
            onChange={toggleShell}
          />

          <div>
            <ToggleRow
              label="Encrypt traffic (HTTPS)"
              hint={httpsOn
                ? 'Enabled. Server listens over TLS; phones must be paired via https://.'
                : 'Off. Enabling generates a self-signed cert and requires re-pairing phones.'}
              checked={httpsOn}
              disabled={busy || cfg === null}
              onChange={toggleHttps}
              iconRight={<Lock size={12} />}
            />

            {httpsOn && (
              <div style={{ marginTop: 10, marginLeft: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={installTrust}
                    disabled={busy}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      background: trustInstalled ? '#0f2419' : '#3b82f6',
                      border: `1px solid ${trustInstalled ? '#166534' : '#3b82f6'}`,
                      borderRadius: 6,
                      color: trustInstalled ? '#22c55e' : '#fff',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                    title="Adds the self-signed cert to your CurrentUser Trusted Root store."
                  >
                    {trustInstalled
                      ? <><Check size={12} /> Installed — restart Chrome / Edge</>
                      : <><Lock size={12} /> Trust for Chrome / Edge</>}
                  </button>
                  <a
                    href={api.certDownloadUrl()}
                    download="digi-deck.crt"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      background: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: 6,
                      color: '#e5e7eb',
                      fontSize: 12,
                      textDecoration: 'none',
                    }}
                    title="Save the .crt to install on phones."
                  >
                    <Download size={12} /> Download cert
                  </a>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  <strong style={{ color: '#e5e7eb' }}>Simplest phone setup:</strong> just accept the browser's "not private" warning once per device — tap <em>Advanced</em> → <em>Proceed anyway</em> in Chrome / Safari. That's a per-site exception, same idea as Firefox's on desktop, and it works even on Androids that hide CA-cert install.
                </div>
                <details style={{ fontSize: 12, color: '#9ca3af' }}>
                  <summary style={{ cursor: 'pointer', color: '#9ca3af', userSelect: 'none' }}>
                    Prefer no warning at all? Full trust setup per device
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, borderLeft: '2px solid #1f2937' }}>
                    <span><strong style={{ color: '#e5e7eb' }}>Android:</strong> the OS <em>Install a certificate</em> flow is fussy — direct file taps often land on the wrong picker ("private key required"). Reliable path: Settings → Security → Encryption &amp; credentials → <em>Install a certificate</em> → <em>CA certificate</em> → pick <code style={{ color: '#e5e7eb' }}>digi-deck.crt</code>. If the "CA certificate" option isn't visible on your device, the browser-exception path above is your best bet.</span>
                    <span><strong style={{ color: '#e5e7eb' }}>iOS:</strong> download in Safari → Settings shows "Profile Downloaded" → Install → then Settings → General → About → <em>Certificate Trust Settings</em> → toggle Digi Deck on.</span>
                    <span><strong style={{ color: '#e5e7eb' }}>Firefox:</strong> uses its own cert store. Either keep the exception you already added, or <code style={{ color: '#e5e7eb' }}>about:config</code> → <code style={{ color: '#e5e7eb' }}>security.enterprise_roots.enabled</code> = <code style={{ color: '#e5e7eb' }}>true</code> to trust the Windows store.</span>
                    <span><strong style={{ color: '#e5e7eb' }}>Twitch / Kick OAuth:</strong> add <code style={{ color: '#e5e7eb' }}>https://localhost:8765/api/integrations/&lt;twitch|kick&gt;/callback</code> to your app's redirect URIs before re-authorizing.</span>
                  </div>
                </details>
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, on, loading }: { label: string; on: boolean; loading: boolean }) {
  const color = loading ? '#4b5563' : on ? '#22c55e' : '#4b5563';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ color: '#9ca3af' }}>{label}</span>
    </span>
  );
}

function ToggleRow({
  label, hint, checked, disabled, onChange, iconRight,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  iconRight?: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        cursor: disabled ? 'default' : 'pointer',
        padding: '10px 12px',
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 8,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ transform: 'scale(1.15)', marginTop: 2, accentColor: '#3b82f6' }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: '#e5e7eb', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {label}{iconRight}
        </span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{hint}</span>
      </span>
    </label>
  );
}
