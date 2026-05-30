import { spawn, type ChildProcess } from 'node:child_process';

export type TrayActions = {
  onOpen: () => void;
  onReload: () => Promise<void> | void;
  onRestartObs: () => Promise<void> | void;
  onRestartTwitch: () => Promise<void> | void;
  onRestartStreamlabs: () => Promise<void> | void;
  onCheckForUpdates: () => Promise<void> | void;
  onQuit: () => Promise<void> | void;
};

/** Which "Restart X connection" items the menu should include. Updated as integration config changes. */
export type TrayMenu = {
  obs: boolean;
  streamlabs: boolean;
  twitch: boolean;
};

function buildPsScript(menu: TrayMenu): string {
  const restartItems: string[] = [];
  if (menu.obs) {
    restartItems.push(`$obsItem = $menu.Items.Add('Restart OBS connection')`);
    restartItems.push(`$obsItem.Add_Click({ Send-Cmd 'RESTART_OBS' })`);
  }
  if (menu.streamlabs) {
    restartItems.push(`$slItem = $menu.Items.Add('Restart Streamlabs connection')`);
    restartItems.push(`$slItem.Add_Click({ Send-Cmd 'RESTART_STREAMLABS' })`);
  }
  if (menu.twitch) {
    restartItems.push(`$twitchItem = $menu.Items.Add('Restart Twitch connection')`);
    restartItems.push(`$twitchItem.Add_Click({ Send-Cmd 'RESTART_TWITCH' })`);
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
$updateItem.Add_Click({ Send-Cmd 'CHECK_UPDATES' })

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
  if (currentMenu && currentMenu.obs === menu.obs && currentMenu.streamlabs === menu.streamlabs && currentMenu.twitch === menu.twitch) {
    return;
  }
  currentMenu = menu;
  if (trayProc && !trayProc.killed) {
    try { trayProc.kill(); } catch { /* ignore */ }
  }
  trayProc = null;
  spawnTray(currentActions, menu);
  console.log(`[tray] refreshed menu (restart items: ${menuLabel(menu)})`);
}

function menuLabel(menu: TrayMenu): string {
  const items: string[] = [];
  if (menu.obs) items.push('obs');
  if (menu.streamlabs) items.push('streamlabs');
  if (menu.twitch) items.push('twitch');
  return items.length > 0 ? items.join(', ') : 'none';
}

async function dispatch(cmd: string, actions: TrayActions): Promise<void> {
  try {
    switch (cmd) {
      case 'OPEN':           actions.onOpen(); break;
      case 'RELOAD':         await actions.onReload(); break;
      case 'RESTART_OBS':         await actions.onRestartObs(); break;
      case 'RESTART_STREAMLABS':  await actions.onRestartStreamlabs(); break;
      case 'RESTART_TWITCH':      await actions.onRestartTwitch(); break;
      case 'CHECK_UPDATES':       await actions.onCheckForUpdates(); break;
      case 'QUIT':                await actions.onQuit(); break;
      default:               console.warn(`[tray] unknown command: ${cmd}`);
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
