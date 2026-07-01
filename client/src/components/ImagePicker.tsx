import { useRef, useState } from 'react';
import { ImagePlus, X, Replace } from 'lucide-react';
import * as api from '../lib/api';
import type { ImageFit } from '../lib/types';

type Props = {
  value?: string;
  onChange: (filename: string | undefined) => void;
  /** True if at least one OTHER tile/page also references `value`.
   *  When false and the image is being removed/replaced, we offer to delete the file. */
  referencedElsewhere: boolean;
  /** When both `imageFit` and `onFitChange` are provided, a fit-mode picker
   *  (cover/fill/contain) appears under the thumbnail once an image is set. */
  imageFit?: ImageFit;
  onFitChange?: (fit: ImageFit) => void;
};

const FIT_OPTIONS: { value: ImageFit; label: string; hint: string }[] = [
  { value: 'cover',   label: 'cover',   hint: 'fill the tile, may crop edges' },
  { value: 'fill',    label: 'fill',    hint: 'stretch to fill (may distort)' },
  { value: 'contain', label: 'contain', hint: 'fit whole image, may show letterbox' },
];

export function ImagePicker({ value, onChange, referencedElsewhere, imageFit, onFitChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOrphan, setPendingOrphan] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const prev = value;
      const { filename } = await api.uploadImage(file);
      onChange(filename);
      // Same content uploaded? Same hash → same filename → no orphan.
      if (prev && prev !== filename && !referencedElsewhere) {
        setPendingOrphan(prev);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleRemove() {
    const prev = value;
    onChange(undefined);
    if (prev && !referencedElsewhere) {
      setPendingOrphan(prev);
    }
  }

  async function confirmDelete() {
    if (!pendingOrphan) return;
    try { await api.deleteImage(pendingOrphan); } catch { /* non-fatal */ }
    setPendingOrphan(null);
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      {value ? (
        <div
          style={{
            position: 'relative',
            width: 56, height: 56,
            background: '#0a0a0a',
            border: '1px solid #374151',
            borderRadius: 8,
            overflow: 'hidden',
          }}
          title={`image: ${value}`}
        >
          <img
            src={api.imageUrl(value)}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: imageFit ?? 'cover' }}
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            title="remove image"
            aria-label="remove image"
            style={iconCornerStyle('top-right')}
          >
            <X size={11} />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="replace image"
            aria-label="replace image"
            style={iconCornerStyle('bottom-right')}
          >
            <Replace size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="upload image (png, jpg, gif, webp)"
          style={{
            width: 56, height: 56,
            background: '#0a0a0a',
            border: '1px dashed #4b5563',
            borderRadius: 8,
            color: '#9ca3af',
            cursor: busy ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 2, fontSize: 9,
          }}
        >
          <ImagePlus size={18} />
          <span>image</span>
        </button>
      )}
      {value && onFitChange && (
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {FIT_OPTIONS.map((o) => {
            const active = (imageFit ?? 'cover') === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onFitChange(o.value)}
                title={o.hint}
                style={{
                  padding: '2px 6px',
                  background: active ? '#3b82f6' : '#0a0a0a',
                  border: `1px solid ${active ? '#3b82f6' : '#374151'}`,
                  borderRadius: 4,
                  color: active ? '#fff' : '#9ca3af',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {busy && <span style={{ fontSize: 9, color: '#9ca3af' }}>uploading…</span>}
      {error && <span style={{ fontSize: 9, color: '#ef4444', maxWidth: 80, textAlign: 'center' }}>{error}</span>}

      {pendingOrphan && (
        <OrphanModal
          filename={pendingOrphan}
          onKeep={() => setPendingOrphan(null)}
          onDelete={confirmDelete}
        />
      )}
    </div>
  );
}

function iconCornerStyle(corner: 'top-right' | 'bottom-right'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 18, height: 18,
    background: 'rgba(0,0,0,0.7)',
    border: '1px solid #374151',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  };
  if (corner === 'top-right') return { ...base, top: 2, right: 2 };
  return { ...base, bottom: 2, right: 2 };
}

function OrphanModal({
  filename, onKeep, onDelete,
}: {
  filename: string;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const [alsoDelete, setAlsoDelete] = useState(true);
  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onKeep(); }}
    >
      <div
        style={{
          background: '#0a0a0a',
          border: '1px solid #374151',
          borderRadius: 10,
          padding: 20,
          maxWidth: 380,
          color: '#fff',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>Image no longer used</div>
        <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
          The image <code style={{ color: '#e5e7eb' }}>{filename}</code> is no longer referenced by
          any tile or page. Delete the file from disk?
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e5e7eb', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={alsoDelete}
            onChange={(e) => setAlsoDelete(e.target.checked)}
          />
          Delete file from disk
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onKeep}
            style={{
              padding: '6px 12px',
              background: '#1f2937',
              border: '1px solid #374151',
              color: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => (alsoDelete ? onDelete() : onKeep())}
            style={{
              padding: '6px 12px',
              background: alsoDelete ? '#7f1d1d' : '#1f2937',
              border: `1px solid ${alsoDelete ? '#dc2626' : '#374151'}`,
              color: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {alsoDelete ? 'Delete file' : 'Keep file'}
          </button>
        </div>
      </div>
    </div>
  );
}
