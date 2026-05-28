import { useEffect, useState } from 'react';
import { X, Eye, LayoutGrid } from 'lucide-react';
import * as api from '../lib/api';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after a preview has been successfully started. */
  onPreviewStarted: () => void;
};

export function TemplatesPanel({ open, onClose, onPreviewStarted }: Props) {
  const [items, setItems] = useState<api.TemplateMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.listTemplates()
      .then((d) => setItems(d.templates))
      .catch((e) => setError((e as Error).message));
  }, [open]);

  async function startPreview(name: string, title: string) {
    setBusy(name);
    setError(null);
    try {
      const bundle = await api.getTemplate(name);
      await api.startTemplatePreview(name, title, bundle);
      onPreviewStarted();
      onClose();
      // Drop into the grid view so the user immediately sees what the template looks like.
      // Apply / Exit live in the grid banner.
      window.location.href = '/';
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#0a0a0a',
          border: '1px solid #374151',
          borderRadius: 12,
          maxWidth: 640,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#fff',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #1f2937',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutGrid size={18} />
            <strong style={{ fontSize: 16 }}>Templates</strong>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              background: 'transparent', border: 0, color: '#9ca3af',
              cursor: 'pointer', padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
            Pick a template to preview on the phone (and PC preview). Your current layout is untouched
            until you click <strong>Apply</strong>. Tap <strong>Exit</strong> to go back.
          </p>

          {error && (
            <div style={{ background: '#7f1d1d', color: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          {items === null && !error && (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading templates…</div>
          )}

          {items && items.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No templates available.</div>
          )}

          {items && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((t) => (
                <div
                  key={t.name}
                  style={{
                    background: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>{t.description}</div>
                  </div>
                  <button
                    onClick={() => startPreview(t.name, t.title)}
                    disabled={busy !== null}
                    style={{
                      padding: '8px 14px',
                      background: busy === t.name ? '#374151' : '#3b82f6',
                      color: '#fff',
                      border: 0,
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busy ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <Eye size={14} /> {busy === t.name ? 'Loading…' : 'Preview'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
