import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Elite: Dangerous integration — read-only status via the Frontier-shipped
 * Journal API. Elite writes JSON events + a live `Status.json` to
 * `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous\`; this
 * integration watches both and exposes what it sees as LiveMeta so tiles
 * can render `{elite.system}`, `{elite.credits}`, `{elite.fuelPercent}`,
 * charts against `elite.fuelPercent` / `elite.cargoTons`, and the like.
 *
 * No `execute()` — Elite has no output/RPC API. Users control the game via
 * hotkeys they've already bound; Digi Deck's `hotkey` action drives those.
 * The integration is dashboard-only.
 *
 * Data plane:
 *   - `Status.json` — a small (~1 KB) JSON file the game rewrites once per
 *     second. Carries: 32-bit `Flags` bitmask (docked / landed / supercruise
 *     / hardpoints deployed / scooping fuel / etc.), `Fuel` (main + reservoir
 *     tonnes), `Cargo` (tonnes), current coords + heading, pips, heat.
 *   - `Journal.YYYY-MM-DDTHHMMSS.NN.log` — newline-delimited JSON. Each
 *     line is an event: `{ timestamp, event, ...eventSpecificFields }`.
 *     We tail the most recent one from EOF-forward. On start we also
 *     backfill state by scanning the whole current file so
 *     `{elite.commander}` / `{elite.system}` / `{elite.credits}` show
 *     correct values even when Digi Deck launches mid-session.
 *
 * File-watch strategy: fs.watch on the Journal folder catches most changes;
 * a 2s poll of Status.json + the current journal file is the fallback for
 * cases where fs.watch on Windows misses events (network shares, some
 * antivirus setups). Cost is negligible — reading a 1 KB file every 2s.
 */

const DEFAULT_JOURNAL_PATH = join(homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

const POLL_INTERVAL_MS = 2_000;

export type PublicEliteDangerousConfig = {
  enabled: boolean;
  journalPath: string;
};

export function publicEliteDangerousConfig(cfg: EliteDangerousConfig): PublicEliteDangerousConfig {
  return {
    enabled: cfg.enabled,
    journalPath: cfg.journalPath,
  };
}

export function validateEliteDangerousConfig(input: unknown, existing: EliteDangerousConfig): EliteDangerousConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Elite Dangerous config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    journalPath: typeof o.journalPath === 'string' && o.journalPath.trim()
      ? o.journalPath.trim()
      : existing.journalPath,
  };
}

export const ELITE_DANGEROUS_MANIFEST: IntegrationManifest = {
  name: 'elite-dangerous',
  displayName: 'Elite Dangerous',
  actionTypes: [],
  hasOAuth: false,
};

export type EliteDangerousConfig = {
  enabled: boolean;
  journalPath: string;
};

export const DEFAULT_ELITE_DANGEROUS_CONFIG: EliteDangerousConfig = {
  enabled: false,
  journalPath: DEFAULT_JOURNAL_PATH,
};

export type EliteDangerousState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Decoded Status.json flags — see the Elite Dangerous Journal Manual for
 *  the full bitmask. We surface the flags the average streamer/pilot cares
 *  about as tile labels + active-state; the raw `Flags` int is also passed
 *  through in case a template wants to check bits we don't name. */
export type EliteFlags = {
  docked: boolean;
  landed: boolean;
  landingGearDown: boolean;
  shieldsUp: boolean;
  supercruise: boolean;
  flightAssistOff: boolean;
  hardpointsDeployed: boolean;
  inWing: boolean;
  lightsOn: boolean;
  cargoScoopDeployed: boolean;
  silentRunning: boolean;
  scoopingFuel: boolean;
  srvHandbrake: boolean;
  fsdMassLocked: boolean;
  fsdCharging: boolean;
  fsdCooldown: boolean;
  lowFuel: boolean;
  overHeating: boolean;
  inMainShip: boolean;
  inFighter: boolean;
  inSrv: boolean;
  analysisMode: boolean;
  nightVision: boolean;
};

/** One active mission — cut down to the fields tiles actually need.
 *  Full detail from MissionAccepted; on `Missions` snapshot we may have only
 *  a subset (name + expiry) for missions accepted in prior sessions. */
export type EliteMission = {
  missionId: number;
  name: string;
  localisedName?: string;
  faction: string;
  destinationSystem?: string;
  destinationStation?: string;
  /** Unix ms. Undefined for missions with no expiry (rare — most do). */
  expiresAt?: number;
  reward?: number;
  targetType?: string;
  target?: string;
  targetFaction?: string;
  commodity?: string;
  count?: number;
  passengers?: boolean;
  /** True when the accept path had enough data to populate faction + reward.
   *  False when we only have a `Missions` snapshot entry (older sessions). */
  detailed: boolean;
};

export type EliteDangerousStatus = {
  state: EliteDangerousState;
  error?: string;
  journalPath?: string;
  /** Name of the currently-tailed Journal file — useful for the panel to
   *  confirm we're reading the right session. */
  activeJournal?: string;
  commander?: string;
  ship?: string;
  shipName?: string;
  system?: string;
  station?: string;
  credits?: number;
  fuelMain?: number;
  fuelReservoir?: number;
  fuelCapacity?: number;
  cargoTons?: number;
  flags?: EliteFlags;
  missions?: EliteMission[];
  /** Sum of `reward` across all detailed active missions. Missions with no
   *  reward info (snapshot-only entries) contribute 0 — so the value is a
   *  floor, not a certainty. */
  missionTotalReward?: number;
  /** Unix ms of the soonest-expiring mission. Undefined when no missions
   *  have an expiry set. */
  nextMissionExpiryAtMs?: number;
};

class EliteDangerousClient implements IntegrationLifecycle {
  readonly manifest = ELITE_DANGEROUS_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all['elite-dangerous']); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
  }
  publicConfig(): PublicEliteDangerousConfig { return publicEliteDangerousConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): EliteDangerousStatus {
    let state: EliteDangerousState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.journalPath) state = 'not-configured';
    else if (this.err) state = 'error';
    else if (this.connected) state = 'connected';
    else state = 'disconnected';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      journalPath: this.cfg.journalPath || undefined,
      activeJournal: this.activeJournalName,
      commander: this.commander,
      ship: this.ship,
      shipName: this.shipName,
      system: this.system,
      station: this.station,
      credits: this.credits,
      fuelMain: this.fuelMain,
      fuelReservoir: this.fuelReservoir,
      fuelCapacity: this.fuelCapacity,
      cargoTons: this.cargoTons,
      flags: this.flags,
      missions: this.missionsSnapshot(),
      missionTotalReward: this.missionTotalReward(),
      nextMissionExpiryAtMs: this.nextMissionExpiryAtMs(),
    };
  }

  private missionsSnapshot(): EliteMission[] | undefined {
    if (this.missions.size === 0) return undefined;
    // Soonest-expiring first, then by name — matches how the in-game
    // transactions tab lists them, keeps the panel scannable.
    return [...this.missions.values()].sort((a, b) => {
      const aExp = a.expiresAt ?? Number.MAX_SAFE_INTEGER;
      const bExp = b.expiresAt ?? Number.MAX_SAFE_INTEGER;
      if (aExp !== bExp) return aExp - bExp;
      return (a.localisedName ?? a.name).localeCompare(b.localisedName ?? b.name);
    });
  }

  private missionTotalReward(): number | undefined {
    if (this.missions.size === 0) return undefined;
    let total = 0;
    for (const m of this.missions.values()) {
      if (typeof m.reward === 'number') total += m.reward;
    }
    return total;
  }

  private nextMissionExpiryAtMs(): number | undefined {
    let soonest: number | undefined;
    for (const m of this.missions.values()) {
      if (m.expiresAt === undefined) continue;
      if (soonest === undefined || m.expiresAt < soonest) soonest = m.expiresAt;
    }
    return soonest;
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateEliteDangerousConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Elite Dangerous integration not attached');
    this.serverConfig.integrations['elite-dangerous'] = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled) await this.restart();
    else await this.stop();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.journalPath) return;
    if (this.watcher || this.pollTimer) return;
    this.err = undefined;
    try {
      // Fail fast if the folder isn't there — helpful error rather than a
      // silent "connected but nothing shows up" state.
      await fs.access(this.cfg.journalPath);
    } catch {
      this.err = `Elite journal folder not found: ${this.cfg.journalPath}`;
      this.emitChange();
      return;
    }
    this.connected = true;
    // First read — scan the latest journal to bootstrap state so tiles
    // render correctly even when Digi Deck launches mid-session.
    await this.pickCurrentJournalAndBackfill();
    await this.refreshStatus();
    // fs.watch catches most changes; the poll picks up anything Windows
    // misses. Belt-and-braces because journal file rotation + antivirus
    // can occasionally swallow watch events on shared drives.
    try {
      this.watcher = fsWatch(this.cfg.journalPath, (_event, name) => {
        if (typeof name !== 'string') return;
        if (name === 'Status.json') void this.refreshStatus();
        else if (name.startsWith('Journal.') && name.endsWith('.log')) void this.tailJournal();
      });
    } catch (err) {
      console.warn(`[elite] fs.watch failed, relying on poll only: ${(err as Error).message}`);
    }
    this.pollTimer = setInterval(() => {
      void this.refreshStatus();
      void this.tailJournal();
    }, POLL_INTERVAL_MS);
    this.emitChange();
  }

  async stop(): Promise<void> {
    if (this.watcher) { try { this.watcher.close(); } catch { /* ignore */ } this.watcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.connected = false;
    this.activeJournalName = undefined;
    this.journalOffset = 0;
    this.commander = undefined;
    this.ship = undefined;
    this.shipName = undefined;
    this.system = undefined;
    this.station = undefined;
    this.credits = undefined;
    this.fuelMain = undefined;
    this.fuelReservoir = undefined;
    this.fuelCapacity = undefined;
    this.cargoTons = undefined;
    this.flags = undefined;
    this.missions.clear();
    this.err = undefined;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // Elite exposes no output API — everything is read-only. Any user-facing
  // "action" runs through the existing hotkey action pointed at whatever
  // in-game binding they've set. Manifest has actionTypes:[] so this method
  // never fires from the action executor.
  async execute(): Promise<void> {
    throw new Error('Elite Dangerous has no output API — use a hotkey action instead');
  }

  // ─── internal ─────────────────────────────────────

  private cfg: EliteDangerousConfig = { ...DEFAULT_ELITE_DANGEROUS_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private onChangeCb: (() => void) | null = null;
  private connected = false;
  private err: string | undefined;
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private activeJournalName: string | undefined;
  private journalOffset = 0;
  private journalTailPending = false;
  private commander: string | undefined;
  private ship: string | undefined;
  private shipName: string | undefined;
  private system: string | undefined;
  private station: string | undefined;
  private credits: number | undefined;
  private fuelMain: number | undefined;
  private fuelReservoir: number | undefined;
  private fuelCapacity: number | undefined;
  private cargoTons: number | undefined;
  private flags: EliteFlags | undefined;
  /** Active missions keyed by MissionID. Populated on MissionAccepted with
   *  full detail; a `Missions` snapshot event may add minimal entries for
   *  missions from prior sessions we didn't observe being accepted. */
  private missions: Map<number, EliteMission> = new Map();

  private setConfig(cfg: EliteDangerousConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  private emitChange(): void { this.onChangeCb?.(); }

  /** Add a signed delta to the running credit total. No-ops when we
   *  haven't seen a LoadGame baseline yet, or when the caller passes
   *  undefined (event didn't carry the expected field). */
  private addCredits(delta: number | undefined): void {
    if (delta === undefined || this.credits === undefined) return;
    this.credits += delta;
  }

  private async refreshStatus(): Promise<void> {
    try {
      const raw = await fs.readFile(join(this.cfg.journalPath, 'Status.json'), 'utf8');
      // Status.json is rewritten atomically by the game; an occasional
      // empty-read still happens right on the swap. Skip empty bodies.
      if (!raw.trim()) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      const flagsInt = typeof data.Flags === 'number' ? data.Flags : 0;
      const fuel = data.Fuel;
      const fuelMain = typeof (fuel as { FuelMain?: number })?.FuelMain === 'number' ? (fuel as { FuelMain: number }).FuelMain : undefined;
      const fuelReservoir = typeof (fuel as { FuelReservoir?: number })?.FuelReservoir === 'number' ? (fuel as { FuelReservoir: number }).FuelReservoir : undefined;
      const cargo = typeof data.Cargo === 'number' ? data.Cargo : undefined;
      const changed =
        this.fuelMain !== fuelMain
        || this.fuelReservoir !== fuelReservoir
        || this.cargoTons !== cargo
        || JSON.stringify(this.flags) !== JSON.stringify(decodeFlags(flagsInt));
      if (!changed) return;
      this.fuelMain = fuelMain;
      this.fuelReservoir = fuelReservoir;
      this.cargoTons = cargo;
      this.flags = decodeFlags(flagsInt);
      this.emitChange();
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      // Missing Status.json is normal (game not running yet); anything else
      // is worth logging so the user can see it in the server console.
      if (code !== 'ENOENT') {
        console.warn(`[elite] Status.json read failed: ${(err as Error).message}`);
      }
    }
  }

  private async pickCurrentJournalAndBackfill(): Promise<void> {
    let name: string | null;
    try {
      name = await findLatestJournal(this.cfg.journalPath);
    } catch (err) {
      console.warn(`[elite] scan for journals failed: ${(err as Error).message}`);
      return;
    }
    if (!name) return;
    this.activeJournalName = name;
    this.journalOffset = 0;
    // Read + parse the whole file so state (commander / system / credits /
    // ship / loadout) reflects the ongoing session. Journal files run
    // 5-50 MB in a long session — still cheap to parse once.
    await this.tailJournal();
  }

  /** Read the journal from the last-known offset forward, parsing each
   *  newline-delimited event and applying it to our state. Re-entrant-safe
   *  via `journalTailPending` — the watcher can fire faster than we read. */
  private async tailJournal(): Promise<void> {
    if (this.journalTailPending) return;
    this.journalTailPending = true;
    try {
      // Rotation check: game may have started a fresh session. If the file
      // we're following no longer matches the most recent journal, switch.
      const latest = await findLatestJournal(this.cfg.journalPath);
      if (latest && latest !== this.activeJournalName) {
        this.activeJournalName = latest;
        this.journalOffset = 0;
        this.emitChange();
      }
      if (!this.activeJournalName) return;
      const path = join(this.cfg.journalPath, this.activeJournalName);
      let stat;
      try { stat = await fs.stat(path); } catch { return; }
      if (stat.size <= this.journalOffset) return;
      const handle = await fs.open(path, 'r');
      try {
        const length = stat.size - this.journalOffset;
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, this.journalOffset);
        this.journalOffset = stat.size;
        const text = buf.toString('utf8');
        // Split on newlines, ignore incomplete trailing chunks (the game
        // flushes line-by-line but rare race can leave a partial). If we
        // dropped one, the next read picks it up as leftovers.
        const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            this.applyJournalEvent(event);
          } catch {
            // Malformed line — game writes are usually clean but a partial
            // sync could leave garbage. Skip silently.
          }
        }
        this.emitChange();
      } finally {
        await handle.close();
      }
    } finally {
      this.journalTailPending = false;
    }
  }

  private applyJournalEvent(e: Record<string, unknown>): void {
    const kind = typeof e.event === 'string' ? e.event : '';
    switch (kind) {
      case 'Commander':
        if (typeof e.Name === 'string') this.commander = e.Name;
        break;
      case 'LoadGame':
        if (typeof e.Commander === 'string') this.commander = e.Commander;
        if (typeof e.Ship === 'string') this.ship = String(e.Ship);
        if (typeof e.ShipName === 'string') this.shipName = e.ShipName;
        if (typeof e.Credits === 'number') this.credits = e.Credits;
        if (typeof e.FuelCapacity === 'number') this.fuelCapacity = e.FuelCapacity;
        console.log(`[elite] LoadGame: Commander="${e.Commander ?? ''}" Ship="${e.Ship ?? ''}" ShipName="${e.ShipName ?? ''}"`);
        break;
      case 'Loadout':
        if (typeof e.Ship === 'string') this.ship = String(e.Ship);
        if (typeof e.ShipName === 'string') this.shipName = e.ShipName;
        console.log(`[elite] Loadout: Ship="${e.Ship ?? ''}" ShipName="${e.ShipName ?? ''}" ShipIdent="${e.ShipIdent ?? ''}"`);
        // Newer journals wrap fuel capacity as { Main, Reserve }.
        {
          const fc = e.FuelCapacity;
          if (typeof fc === 'number') this.fuelCapacity = fc;
          else if (fc && typeof fc === 'object' && typeof (fc as { Main?: number }).Main === 'number') {
            this.fuelCapacity = (fc as { Main: number }).Main;
          }
        }
        break;
      case 'Location':
      case 'FSDJump':
      case 'CarrierJump':
        if (typeof e.StarSystem === 'string') this.system = e.StarSystem;
        if (typeof e.StationName === 'string') this.station = e.StationName;
        else if (kind === 'FSDJump') this.station = undefined;
        break;
      case 'Docked':
        if (typeof e.StarSystem === 'string') this.system = e.StarSystem;
        if (typeof e.StationName === 'string') this.station = e.StationName;
        break;
      case 'Undocked':
      case 'SupercruiseEntry':
      case 'StartJump':
        this.station = undefined;
        break;
      // Credit-changing events. Elite emits per-event deltas (Reward /
      // TotalSale / Cost / …) but never a running total, so we accumulate
      // off the LoadGame baseline. Missing an obscure event only drifts
      // the local counter until the next LoadGame corrects it.
      case 'Bounty':                     this.addCredits(num(e.TotalReward) ?? num(e.Reward)); break;
      case 'MultiSellExplorationData':   this.addCredits(num(e.TotalEarnings)); break;
      case 'SellExplorationData':        this.addCredits(num(e.TotalEarnings) ?? sumOrUndef(num(e.BaseValue), num(e.Bonus))); break;
      case 'MarketSell':                 this.addCredits(num(e.TotalSale)); break;
      case 'MarketBuy':                  this.addCredits(negOrUndef(num(e.TotalCost))); break;
      case 'RedeemVoucher':              this.addCredits(num(e.Amount)); break;
      case 'RefuelAll':
      case 'RepairAll':
      case 'BuyAmmo':                    this.addCredits(negOrUndef(num(e.Cost))); break;
      case 'BuyDrones':                  this.addCredits(negOrUndef(num(e.TotalCost))); break;
      case 'SellDrones':                 this.addCredits(num(e.TotalSale)); break;
      case 'ModuleBuy':
        // BuyPrice out; SellPrice back in when trading a module.
        this.addCredits(negOrUndef(num(e.BuyPrice)));
        this.addCredits(num(e.SellPrice));
        break;
      case 'ModuleSell':                 this.addCredits(num(e.SellPrice)); break;
      case 'ShipyardBuy':
        // ShipPrice out; trade-in of the old ship comes back in.
        this.addCredits(negOrUndef(num(e.ShipPrice)));
        this.addCredits(num(e.SellOldShip) ?? num(e.SellPrice));
        break;
      case 'ShipyardSell':               this.addCredits(num(e.ShipPrice)); break;
      case 'CommunityGoalReward':        this.addCredits(num(e.Reward)); break;
      case 'MiningRefined':              break; // no credit change (adds cargo, not money)
      case 'ShipyardSwap':
      case 'ShipyardTransfer':
        if (typeof e.ShipType === 'string') this.ship = e.ShipType;
        break;

      // ─── Missions ─────────────────────────────────────
      case 'MissionAccepted': {
        const id = typeof e.MissionID === 'number' ? e.MissionID : undefined;
        if (id === undefined) break;
        this.missions.set(id, {
          missionId: id,
          name: typeof e.Name === 'string' ? e.Name : '',
          localisedName: typeof e.LocalisedName === 'string' ? e.LocalisedName : undefined,
          faction: typeof e.Faction === 'string' ? e.Faction : '(unknown)',
          destinationSystem: typeof e.DestinationSystem === 'string' ? e.DestinationSystem : undefined,
          destinationStation: typeof e.DestinationStation === 'string' ? e.DestinationStation : undefined,
          // MissionAccepted's `Expiry` is ISO 8601 datetime. Older missions
          // (community-goal style) may omit it — those are open-ended.
          expiresAt: typeof e.Expiry === 'string' ? Date.parse(e.Expiry) || undefined : undefined,
          reward: typeof e.Reward === 'number' ? e.Reward : undefined,
          targetType: typeof e.TargetType === 'string' ? e.TargetType : undefined,
          target: typeof e.Target === 'string' ? e.Target : undefined,
          targetFaction: typeof e.TargetFaction === 'string' ? e.TargetFaction : undefined,
          commodity: typeof e.Commodity === 'string' ? e.Commodity : undefined,
          count: typeof e.Count === 'number' ? e.Count : undefined,
          passengers: typeof e.PassengerCount === 'number' && e.PassengerCount > 0,
          detailed: true,
        });
        break;
      }
      case 'MissionCompleted': {
        // Reward may be in `Reward` (total credits) or split across
        // `CommodityReward` / `MaterialsReward` (non-credit). We only
        // credit the numeric total; commodities land in the hold instead.
        this.addCredits(num(e.Reward));
        const id = typeof e.MissionID === 'number' ? e.MissionID : undefined;
        if (id !== undefined) this.missions.delete(id);
        break;
      }
      case 'MissionFailed':
      case 'MissionAbandoned': {
        const id = typeof e.MissionID === 'number' ? e.MissionID : undefined;
        if (id !== undefined) this.missions.delete(id);
        break;
      }
      case 'MissionRedirected': {
        const id = typeof e.MissionID === 'number' ? e.MissionID : undefined;
        if (id === undefined) break;
        const existing = this.missions.get(id);
        if (!existing) break;
        if (typeof e.NewDestinationSystem === 'string') existing.destinationSystem = e.NewDestinationSystem;
        if (typeof e.NewDestinationStation === 'string') existing.destinationStation = e.NewDestinationStation;
        break;
      }
      case 'Missions': {
        // Authoritative snapshot of `Active` (+ Failed + Complete, ignored).
        // Merge rather than replace: preserve rich detail from earlier
        // MissionAccepted events, add minimal stubs for anything we missed
        // (accepted in a prior session), remove anything the snapshot no
        // longer includes (finished by another route).
        const active = Array.isArray(e.Active) ? e.Active as Array<Record<string, unknown>> : [];
        const seen = new Set<number>();
        for (const m of active) {
          const id = typeof m.MissionID === 'number' ? m.MissionID : undefined;
          if (id === undefined) continue;
          seen.add(id);
          const existing = this.missions.get(id);
          // Snapshot's `Expires` field is seconds-remaining (numeric) in the
          // modern journal format; older journals used an ISO string.
          // Handle both.
          let expiresAt: number | undefined;
          if (typeof m.Expires === 'number') expiresAt = Date.now() + m.Expires * 1000;
          else if (typeof m.Expires === 'string') expiresAt = Date.parse(m.Expires) || undefined;
          if (existing) {
            if (expiresAt !== undefined) existing.expiresAt = expiresAt;
          } else {
            this.missions.set(id, {
              missionId: id,
              name: typeof m.Name === 'string' ? m.Name : '',
              localisedName: typeof m.LocalisedName === 'string' ? m.LocalisedName : undefined,
              faction: '(unknown)',
              expiresAt,
              passengers: !!m.PassengerMission,
              detailed: false,
            });
          }
        }
        for (const id of [...this.missions.keys()]) {
          if (!seen.has(id)) this.missions.delete(id);
        }
        break;
      }
    }
  }
}

// ─── helpers ────────────────────────────────────────

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function negOrUndef(v: number | undefined): number | undefined {
  return v === undefined ? undefined : -v;
}

function sumOrUndef(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

async function findLatestJournal(dir: string): Promise<string | null> {
  let entries: string[];
  try { entries = await fs.readdir(dir); }
  catch { return null; }
  const journals = entries.filter((n) => n.startsWith('Journal.') && n.endsWith('.log'));
  if (journals.length === 0) return null;
  // Journal filenames sort chronologically because the timestamp is in
  // ISO-like `Journal.YYYY-MM-DDTHHMMSS.NN.log` form.
  journals.sort();
  return journals[journals.length - 1];
}

/** Decode Status.json's 32-bit Flags bitmask per the Elite journal manual.
 *  We surface the flags most useful for a streamer HUD; the rest can be
 *  added by name here without touching any callers. */
function decodeFlags(bits: number): EliteFlags {
  const bit = (n: number) => (bits & (1 << n)) !== 0;
  return {
    docked:              bit(0),
    landed:              bit(1),
    landingGearDown:     bit(2),
    shieldsUp:           bit(3),
    supercruise:         bit(4),
    flightAssistOff:     bit(5),
    hardpointsDeployed:  bit(6),
    inWing:              bit(7),
    lightsOn:            bit(8),
    cargoScoopDeployed:  bit(9),
    silentRunning:       bit(10),
    scoopingFuel:        bit(11),
    srvHandbrake:        bit(12),
    fsdMassLocked:       bit(16),
    fsdCharging:         bit(17),
    fsdCooldown:         bit(18),
    lowFuel:             bit(19),
    overHeating:         bit(20),
    inMainShip:          bit(24),
    inFighter:           bit(25),
    inSrv:               bit(26),
    analysisMode:        bit(27),
    nightVision:         bit(28),
  };
}

let _instance: EliteDangerousClient | null = null;
export function getEliteDangerous(): EliteDangerousClient {
  if (!_instance) {
    _instance = new EliteDangerousClient();
    registerIntegration(_instance);
  }
  return _instance;
}
