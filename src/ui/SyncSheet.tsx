// Sync setup + control. Three states: unconfigured → paste the Firebase config;
// configured but signed out → sign in; signed in → sync now.
//
// Everything is optional. With no config the app is exactly the offline app it
// was; this sheet is the only place the network is ever touched.

import { useEffect, useState, type ReactNode } from "react";
import {
  clearFirebaseConfig,
  isConfigured,
  saveFirebaseConfig,
  type User,
} from "../lib/firebase";
import {
  lastSyncAt,
  signInEmail,
  signInGoogle,
  signOutUser,
  signUpEmail,
  syncNow,
  watchAuth,
} from "../lib/sync-store";
import { Sheet, useT } from "./common";

export function SyncSheet({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const [configured, setConfigured] = useState(isConfigured());
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    void watchAuth((u) => {
      setUser(u);
      setReady(true);
    }).then((fn) => (unsub = fn));
    return () => unsub();
  }, [configured]);

  return (
    <Sheet title={t("sync.title")} onClose={onClose}>
      {!configured ? (
        <ConfigStep
          onSaved={() => setConfigured(true)}
        />
      ) : !ready ? (
        <p className="muted">{t("app.loading")}</p>
      ) : user ? (
        <SignedIn user={user} onSignOut={() => setUser(null)} />
      ) : (
        <SignIn />
      )}

      {configured ? (
        <button
          className="btn sm ghost danger"
          style={{ marginTop: 16 }}
          onClick={() => {
            clearFirebaseConfig();
            setConfigured(false);
          }}
        >
          {t("sync.disconnect")}
        </button>
      ) : null}
    </Sheet>
  );
}

function ConfigStep({ onSaved }: { onSaved: () => void }): ReactNode {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack">
      <p className="faint">{t("sync.configHint")}</p>
      <textarea
        value={text}
        placeholder={'{\n  "apiKey": "…",\n  "authDomain": "…",\n  "projectId": "…",\n  "appId": "…"\n}'}
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: 140, fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem" }}
      />
      {error ? <p className="error">{error}</p> : null}
      <button
        className="btn primary block"
        onClick={() => {
          const err = saveFirebaseConfig(text);
          if (err) setError(err);
          else onSaved();
        }}
      >
        {t("sync.saveConfig")}
      </button>
    </div>
  );
}

function SignIn(): ReactNode {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="sy-email">{t("sync.email")}</label>
        <input
          id="sy-email"
          type="text"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor="sy-pass">{t("sync.password")}</label>
        <input
          id="sy-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn grow"
          disabled={busy}
          onClick={() => void run(() => signUpEmail(email, password))}
        >
          {t("sync.signUp")}
        </button>
        <button
          className="btn grow primary"
          disabled={busy}
          onClick={() => void run(() => signInEmail(email, password))}
        >
          {t("sync.signIn")}
        </button>
      </div>
      <button className="btn block ghost" disabled={busy} onClick={() => void run(signInGoogle)}>
        {t("sync.google")}
      </button>
    </div>
  );
}

function SignedIn({ user, onSignOut }: { user: User; onSignOut: () => void }): ReactNode {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const last = lastSyncAt();

  async function doSync(): Promise<void> {
    setBusy(true);
    setResult(null);
    const outcome = await syncNow();
    setBusy(false);
    if (outcome.ok) {
      const r = outcome.report;
      setResult(t("sync.result", { pulled: r.pulled, pushed: r.pushed }));
    } else {
      setResult(outcome.reason === "error" ? outcome.error ?? "error" : outcome.reason);
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="muted">{user.email ?? user.uid}</span>
        <button
          className="btn sm ghost"
          onClick={async () => {
            await signOutUser();
            onSignOut();
          }}
        >
          {t("sync.signOut")}
        </button>
      </div>

      <button className="btn primary block huge" disabled={busy} onClick={() => void doSync()}>
        {busy ? t("sync.syncing") : t("sync.syncNow")}
      </button>

      {result ? <p className="faint" style={{ textAlign: "center" }}>{result}</p> : null}
      {last ? (
        <p className="faint" style={{ textAlign: "center" }}>
          {t("sync.lastSync", { when: new Date(last).toLocaleString() })}
        </p>
      ) : null}
    </div>
  );
}
