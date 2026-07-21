# Handoff — 2026-07-21

Session summary: both apps (Booth Mode + Forge Log) are v1-complete, offline-first
PWAs, deployed to Firebase Hosting, with an opt-in Firebase sync layer built and
unit-tested. This session deployed both, walked through Firebase console setup end
to end, and started actually connecting each app's Sync sheet to the live project.
**This file is duplicated byte-identical in both repos** — read whichever one you
open first, the other is the same.

## Right now — unresolved, check this first

Booth Mode's Sync sheet (⟳ chip, top bar) has the real `entropy-suite` Firebase
config pasted and saved. Tapping **Crear cuenta** failed with:

```
Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.)
```

Diagnosis given to Francis: newly-created Firebase projects often auto-create a
Browser API key with **API restrictions** that don't include Identity Toolkit API
/ Token Service API — Auth calls fail with this exact message even though the key
is correctly copied and Firestore itself is fine.

Fix given, **not yet confirmed working**:
1. https://console.cloud.google.com/apis/credentials?project=entropy-suite
2. Open the key named "Browser key (auto created by Firebase)".
3. Under **API restrictions**, add **Identity Toolkit API** and **Token Service
   API** to the allowed list — or switch to "Don't restrict key" (Firestore rules
   are the real protection here, not this key restriction).
4. Save, wait ~1–2 min for propagation, retry **Crear cuenta** in the app. No need
   to repaste the config — it already saved successfully.

**First thing to do in the new session: ask Francis whether that fix worked.**
- If yes → finish Booth Mode (sign in, **Sincronizar ahora**), then do the exact
  same Sync-sheet flow in Forge Log — **same email/password in both apps**.
  `products`/`tiers` only cross between the two apps when both are signed into
  the same account (see each README's "Sync" section for why).
- If no → new diagnosis needed. Next guess would be an HTTP-referrer restriction
  on the same key not allowing `entropy-suite.web.app`.

## Standing decisions — do not re-litigate

- **Field-test first.** Francis, verbatim: *"Por ahora quiero probarla en campo,
  ya que funcione bien podemos hacerla 'de verdad' para las play stores
  respectivas."* Don't start Capacitor/native/store-build work until he says the
  PWAs held up in the field. Capacitor is already a devDependency and named in
  both plan.md files for when that day comes — it's not forgotten, it's sequenced.
- Booth Mode must work 100% offline for real fair use. Sync is opt-in and manual
  (the ⟳ button) — it must never become a requirement for sale/cash/inventory.
- Money is always integer centavos, never floats. Tiers are editable named
  hypotheses, owned/edited in Forge Log. "Unknown beats wrong" throughout — 0/null
  over a guessed number, everywhere in both apps.

## What's deployed

- Booth Mode: https://entropy-suite.web.app
- Forge Log: https://forge-log-e6c33.web.app
- Both installed as a PWA on Francis's Android phone. iPhone install was discussed
  (same flow via Safari → Share → Add to Home Screen) but not confirmed done.
- Firebase project `entropy-suite`: Firestore created, Email/Password sign-in
  enabled, security rules published from console. The rules text lives in
  [docs/firebase-setup.md](docs/firebase-setup.md) §4 — **not yet** captured as a
  versioned `firestore.rules` file in either repo, so the console is currently the
  only copy. Worth fixing at some point, not urgent.

## What's built

Full architecture and known gaps are in each repo's own `README.md` — don't
re-derive it, it's kept current. Short version: both apps are v1-complete per
their `plan.md` P0–P3, installable, offline-first, sharing a byte-identical CSV
template and a byte-identical sync core
(`src/sync/{merge,engine,fake,firestore}.ts`, `src/ui/SyncSheet.tsx`).

Real, confirmed gaps (none block field-testing, just worth knowing):
- Booth Mode: `restockThreshold`/`productionMinutes` only settable via CSV
  import, not the manual "Agregar producto" form.
- Booth Mode: no printable paper-fallback sheet (plan.md §12 calls for one as a
  dead-phone safety net).
- Booth Mode: the low-battery warning is a passive label — no wired "export now"
  action, though plan.md §12 specifies that exact shortcut.
- Forge Log: reopening Cost on an already-costed product doesn't reload its saved
  line items into the form — starts blank each time. Saving still correctly
  overwrites the existing record rather than duplicating it.
- Forge Log: photo captures from adjustments stay device-local — Storage upload
  is the one unbuilt piece of P2.

Deliberately out of scope for v1 (not gaps, already staged for later in
plan.md): Booth Mode multi-day carryover and push-based restock alerts (v1.5,
needs Firebase Cloud Messaging, a different product than what's set up now);
Forge Log Scrap Yard (v1.5) and Bench (v2); Stripe billing (P4); both apps' P5
Capacitor/store builds (explicitly gated on field-test results, see above).

Note: each `plan.md`'s own "Estado real" header (added earlier this session) was
written *before* the PWA and Firebase sync work below it, so it undersells the
current state — trust the README over that header for current status.

## Repo state

Both repos: `master`, pushed to `origin` (github.com/entropylink/{booth-mode,
forge-log}, both private). This session's commit adds `firebase.json` +
`.firebaserc` (Hosting config, previously untracked) and this file.
