# Security Policy

Digi Deck is a personal project. If you spot a security issue, please **report it privately** rather than opening a public issue — the fix and disclosure timeline are much better for everyone that way.

## Reporting

**Preferred:** open a [private security advisory on GitHub](https://github.com/ruipmendes/DigiDeck/security/advisories/new). Only maintainers can see it, and it doubles as the coordination thread for triage + fix.

Please include:
- What you observed and, if applicable, steps to reproduce
- Which version / commit SHA the report applies to (see `.digi-deck-version` in your install)
- Any suggested severity or impact assessment

## Scope

**In scope:**
- The Node server (`server/`) — authentication, action execution, integration handling
- The client PWA (`client/`) — anything reachable from a paired phone or the config UI
- Windows launcher / updater scripts (`start.ps1`, `install.ps1`, `apply-update.ps1`, `apply-update-zip.ps1`)

**Out of scope:**
- Vulnerabilities in third-party services (Twitch, Kick, OBS, Streamlabs, Discord) — please report those upstream
- Attacks that require prior admin/user access to the host PC — the app already assumes the local user is trusted
- Denial of service from a paired phone (a paired phone can trigger actions by design)

## Timeline

This is a spare-time project — realistic expectations:

- Acknowledgement: within a few days
- Triage / initial reply: within a week
- Fix: depends on severity — critical issues jump the queue, nice-to-haves may wait

## After a fix

Security fixes land on `main` with intentionally sparse commit messages so the public git log doesn't hand a roadmap to anyone still on the vulnerable version. Full details go into the private advisory (published on release, or once the majority of installs have updated).

## Credit

Happy to credit reporters in the advisory, or keep the report anonymous — your call. Say so when you file.
