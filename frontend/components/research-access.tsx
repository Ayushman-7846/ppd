"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function ResearchAccess({ children, demo }: { children: ReactNode; demo?: ReactNode }) {
  const [state, setState] = useState<"checking" | "guest" | "ready" | "unavailable">("checking");
  const [revision, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.profile(controller.signal).then(() => setState("ready"), (error: unknown) => {
      if (!controller.signal.aborted) setState(error instanceof ApiError && error.status === 401 ? "guest" : "unavailable");
    });
    return () => controller.abort();
  }, [revision]);

  if (state === "ready") return children;
  if (state === "checking" && !demo) return <p role="status" className="inline-status"><LoaderCircle className="spinner" size={18} /> Checking your researcher session…</p>;
  return <>
    {state !== "checking" && <section className="surface research-gate">
      <span className="dimension-icon accent-cyan"><LockKeyhole size={19} /></span>
      <div><h2>{state === "guest" ? "Open your research workspace" : "Research API unavailable"}</h2>
        <p>{state === "guest" ? "Sign in to execute and save analyses, use live models, or run the curated demo models." : "Check that the backend is running to open saved research."}</p></div>
      {state === "guest" ? <Button asChild variant="outline"><Link href="/workspace">Sign in <ArrowRight size={15} /></Link></Button> :
        <Button variant="outline" onClick={() => { setState("checking"); reload((value) => value + 1); }}>Retry connection</Button>}
    </section>}
    {demo}
  </>;
}
