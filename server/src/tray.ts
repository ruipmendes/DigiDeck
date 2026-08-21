import { spawn, type ChildProcess } from 'node:child_process';

export type TrayActions = {
  onOpen: () => void;
  onReload: () => Promise<void> | void;
  /** Called when the user picks any "Restart <X> connection" item; the picked integration's registry name is passed. */
  onRestart: (integrationName: string) => Promise<void> | void;
  onCheckForUpdates: () => Promise<void> | void;
  onQuit: () => Promise<void> | void;
};

/**
 * Ordered list of integrations the tray knows about. Each entry drives one
 * "Restart <displayName> connection" menu item when `enabled` is true. Built
 * from the integration registry in index.ts — the tray itself no longer
 * hardcodes any integration name.
 */
export type TrayMenu = Array<{ name: string; displayName: string; enabled: boolean }>;

function buildPsScript(menu: TrayMenu): string {
  const restartItems: string[] = [];
  let idx = 0;
  for (const entry of menu) {
    if (!entry.enabled) continue;
    // Escape single quotes in displayName for the PS single-quoted string literal.
    const label = entry.displayName.replace(/'/g, "''");
    const varName = `$restartItem${idx++}`;
    const cmd = `RESTART_${entry.name.toUpperCase()}`;
    restartItems.push(`${varName} = $menu.Items.Add('Restart ${label} connection')`);
    restartItems.push(`${varName}.Add_Click({ Send-Cmd '${cmd}' })`);
  }
  // Only emit the separator when at least one restart item exists, otherwise it dangles.
  const restartBlock = restartItems.length > 0
    ? `${restartItems.join('\n')}\n[void]$menu.Items.Add('-')`
    : '';

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Visible = $true
$notify.Text = 'Digi Deck'

function Send-Cmd([string]$cmd) {
  [Console]::Out.WriteLine($cmd)
  [Console]::Out.Flush()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Open config')
$openItem.Add_Click({ Send-Cmd 'OPEN' })

$reloadItem = $menu.Items.Add('Reload layout')
$reloadItem.Add_Click({ Send-Cmd 'RELOAD' })

[void]$menu.Items.Add('-')

${restartBlock}

$updateItem = $menu.Items.Add('Check for updates')
$updateItem.Add_Click({
  # Instant visual acknowledgement so the ~1-3 s GitHub round-trip isn't silent.
  # (The follow-up dialog with the actual result appears when the check completes.)
  $notify.BalloonTipTitle = 'Digi Deck'
  $notify.BalloonTipText = 'Checking for updates...'
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notify.ShowBalloonTip(3000)
  Send-Cmd 'CHECK_UPDATES'
})

[void]$menu.Items.Add('-')

$quitItem = $menu.Items.Add('Quit')
$quitItem.Add_Click({
  Send-Cmd 'QUIT'
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

# Left-click also opens config
$notify.Add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send-Cmd 'OPEN' }
})

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $notify.Visible = $false
  $notify.Dispose()
}
`;
}

let trayProc: ChildProcess | null = null;
let currentActions: TrayActions | null = null;
let currentMenu: TrayMenu | null = null;

function spawnTray(actions: TrayActions, menu: TrayMenu): void {
  if (process.platform !== 'win32') return;

  const encoded = Buffer.from(buildPsScript(menu), 'utf16le').toString('base64');

  try {
    trayProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
  } catch (err) {
    console.warn('[tray] failed to start:', (err as Error).message);
    trayProc = null;
    return;
  }

  if (!trayProc.stdout) {
    console.warn('[tray] no stdout from child process');
    return;
  }

  let buf = '';
  trayProc.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const cmd = line.trim();
      // Always dispatch against currentActions so a refreshed tray still hits live callbacks.
      if (cmd && currentActions) void dispatch(cmd, currentActions);
    }
  });

  trayProc.on('exit', () => {
    trayProc = null;
  });
}

export function startTray(actions: TrayActions, menu: TrayMenu): void {
  currentActions = actions;
  currentMenu = menu;
  spawnTray(actions, menu);
  console.log(`[tray] system tray icon installed (restart items: ${menuLabel(menu)})`);
}

/** Rebuild the tray with a new menu config. Idempotent — skips if the menu hasn't changed. */
export function updateTrayMenu(menu: TrayMenu): void {
  if (process.platform !== 'win32') return;
  if (!currentActions) return;
  if (currentMenu && sameMenu(currentMenu, menu)) return;
  currentMenu = menu;
  if (trayProc && !trayProc.killed) {
    try { trayProc.kill(); } catch { /* ignore */ }
  }
  trayProc = null;
  spawnTray(currentActions, menu);
  console.log(`[tray] refreshed menu (restart items: ${menuLabel(menu)})`);
}

function sameMenu(a: TrayMenu, b: TrayMenu): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (a[i].enabled !== b[i].enabled) return false;
  }
  return true;
}

function menuLabel(menu: TrayMenu): string {
  const items = menu.filter((m) => m.enabled).map((m) => m.name);
  return items.length > 0 ? items.join(', ') : 'none';
}

async function dispatch(cmd: string, actions: TrayActions): Promise<void> {
  try {
    switch (cmd) {
      case 'OPEN':          actions.onOpen(); break;
      case 'RELOAD':        await actions.onReload(); break;
      case 'CHECK_UPDATES': await actions.onCheckForUpdates(); break;
      case 'QUIT':          await actions.onQuit(); break;
      default:
        if (cmd.startsWith('RESTART_')) {
          const name = cmd.slice('RESTART_'.length).toLowerCase();
          await actions.onRestart(name);
        } else {
          console.warn(`[tray] unknown command: ${cmd}`);
        }
    }
  } catch (err) {
    console.error(`[tray] action ${cmd} failed:`, (err as Error).message);
  }
}

export function stopTray(): void {
  if (trayProc && !trayProc.killed) {
    try { trayProc.kill(); } catch { /* ignore */ }
  }
  trayProc = null;
}
