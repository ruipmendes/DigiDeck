import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import type { Button, Page } from '../lib/types';
import { ActionEditor } from './ActionEditor';
import { IconPicker } from './IconPicker';

type Props = {
  button: Button;
  pages: Page[];
  currentPageId: number;
  onChange: (patch: Partial<Button>) => void;
  onDelete: () => void;
  onMove: (toPageId: number) => void;
};

export function ConfigRow({ button, pages, currentPageId, onChange, onDelete, onMove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: button.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr auto auto',
        alignItems: 'start',
        gap: 12,
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 10,
        padding: 12,
      }}
    >
      <button
        {...attributes}
        {...listeners}
        style={{ background: 'transparent', border: 0, color: '#6b7280', cursor: 'grab', padding: 4, alignSelf: 'center' }}
        aria-label="drag to reorder"
      >
        <GripVertical size={18} />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <IconPicker value={button.icon} onChange={(icon) => onChange({ icon })} />
        <div style={{ fontSize: 10, color: '#6b7280' }}>id: {button.id}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={button.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label"
          style={inputStyle}
        />
        <ActionEditor action={button.action} onChange={(action) => onChange({ action })} />
      </div>

      {pages.length > 1 ? (
        <select
          value={currentPageId}
          onChange={(e) => {
            const to = Number(e.target.value);
            if (to !== currentPageId) onMove(to);
          }}
          title="move to page"
          style={{
            ...inputStyle,
            alignSelf: 'center',
            padding: '6px 8px',
            fontSize: 12,
            maxWidth: 140,
          }}
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === currentPageId ? `${p.name} (here)` : `→ ${p.name}`}
            </option>
          ))}
        </select>
      ) : (
        <span />
      )}

      <button
        onClick={onDelete}
        style={{ background: 'transparent', border: 0, color: '#9ca3af', cursor: 'pointer', padding: 4, alignSelf: 'center' }}
        aria-label="delete button"
        title="delete"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: '#0a0a0a',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 14,
};
