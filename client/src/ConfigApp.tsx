import { useEffect, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { Smartphone, Plus, Trash2, Download, Upload, LayoutGrid } from 'lucide-react';
import * as api from './lib/api';
import type { Tile, Layout, Page, TileKind } from './lib/types';
import { defaultTile, nextButtonId, nextPageId } from './lib/types';
import { ConfigRow } from './components/ConfigRow';
import { PairingModal } from './components/PairingModal';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { IconPicker } from './components/IconPicker';
import { ImagePicker } from './components/ImagePicker';
import { TemplatesPanel } from './components/TemplatesPanel';
import { PreviewBanner, usePreviewHeartbeat } from './components/PreviewBanner';
import { getIcon } from './lib/icons';

export function ConfigApp() {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [preview, setPreview] = useState<api.PreviewInfo | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Pick up any preview that's already active when this tab opens.
  useEffect(() => {
    let alive = true;
    api.listTemplates()
      .then((d) => { if (alive) setPreview(d.preview); })
      .catch(() => { /* harmless */ });
    return () => { alive = false; };
  }, []);

  usePreviewHeartbeat(!!preview);

  async function refreshLayoutFromServer() {
    const next = await api.getLayout();
    setLayout(next);
    setActivePageId(next.pages[0]?.id ?? null);
    setDirty(false);
    setSavedAt(new Date());
  }

  async function handleExitPreview() {
    setError(null);
    try {
      await api.exitPreview();
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleApplyPreview() {
    setError(null);
    try {
      await api.applyPreview();
      setPreview(null);
      await refreshLayoutFromServer();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleExport() {
    setError(null);
    try {
      await api.exportLayoutBundle();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleImportFile(file: File) {
    setError(null);
    if (dirty && !confirm('You have unsaved changes. Importing will replace the current layout. Continue?')) return;
    if (!confirm(`Replace the entire layout with the contents of "${file.name}"?`)) return;
    try {
      const next = await api.importLayoutBundle(file);
      setLayout(next);
      setActivePageId(next.pages[0]?.id ?? null);
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    document.title = 'Digi Deck — Config';
  }, []);

  useEffect(() => {
    api.getLayout()
      .then((l) => {
        setLayout(l);
        setActivePageId(l.pages[0]?.id ?? null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  // Keep activePageId valid when pages change
  useEffect(() => {
    if (!layout) return;
    if (activePageId === null || !layout.pages.find((p) => p.id === activePageId)) {
      setActivePageId(layout.pages[0]?.id ?? null);
    }
  }, [layout, activePageId]);

  const activePage = layout?.pages.find((p) => p.id === activePageId) ?? null;

  function updateLayout(next: Layout) {
    setLayout(next);
    setDirty(true);
  }

  function updatePage(id: number, patch: Partial<Page>) {
    if (!layout) return;
    updateLayout({
      pages: layout.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }

  function addPage() {
    if (!layout) return;
    const id = nextPageId(layout);
    updateLayout({ pages: [...layout.pages, { id, name: 'New page', buttons: [] }] });
    setActivePageId(id);
  }

  function deletePage(id: number) {
    if (!layout) return;
    if (layout.pages.length <= 1) return;
    const page = layout.pages.find((p) => p.id === id);
    const buttonCount = page?.buttons.length ?? 0;
    const msg = buttonCount > 0
      ? `Delete page "${page?.name}" and its ${buttonCount} button${buttonCount === 1 ? '' : 's'}?`
      : `Delete page "${page?.name}"?`;
    if (!confirm(msg)) return;
    const remaining = layout.pages.filter((p) => p.id !== id);
    updateLayout({ pages: remaining });
    if (activePageId === id) setActivePageId(remaining[0]?.id ?? null);
  }

  function updateButton(pageId: number, buttonId: number, patch: Partial<Tile>) {
    if (!layout) return;
    updateLayout({
      pages: layout.pages.map((p) => (p.id === pageId ? {
        ...p,
        buttons: p.buttons.map((b) => (b.id === buttonId ? ({ ...b, ...patch } as Tile) : b)),
      } : p)),
    });
  }

  function deleteButton(pageId: number, buttonId: number) {
    if (!layout) return;
    updateLayout({
      pages: layout.pages.map((p) => (p.id === pageId ? {
        ...p,
        buttons: p.buttons.filter((b) => b.id !== buttonId),
      } : p)),
    });
  }

  function addButton(pageId: number, kind: TileKind = 'button') {
    if (!layout) return;
    const id = nextButtonId(layout);
    const newTile: Tile = defaultTile(kind, id);
    updateLayout({
      pages: layout.pages.map((p) => (p.id === pageId ? {
        ...p,
        buttons: [...p.buttons, newTile],
      } : p)),
    });
  }

  function moveButton(buttonId: number, fromPageId: number, toPageId: number) {
    if (!layout || fromPageId === toPageId) return;
    const fromPage = layout.pages.find((p) => p.id === fromPageId);
    const btn = fromPage?.buttons.find((b) => b.id === buttonId);
    if (!btn) return;
    updateLayout({
      pages: layout.pages.map((p) => {
        if (p.id === fromPageId) return { ...p, buttons: p.buttons.filter((b) => b.id !== buttonId) };
        if (p.id === toPageId) return { ...p, buttons: [...p.buttons, btn] };
        return p;
      }),
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!layout || !activePage) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = activePage.buttons.findIndex((b) => b.id === active.id);
    const newIndex = activePage.buttons.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(activePage.buttons, oldIndex, newIndex);
    updateLayout({
      pages: layout.pages.map((p) => (p.id === activePage.id ? { ...p, buttons: reordered } : p)),
    });
  }

  async function save() {
    if (!layout) return;
    setSaving(true);
    setError(null);
    try {
      await api.putLayout(layout);
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Digi Deck — Config</h1>
          <a href="/" style={{ fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>← back to grid</a>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
          />
          <button
            onClick={() => setTemplatesOpen(true)}
            title="browse template layouts"
            style={headerBtnStyle}
          >
            <LayoutGrid size={16} /> Templates
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="import a layout bundle"
            style={headerBtnStyle}
          >
            <Upload size={16} /> Import
          </button>
          <button
            onClick={handleExport}
            title="export the current layout"
            style={headerBtnStyle}
          >
            <Download size={16} /> Export
          </button>
          <button
            onClick={() => setPairingOpen(true)}
            style={headerBtnStyle}
          >
            <Smartphone size={16} /> Pair phone
          </button>
          {savedAt && !dirty && (
            <span style={{ fontSize: 12, color: '#22c55e' }}>saved {savedAt.toLocaleTimeString()}</span>
          )}
          {dirty && <span style={{ fontSize: 12, color: '#eab308' }}>unsaved changes</span>}
          <button
            onClick={save}
            disabled={!dirty || saving || !layout || !!preview}
            style={{
              padding: '8px 16px',
              background: dirty ? '#3b82f6' : '#374151',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              fontSize: 14,
              cursor: dirty ? 'pointer' : 'default',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fee2e2', padding: 12, borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {preview && (
        <PreviewBanner
          title={preview.title}
          onExit={handleExitPreview}
          onApply={handleApplyPreview}
          subtitle="your saved layout is untouched until you click Apply"
        />
      )}

      <IntegrationsPanel />

      {!layout ? (
        <div style={{ opacity: 0.6 }}>Loading layout…</div>
      ) : preview ? (
        <div
          style={{
            background: '#111827',
            border: '1px dashed #4b5563',
            borderRadius: 8,
            padding: 20,
            color: '#9ca3af',
            fontSize: 13,
            lineHeight: 1.5,
            textAlign: 'center',
          }}
        >
          Editing is paused while a template preview is active.<br />
          Click <strong style={{ color: '#22c55e' }}>Apply</strong> to make it permanent,
          or <strong style={{ color: '#fff' }}>Exit</strong> to return to your saved layout.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#9ca3af' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Navigation:
              <select
                value={layout.navigation ?? 'tabs'}
                onChange={(e) =>
                  updateLayout({
                    ...layout,
                    navigation: e.target.value as 'tabs' | 'folders',
                  })
                }
                style={{
                  padding: '4px 8px',
                  background: '#0a0a0a',
                  color: '#fff',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <option value="tabs">Tabs at top</option>
                <option value="folders">Folders (back-stack)</option>
              </select>
            </label>
            <span style={{ fontSize: 11 }}>
              {(layout.navigation ?? 'tabs') === 'folders'
                ? 'Phone hides the tab strip; a Back tile appears as the first grid cell after you tap a "Go to page" button.'
                : 'Phone shows a tab strip at the top of the grid.'}
            </span>
          </div>

          <PageTabBar
            pages={layout.pages}
            activePageId={activePageId}
            onSelect={setActivePageId}
            onAdd={addPage}
          />

          {activePage && (
            <PageBar
              page={activePage}
              layout={layout}
              canDelete={layout.pages.length > 1}
              onChange={(patch) => updatePage(activePage.id, patch)}
              onDelete={() => deletePage(activePage.id)}
            />
          )}

          {activePage && (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={activePage.buttons.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activePage.buttons.map((b) => (
                      <ConfigRow
                        key={b.id}
                        button={b}
                        pages={layout.pages}
                        currentPageId={activePage.id}
                        layout={layout}
                        onChange={(patch) => updateButton(activePage.id, b.id, patch)}
                        onDelete={() => deleteButton(activePage.id, b.id)}
                        onMove={(to) => moveButton(b.id, activePage.id, to)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {activePage.buttons.length === 0 && (
                <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 13, padding: '16px 0' }}>
                  no buttons on this page yet
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => addButton(activePage.id, 'button')}
                  style={addTileBtnStyle}
                >
                  + add button
                </button>
                <button
                  onClick={() => addButton(activePage.id, 'slider')}
                  style={addTileBtnStyle}
                  title="Add a slider tile for OBS audio mixer control"
                >
                  + add slider
                </button>
              </div>
            </>
          )}
        </>
      )}

      <footer style={{ fontSize: 12, color: '#6b7280', marginTop: 24 }}>
        Drag the ≡ handle to reorder buttons. Use the dropdown next to each button to move it to another page. Changes apply when you click Save.
      </footer>

      <PairingModal open={pairingOpen} onClose={() => setPairingOpen(false)} />
      <TemplatesPanel
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPreviewStarted={() => {
          api.listTemplates().then((d) => setPreview(d.preview)).catch(() => undefined);
        }}
      />
    </div>
  );
}

const addTileBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: '#1f2937',
  color: '#fff',
  border: '1px dashed #4b5563',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
};

const headerBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1f2937',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

type TabBarProps = {
  pages: Page[];
  activePageId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
};

function PageTabBar({ pages, activePageId, onSelect, onAdd }: TabBarProps) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
      {pages.map((p) => {
        const Icon = getIcon(p.icon);
        const active = p.id === activePageId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              padding: '6px 12px',
              background: active ? '#3b82f6' : '#1f2937',
              border: `1px solid ${active ? '#3b82f6' : '#374151'}`,
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
            }}
          >
            {Icon ? <Icon size={14} strokeWidth={2} /> : null}
            {p.name}
            {p.buttons.length > 0 && (
              <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 2 }}>
                {p.buttons.length}
              </span>
            )}
          </button>
        );
      })}
      <button
        onClick={onAdd}
        style={{
          padding: '6px 10px',
          background: 'transparent',
          border: '1px dashed #4b5563',
          borderRadius: 8,
          color: '#9ca3af',
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
          flexShrink: 0,
        }}
      >
        <Plus size={12} /> page
      </button>
    </div>
  );
}

type PageBarProps = {
  page: Page;
  layout: Layout;
  canDelete: boolean;
  onChange: (patch: Partial<Page>) => void;
  onDelete: () => void;
};

function PageBar({ page, layout, canDelete, onChange, onDelete }: PageBarProps) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center',
      background: '#0a0a0a', border: '1px solid #1f2937',
      borderRadius: 8, padding: 8,
    }}>
      <IconPicker value={page.icon} onChange={(icon) => onChange({ icon })} />
      <ImagePicker
        value={page.image}
        onChange={(image) => onChange({ image })}
        referencedElsewhere={
          page.image
            ? api.imageReferenceCount(layout, page.image, { pageId: page.id }) > 0
            : false
        }
      />
      <input
        value={page.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Page name"
        style={{
          flex: 1,
          padding: '8px 10px',
          background: '#0a0a0a',
          color: '#fff',
          border: '1px solid #374151',
          borderRadius: 6,
          fontSize: 14,
        }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#9ca3af' }} title="phone grid columns">
        cols:
        <select
          value={page.cols ?? 2}
          onChange={(e) => onChange({ cols: Number(e.target.value) })}
          style={{
            padding: '6px 6px',
            background: '#0a0a0a',
            color: '#fff',
            border: '1px solid #374151',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      {canDelete && (
        <button
          onClick={onDelete}
          style={{
            padding: '8px 10px',
            background: '#7f1d1d',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Trash2 size={14} /> delete page
        </button>
      )}
    </div>
  );
}
