import { useEffect, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { Smartphone, Plus, Trash2, Download, Upload, LayoutGrid, MoreHorizontal, Settings } from 'lucide-react';
import * as api from './lib/api';
import type { Tile, Layout, Page, TileKind } from './lib/types';
import { defaultTile, nextButtonId, nextPageId } from './lib/types';
import { ConfigRow } from './components/ConfigRow';
import { PairingModal } from './components/PairingModal';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { IconPicker } from './components/IconPicker';
import { ImagePicker } from './components/ImagePicker';
import { ColorPicker } from './components/ColorPicker';
import { AppearancePopover, AppearanceSection } from './components/AppearancePopover';
import { TemplatesPanel } from './components/TemplatesPanel';
import { PreviewBanner, usePreviewHeartbeat } from './components/PreviewBanner';
import { getIcon } from './lib/icons';

const CONFIG_ACTIVE_PAGE_KEY = 'digi-deck:config_active_page';

export function ConfigApp() {
  const [layout, setLayout] = useState<Layout | null>(null);
  // Hydrate from localStorage so leaving for the grid view and coming back
  // lands the user on the same page they were last editing. Validated
  // against the loaded layout in the layout-fetch effect below.
  const [activePageId, setActivePageId] = useState<number | null>(() => {
    const stored = localStorage.getItem(CONFIG_ACTIVE_PAGE_KEY);
    if (stored === null) return null;
    const n = Number(stored);
    return Number.isFinite(n) ? n : null;
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [preview, setPreview] = useState<api.PreviewInfo | null>(null);
  // ConfigRow expansion state is parent-managed so we can: (a) auto-expand
  // freshly added tiles, (b) collapse every row on Save.
  const [expandedTileIds, setExpandedTileIds] = useState<Set<number>>(new Set());

  function toggleExpanded(id: number) {
    setExpandedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [integrationStatus, setIntegrationStatus] = useState<{ obs: boolean; twitch: boolean; streamlabs: boolean }>({
    obs: false,
    twitch: false,
    streamlabs: false,
  });
  const importInputRef = useRef<HTMLInputElement>(null);

  // Poll integration availability so the action-type dropdown can hide types
  // for integrations the user hasn't set up (or has explicitly disabled).
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [obs, twitch, streamlabs] = await Promise.all([
          api.getObsState().catch(() => null),
          api.getTwitchState().catch(() => null),
          api.getStreamlabsState().catch(() => null),
        ]);
        if (!alive) return;
        setIntegrationStatus({
          obs: !!obs?.config.enabled,
          twitch: !!twitch?.config.enabled,
          streamlabs: !!streamlabs?.config.enabled,
        });
      } catch { /* harmless */ }
    }
    void load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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
        // Prefer the persisted page if it still exists, else fall back to the first page.
        setActivePageId((prev) => {
          if (prev !== null && l.pages.some((p) => p.id === prev)) return prev;
          return l.pages[0]?.id ?? null;
        });
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  // Persist the active page so reopening the config (after a trip to the grid)
  // lands on the same page.
  useEffect(() => {
    if (activePageId === null) localStorage.removeItem(CONFIG_ACTIVE_PAGE_KEY);
    else localStorage.setItem(CONFIG_ACTIVE_PAGE_KEY, String(activePageId));
  }, [activePageId]);

  // Keep activePageId valid when pages change
  useEffect(() => {
    if (!layout) return;
    if (activePageId === null || !layout.pages.find((p) => p.id === activePageId)) {
      setActivePageId(layout.pages[0]?.id ?? null);
    }
  }, [layout, activePageId]);

  const activePage = layout?.pages.find((p) => p.id === activePageId) ?? null;

  // Merge-style update so partial patches (e.g., { pages } or { navigation })
  // never accidentally drop other top-level fields like navigation. Previously
  // every caller passed `{ pages: ... }` and silently nuked the navigation
  // field on every edit, so a saved "folders" choice got reverted to "tabs"
  // on the next save.
  function updateLayout(patch: Partial<Layout>) {
    if (!layout) return;
    setLayout({ ...layout, ...patch });
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
    // Open the new row so the user sees the editor right after adding.
    setExpandedTileIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
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
      // Successful save → collapse every expanded row.
      setExpandedTileIds(new Set());
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
          <HeaderMoreMenu
            onTemplates={() => setTemplatesOpen(true)}
            onImport={() => importInputRef.current?.click()}
            onExport={handleExport}
          />
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
          <PageTabBar
            pages={layout.pages}
            activePageId={activePageId}
            navigation={layout.navigation ?? 'tabs'}
            onSelect={setActivePageId}
            onAdd={addPage}
            onNavigationChange={(navigation) => updateLayout({ navigation })}
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
                        integrationStatus={integrationStatus}
                        expanded={expandedTileIds.has(b.id)}
                        onToggleExpanded={() => toggleExpanded(b.id)}
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
  navigation: 'tabs' | 'folders';
  onSelect: (id: number) => void;
  onAdd: () => void;
  onNavigationChange: (next: 'tabs' | 'folders') => void;
};

function PageTabBar({ pages, activePageId, navigation, onSelect, onAdd, onNavigationChange }: TabBarProps) {
  return (
    // Outer row carries the layout-nav popover (no overflow clipping); inner row scrolls the tabs.
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto', paddingBottom: 4, flex: 1, minWidth: 0 }}>
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
      <LayoutNavPopover navigation={navigation} onNavigationChange={onNavigationChange} />
    </div>
  );
}

/**
 * Layout-scope settings (just navigation mode for now) live next to
 * the "+ page" button so the scope reads as "all pages" naturally.
 * Per-page settings stay on the PageBar.
 */
function LayoutNavPopover({
  navigation,
  onNavigationChange,
}: {
  navigation: 'tabs' | 'folders';
  onNavigationChange: (next: 'tabs' | 'folders') => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="layout navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          padding: '6px 10px',
          background: 'transparent',
          border: '1px solid #374151',
          borderRadius: 8,
          color: '#9ca3af',
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <Settings size={12} />
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%', right: 0,
            marginTop: 6,
            background: '#0a0a0a',
            border: '1px solid #374151',
            borderRadius: 10,
            padding: 12,
            minWidth: 280,
            zIndex: 20,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <span style={{ fontSize: 10, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Navigation
          </span>
          <select
            value={navigation}
            onChange={(e) => onNavigationChange(e.target.value as 'tabs' | 'folders')}
            style={{
              padding: '6px 8px',
              background: '#0a0a0a',
              color: '#fff',
              border: '1px solid #374151',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <option value="tabs">Tabs at top</option>
            <option value="folders">Folders (back-stack)</option>
          </select>
          <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            {navigation === 'folders'
              ? 'Phone hides the tab strip; a Back tile appears as the first grid cell after you tap a "Go to page" button.'
              : 'Phone shows a tab strip at the top of the grid.'}
          </span>
        </div>
      )}
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
      <AppearancePopover
        hint={{ icon: page.icon, image: page.image, accentColor: page.background }}
        title="page appearance"
      >
        <AppearanceSection label="Tab icon">
          <IconPicker value={page.icon} onChange={(icon) => onChange({ icon })} />
        </AppearanceSection>
        <AppearanceSection label="Tab thumbnail">
          <ImagePicker
            value={page.image}
            onChange={(image) => onChange({ image })}
            referencedElsewhere={
              page.image
                ? api.imageReferenceCount(layout, page.image, { pageId: page.id, field: 'image' }) > 0
                : false
            }
          />
        </AppearanceSection>
        <AppearanceSection label="Phone background image">
          <ImagePicker
            value={page.backgroundImage}
            onChange={(backgroundImage) => onChange({ backgroundImage })}
            referencedElsewhere={
              page.backgroundImage
                ? api.imageReferenceCount(layout, page.backgroundImage, { pageId: page.id, field: 'backgroundImage' }) > 0
                : false
            }
          />
        </AppearanceSection>
        <AppearanceSection label="Phone background color">
          <ColorPicker
            value={page.background}
            onChange={(background) => onChange({ background })}
            label="background"
          />
        </AppearanceSection>
      </AppearancePopover>
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

/**
 * Header overflow menu for the infrequent layout actions
 * (Templates / Import / Export). Keeps Pair phone + Save as the
 * primary header buttons.
 */
function HeaderMoreMenu({
  onTemplates,
  onImport,
  onExport,
}: {
  onTemplates: () => void;
  onImport: () => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="more actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ ...headerBtnStyle, padding: '8px 10px' }}
      >
        <MoreHorizontal size={16} /> More
      </button>
      {open && (
        <div
          ref={popRef}
          role="menu"
          style={{
            position: 'absolute',
            top: '100%', right: 0,
            marginTop: 6,
            background: '#0a0a0a',
            border: '1px solid #374151',
            borderRadius: 8,
            minWidth: 200,
            zIndex: 20,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          <MoreMenuItem icon={<LayoutGrid size={14} />} label="Templates…" onClick={() => run(onTemplates)} />
          <MoreMenuItem icon={<Download   size={14} />} label="Import layout…" onClick={() => run(onImport)} />
          <MoreMenuItem icon={<Upload     size={14} />} label="Export layout" onClick={() => run(onExport)} />
        </div>
      )}
    </div>
  );
}

function MoreMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        padding: '10px 14px',
        background: hover ? '#111827' : 'transparent',
        border: 0,
        color: '#fff',
        fontSize: 13,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
