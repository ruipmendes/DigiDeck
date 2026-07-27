import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Self-signed cert used when the user opts into HTTPS. Generated via
 * PowerShell's New-SelfSignedCertificate (built into Windows — no npm
 * dependency, no OpenSSL required) and cached under %APPDATA%.
 *
 * Regenerated automatically when the set of local network interface IPs
 * changes, so the cert's SubjectAltName always matches the addresses phones
 * actually connect through.
 */

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
const CERT_DIR = join(APP_DIR, 'https');
const CERT_PFX = join(CERT_DIR, 'cert.pfx');
const CERT_CER = join(CERT_DIR, 'cert.cer');
const CERT_META = join(CERT_DIR, 'cert.meta.json');

export const CERT_CER_PATH = CERT_CER;

type CertMeta = { sans: string[]; passphrase?: string };

function currentSans(): string[] {
  // Localhost + every non-internal IP the machine has right now.
  // These become the cert's SubjectAltName so the same cert covers
  // https://localhost, https://127.0.0.1, and https://<LAN IP>.
  const ips = new Set<string>(['127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.add(ni.address);
    }
  }
  return [...ips].sort();
}

async function readCertMeta(): Promise<CertMeta | null> {
  try {
    const raw = await fs.readFile(CERT_META, 'utf8');
    return JSON.parse(raw) as CertMeta;
  } catch { return null; }
}

async function needsRegen(): Promise<boolean> {
  if (!existsSync(CERT_PFX)) return true;
  const meta = await readCertMeta();
  if (!meta) return true;
  // Legacy cert (pre-random-passphrase) — regenerate so the new format lands.
  if (!meta.passphrase) return true;
  const wanted = currentSans().join(',');
  const have = [...meta.sans].sort().join(',');
  return wanted !== have;
}

function buildPsScript(ips: string[], pfxPassphrase: string): string {
  // Uses .NET's CertificateRequest (System.Security.Cryptography, in the box
  // on Windows 10+). Avoids the Cert: PSDrive and the PKI module entirely —
  // both of which have proven finicky under -NoProfile / -EncodedCommand.
  const sanBuilderLines = [
    `$sanBuilder.AddDnsName("localhost")`,
    ...ips.map((ip) => `$sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse("${ip}"))`),
  ].join('\n');
  // Passphrase is baked into the encoded (base64) script — never on the argv,
  // so `ps` / Get-Process command-line listings never see it. Not a real
  // secret anyway (see generateCert comment), but keeps GitGuardian and
  // future readers from mistaking it for one.
  return `
$ErrorActionPreference = 'Stop'
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
try {
  $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(
    "CN=Digi Deck",
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $sanBuilder = New-Object System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder
${sanBuilderLines}
  $req.CertificateExtensions.Add($sanBuilder.Build())
  # Mark as a TLS server cert.
  $ekuOid = New-Object System.Security.Cryptography.OidCollection
  [void]$ekuOid.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1"))
  $req.CertificateExtensions.Add(
    (New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($ekuOid, $false))
  )
  $notBefore = [System.DateTimeOffset]::UtcNow
  $notAfter  = $notBefore.AddYears(10)
  $cert = $req.CreateSelfSigned($notBefore, $notAfter)
  $pfxBytes = $cert.Export(
    [System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,
    "${pfxPassphrase}"
  )
  [System.IO.File]::WriteAllBytes("${CERT_PFX}", $pfxBytes)
  $cerBytes = $cert.Export(
    [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
  )
  [System.IO.File]::WriteAllBytes("${CERT_CER}", $cerBytes)
} finally {
  $rsa.Dispose()
}
`;
}

async function generateCert(): Promise<void> {
  await fs.mkdir(CERT_DIR, { recursive: true });
  const ips = currentSans();
  // The PFX passphrase gates access to the private key at rest. Not a real
  // secret in the source-code sense (anyone who can read cert.pfx can also
  // read cert.meta.json right next to it) — it's defense-in-depth against a
  // stray PFX being lifted without the metadata file. Regenerated with each
  // cert so it's never hardcoded, per-install unique, high-entropy.
  const passphrase = randomBytes(32).toString('hex');
  const script = buildPsScript(ips, passphrase);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await new Promise<void>((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    p.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cert generation failed (exit ${code}): ${stderr.trim() || '(no stderr)'}`));
    });
  });
  await fs.writeFile(CERT_META, JSON.stringify({ sans: ips, passphrase }, null, 2), 'utf8');
}

/**
 * Add the generated .cer to the current user's Trusted Root store via
 * `certutil -user -addstore Root <path>`. That store is what Chrome and
 * Edge read, so once this runs neither browser warns on the self-signed
 * cert. No UAC / admin needed — CurrentUser\Root is user-writable.
 * (Firefox has its own store — it's unaffected.)
 */
export async function installCertTrust(): Promise<{ output: string }> {
  const cerPath = await ensureCert();
  return new Promise((resolve, reject) => {
    const p = spawn('certutil.exe', ['-user', '-addstore', 'Root', cerPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    p.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    p.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve({ output: stdout.trim() });
      else reject(new Error(`certutil failed (exit ${code}): ${stderr.trim() || stdout.trim() || '(no output)'}`));
    });
  });
}

/** Idempotently create the cert files on disk, then return the public .cer path. */
export async function ensureCert(): Promise<string> {
  if (await needsRegen()) {
    console.log('[https] generating self-signed cert...');
    await generateCert();
    console.log(`[https] cert saved to ${CERT_PFX}`);
  }
  return CERT_CER;
}

/** Load the cert (PFX bytes + passphrase) — generates it first if needed. */
export async function loadOrGenerateCert(): Promise<{ pfx: Buffer; passphrase: string }> {
  await ensureCert();
  const meta = await readCertMeta();
  if (!meta?.passphrase) throw new Error('cert meta missing after generation');
  return { pfx: await fs.readFile(CERT_PFX), passphrase: meta.passphrase };
}

/**
 * SHA-256 fingerprint of the DER-encoded cert, colon-separated hex.
 * Users compare this against what their browser shows when accepting
 * the cert, to confirm they're trusting the right one.
 */
export async function certFingerprint(): Promise<string | null> {
  try {
    const der = await fs.readFile(CERT_CER);
    const hex = createHash('sha256').update(der).digest('hex').toUpperCase();
    return hex.match(/.{2}/g)?.join(':') ?? hex;
  } catch { return null; }
}
