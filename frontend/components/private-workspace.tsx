"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Database, FlaskConical, LoaderCircle, LockKeyhole, LogOut } from "lucide-react";
import { api, ApiError, type Profile, type Workspace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";

type State =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "error"; message: string }
  | { kind: "signed-in"; profile: Profile; overview: Workspace };

const messageFor = (error: unknown) => error instanceof ApiError ? error.message : "The API could not be reached. Try again.";

export function PrivateWorkspace() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState("");
  const toast = useToast();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const profile = await api.profile(controller.signal);
        const overview = await api.workspace(controller.signal);
        if (!controller.signal.aborted) setState({ kind: "signed-in", profile, overview });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) setState({ kind: "guest" });
        else setState({ kind: "error", message: messageFor(error) });
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  function reload() {
    setState({ kind: "loading" });
    setRevision((value) => value + 1);
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setWorking(true);
    setFormError("");
    try {
      await api.authenticate(mode, {
        name: mode === "register" ? String(fields.get("name")) : undefined,
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      toast(mode === "register" ? "Researcher account created" : "Signed in");
      reload();
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    setWorking(true);
    setFormError("");
    try {
      await api.logout();
      setMode("login");
      setState({ kind: "guest" });
      toast("Signed out");
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setWorking(false);
    }
  }

  if (state.kind === "loading") return <section className="surface dashboard-panel" role="status"><div className="skeleton" /><p>Checking your session…</p></section>;
  if (state.kind === "error") return <section className="surface dashboard-panel"><h1>Workspace unavailable</h1><p role="alert">{state.message}</p><Button onClick={reload}>Try again</Button></section>;

  if (state.kind === "guest") return <section className="surface dashboard-panel auth-card">
    <span className="dimension-icon accent-cyan"><LockKeyhole size={23} /></span>
    <h1>{mode === "login" ? "Sign in to LinguaLens" : "Create a researcher account"}</h1>
    <p>Open your private workspace and view your research activity.</p>
    <form onSubmit={authenticate}>
      {mode === "register" && <label htmlFor="name">Name<input id="name" name="name" autoComplete="name" required maxLength={100} /></label>}
      <label htmlFor="email">Email<input id="email" name="email" autoComplete="email" type="email" required maxLength={254} /></label>
      <div className="auth-field"><label htmlFor="password">Password</label><input key={mode} id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
        required minLength={mode === "register" ? 12 : 1} maxLength={128} aria-describedby={mode === "register" ? "password-hint" : undefined} />
        {mode === "register" && <small id="password-hint">Use at least 12 characters.</small>}
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <Button type="submit" disabled={working}>{working && <LoaderCircle size={16} className="spinner" />}{mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={16} /></Button>
    </form>
    <button type="button" className="text-link" disabled={working} onClick={() => { setMode(mode === "login" ? "register" : "login"); setFormError(""); }}>
      {mode === "login" ? "Create a researcher account" : "Back to sign in"}
    </button>
  </section>;

  const { profile, overview } = state;
  return <>
    <div className="lab-title"><div><span className="pill">Private workspace</span><h1>My workspace</h1><p>{profile.name} · {profile.email} · {profile.role}</p></div><Button variant="outline" disabled={working} onClick={logout}><LogOut size={16} /> Sign out</Button></div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="metric-grid private-metrics">{[
      { label: "Datasets", value: overview.datasets, icon: Database },
      { label: "Experiments", value: overview.experiments, icon: FlaskConical },
      { label: "Evaluations", value: overview.evaluations, icon: ClipboardCheck },
    ].map(({ label, value, icon: Icon }) => <article className="surface metric-card" key={label}><div><span>{label}</span><Icon size={19} /></div><strong>{value}</strong></article>)}</div>
    <section className="surface dashboard-panel"><div className="panel-heading"><div><h2>Recent experiments</h2><p>Records from your research account</p></div></div>
      {overview.recent.length > 0 ? <ul className="workspace-list">{overview.recent.map((item) => <li key={item.id}>{item.name}<span className="pill">{item.state}</span></li>)}</ul> :
        <div className="empty-state"><p>No saved experiments yet.</p><Button asChild variant="outline"><Link href="/lab/experiments">Open the experiment lab <ArrowRight size={15} /></Link></Button></div>}
    </section>
  </>;
}
