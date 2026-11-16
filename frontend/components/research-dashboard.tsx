"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BarChart3, ClipboardCheck, FlaskConical, Repeat2 } from "lucide-react";
import { Dashboard } from "@/components/dashboard";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { message } from "@/components/research-controls";
import { Population, ScoreCard, ScienceNotice, SectionTitle } from "@/components/science-controls";
import { friendly, methods, science, type ResearchOverview } from "@/lib/evaluation-api";

export function ResearchDashboard() {
  return <ResearchAccess demo={<Dashboard />}><Overview /></ResearchAccess>;
}

function Overview() {
  const [state, setState] = useState<ResearchOverview>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    science.dashboard().then((data) => { if (active) { setState(data); setError(""); } },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [revision]);
  return <div className="science-page">
    <div className="lab-title"><div><Population kind="live" /><h1>Research Dashboard</h1><p>Track your live experiments, evaluation coverage, and scientific outputs.</p></div>
      <Button asChild><Link href="/lab/experiments"><FlaskConical size={17} /> Open experiment lab</Link></Button></div>
    <ScienceNotice busy={!state && !error} error={error} />
    {error && <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Reload dashboard</Button>}
    {state && <>
      {state.warning && <p role="status" className="research-note science-caution">{state.warning}</p>}
      <div className="metric-grid">
        <ScoreCard label="Recorded live experiments" value={state.experiments} />
        <ScoreCard label="Responses evaluated at least once" value={state.evaluated} />
        <ScoreCard label="Human reviews pending" value={state.pending_reviews} />
        <ScoreCard label="Mean structural agreement" value={state.repeats.structure} suffix="%" />
      </div>
      <div className="science-chart-grid">
        <section className="surface dashboard-panel"><SectionTitle title="Latest evaluations" note="Recent live evaluation jobs across rubrics" action={<ClipboardCheck size={18} />} />
          {state.recent.length ? <div className="evaluation-list">{state.recent.map((row) =>
            <Link href={`/lab/evaluation?assessment=${row.id}`} key={row.id}>Response {row.response_id} · {methods[row.method]}<span className="pill">{friendly(row.state)}</span></Link>)}</div> :
            <div className="empty-state">No live evaluations yet.</div>}
        </section>
        <section className="surface dashboard-panel"><SectionTitle title="Best observed by task" note={`${methods[state.method]} · ${state.rubric.name} v${state.rubric.version}`} action={<BarChart3 size={18} />} />
          {state.best.length ? <div className="research-list">{state.best.map((row) => <div key={row.task}><strong>{row.task} · {row.model}</strong><small>{row.score}</small></div>)}</div> :
            <div className="empty-state">No eligible ranking in this cohort. Select a scored rubric in Model Comparison.</div>}
        </section>
        <section className="surface dashboard-panel"><SectionTitle title="Recent cohort snapshots" note="Private comparison and consistency activity" action={<Repeat2 size={18} />} />
          {state.snapshots.length ? <div className="evaluation-list">{state.snapshots.map((row) => <Link key={row.id} href={`/lab/${row.kind}?snapshot=${row.id}`}>
            {friendly(row.kind)} {row.id} · {row.filters.population}<ArrowUpRight size={14} /></Link>)}</div> : <p className="empty-state">No saved cohort snapshots.</p>}
        </section>
        <section className="surface dashboard-panel"><SectionTitle title="Recent reports" note="Saved research exports" />
          {state.reports.length ? <div className="evaluation-list">{state.reports.map((row) => <Link key={row.id} href={`/lab/reports?report=${row.id}`}>
            {row.title} · {row.population}<ArrowUpRight size={14} /></Link>)}</div> : <p className="empty-state">No research reports yet.</p>}
        </section>
      </div>
    </>}
    <details className="surface prior-demo"><summary>Open Phase 1 synthetic dashboard</summary><Dashboard /></details>
  </div>;
}
