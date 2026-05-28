import { spawn, type ChildProcess } from 'node:child_process';

export type TrayActions = {
  onOpen: () => void;
  onReload: () => Promise<void> | void;
  onRestartObs: () => Promise<void> | void;
  onRestartTwitch: () => Promise<void> | void;
  onCheckForUpdates: () => Promise<void> | void;
  onQuit: () => Promise<void> | void;
};

const PS_SCRIPT = `
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

$obsItem = $menu.Items.Add('Restart OBS connection')
$obsItem.Add_Click({ Send-Cmd 'RESTART_OBS' })

$twitchItem = $menu.Items.Add('Restart Twitch connection')
$twitchItem.Add_Click({ Send-Cmd 'RESTART_TWITCH' })

[void]$menu.Items.Add('-')

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

let trayProc: ChildProcess | null = null;

export function startTray(actions: TrayActions): void {
  if (process.platform !== 'win32') return;

  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

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
      if (cmd) void dispatch(cmd, actions);
    }
  });

  trayProc.on('exit', () => {
    trayProc = null;
  });

  console.log('[tray] system tray icon installed');
}

async function dispatch(cmd: string, actions: TrayActions): Promise<void> {
  try {
    switch (cmd) {
      case 'OPEN':           actions.onOpen(); break;
      case 'RELOAD':         await actions.onReload(); break;
      case 'RESTART_OBS':    await actions.onRestartObs(); break;
      case 'RESTART_TWITCH': await actions.onRestartTwitch(); break;
      case 'CHECK_UPDATES':  await actions.onCheckForUpdates(); break;
      case 'QUIT':           await actions.onQuit(); break;
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
