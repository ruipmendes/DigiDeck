import { spawn } from 'node:child_process';

/**
 * Opens a native Windows OpenFileDialog on the PC running the server
 * and resolves with the selected path (or `null` if the user cancels).
 *
 * Spawned PowerShell creates a hidden top-most parent form so the
 * dialog reliably comes to the front; the real PowerShell window is
 * itself hidden via `-WindowStyle Hidden` + `windowsHide: true`.
 *
 * Windows-only — non-Windows platforms reject early.
 */
export async function browseForFile(opts?: {
  title?: string;
  initialDir?: string;
  filter?: string;
}): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('file browser is only available on Windows');
  }

  const title       = opts?.title       ?? 'Digi Deck — select a file';
  const initialDir  = opts?.initialDir  ?? '%ProgramFiles%';
  const filter      = opts?.filter      ?? 'Apps and shortcuts (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|All files (*.*)|*.*';

  const script = `
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Size = New-Object System.Drawing.Size(1,1)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-2000, -2000)
$form.Show()

$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ${psString(title)}
$d.Filter = ${psString(filter)}
$d.InitialDirectory = [System.Environment]::ExpandEnvironmentVariables(${psString(initialDir)})
$d.RestoreDirectory = $true
$d.CheckFileExists = $true

$result = $d.ShowDialog($form)
$form.Close()
$form.Dispose()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($d.FileName)
}
`;

  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise<string | null>((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code !== 0) {
        const msg = (stderr.trim() || stdout.trim()) || `exit ${code}`;
        return reject(new Error(`PowerShell dialog failed: ${msg}`));
      }
      const picked = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(picked && picked.length > 0 ? picked : null);
    });
  });
}

function psString(s: string): string {
  // Single-quoted PowerShell string with the only special escape being a doubled single quote.
  return `'${s.replace(/'/g, "''")}'`;
}
