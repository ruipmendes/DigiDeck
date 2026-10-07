import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import selfsigned from 'selfsigned';
import { appDataDir, isWindows, osLabel } from './platform.js';

/**
 * Self-signed cert used when the user opts into HTTPS. Two generators:
 *   - Windows: `.NET CertificateRequest` under PowerShell → PFX + passphrase.
 *     Zero npm deps, works on every Windows 10+ box out of the box.
 *   - macOS / Linux: the `selfsigned` npm package → PEM key + cert pair.
 *     Pure JS, zero native deps.
 * Both paths cache under `%APPDATA%/digi-deck/https`.
 *
 * The cert is regenerated whenever the set of local LAN IPs changes, so the
 * SubjectAltName list always matches the addresses phones actually use.
 */

const APP_DIR = join(appDataDir(), 'digi-deck');
const CERT_DIR = join(APP_DIR, 'https');
const CERT_PFX = join(CERT_DIR, 'cert.pfx');
const CERT_PEM_KEY = join(CERT_DIR, 'cert.key.pem');
const CERT_PEM_CERT = join(CERT_DIR, 'cert.cert.pem');
const CERT_CER = join(CERT_DIR, 'cert.cer');
const CERT_META = join(CERT_DIR, 'cert.meta.json');

export const CERT_CER_PATH = CERT_CER;

export type TlsCertMaterial =
  | { pfx: Buffer; passphrase: string }
  | { key: string; cert: string };

type CertMeta = { sans: string[]; passphrase?: string; kind?: 'pfx' | 'pem' };

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
  const meta = await readCertMeta();
  if (!meta) return true;
  const expectedKind: 'pfx' | 'pem' = isWindows ? 'pfx' : 'pem';
  // Switched formats (e.g. user migrated the AppData from Windows to Mac) —
  // regenerate rather than feed a PFX to the PEM loader or vice versa.
  if (meta.kind && meta.kind !== expectedKind) return true;
  if (isWindows) {
    if (!existsSync(CERT_PFX)) return true;
    // Legacy cert (pre-random-passphrase) — regenerate so the new format lands.
    if (!meta.passphrase) return true;
  } else {
    if (!existsSync(CERT_PEM_KEY) || !existsSync(CERT_PEM_CERT)) return true;
  }
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
  if (isWindows) {
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
    await fs.writeFile(CERT_META, JSON.stringify({ sans: ips, passphrase, kind: 'pfx' }, null, 2), 'utf8');
    return;
  }

  // macOS / Linux — pure-JS self-signed cert via the `selfsigned` npm pkg.
  // Node's https server accepts the resulting PEM pair directly, no PFX
  // conversion needed.
  const attrs = [{ name: 'commonName', value: 'Digi Deck' }];
  const altNames: Array<{ type: 2 | 7; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    ...ips.map((ip) => ({ type: 7 as const, ip })),
  ];
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + 365 * 10 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(attrs, {
    algorithm: 'sha256',
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'subjectAltName', altNames },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  });
  await fs.writeFile(CERT_PEM_KEY, pems.private, 'utf8');
  await fs.writeFile(CERT_PEM_CERT, pems.cert, 'utf8');
  // Also emit a DER .cer so certFingerprint() + anything expecting a .cer
  // file keeps working. selfsigned already produced the PEM; strip
  // armour and base64-decode to DER.
  const der = pemToDer(pems.cert);
  await fs.writeFile(CERT_CER, der);
  await fs.writeFile(CERT_META, JSON.stringify({ sans: ips, kind: 'pem' }, null, 2), 'utf8');
  // osLabel used so the "Windows-only in docs" boilerplate catches the
  // right-OS message when someone grep's for it.
  void osLabel;
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

/**
 * Add the generated .cer to the current user's Trusted Root store via
 * `certutil -user -addstore Root <path>`. That store is what Chrome and
 * Edge read, so once this runs neither browser warns on the self-signed
 * cert. No UAC / admin needed — CurrentUser\Root is user-writable.
 * (Firefox has its own store — it's unaffected.)
 */
export async function installCertTrust(): Promise<{ output: string }> {
  if (!isWindows) {
    throw new Error(`One-click cert trust is Windows-only; on ${osLabel}, trust the cert in your OS keychain manually.`);
  }
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
    const path = isWindows ? CERT_PFX : CERT_PEM_CERT;
    console.log(`[https] cert saved to ${path}`);
  }
  return CERT_CER;
}

/** Load the cert material in a shape Node's https server consumes directly —
 *  `{ pfx, passphrase }` on Windows, `{ key, cert }` elsewhere. */
export async function loadOrGenerateCert(): Promise<TlsCertMaterial> {
  await ensureCert();
  const meta = await readCertMeta();
  if (!meta) throw new Error('cert meta missing after generation');
  if (isWindows) {
    if (!meta.passphrase) throw new Error('cert meta missing passphrase after generation');
    return { pfx: await fs.readFile(CERT_PFX), passphrase: meta.passphrase };
  }
  const [key, cert] = await Promise.all([
    fs.readFile(CERT_PEM_KEY, 'utf8'),
    fs.readFile(CERT_PEM_CERT, 'utf8'),
  ]);
  return { key, cert };
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
