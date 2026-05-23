import Bonjour from 'bonjour-service';

let bonjour: Bonjour | null = null;

export function startMdns(port: number): void {
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: 'Digi Deck',
      type: 'digi-deck',
      port,
      txt: { v: '1' },
    });
    console.log(`mDNS: advertising _digi-deck._tcp on :${port}`);
  } catch (err) {
    console.warn('mDNS unavailable:', (err as Error).message);
    bonjour = null;
  }
}

export function stopMdns(): void {
  if (!bonjour) return;
  try {
    bonjour.destroy();
  } catch {
    /* shutdown errors are not actionable */
  }
  bonjour = null;
}
