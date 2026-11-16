"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ClipboardCheck, ListChecks, RotateCcw, Scale, Users } from "lucide-react";
import { api, type Profile } from "@/lib/api";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { Busy, DEMO, ModelSelector, Problem, message, useModels } from "@/components/research-controls";
import { research, showStimulus, type Run, type Selection } from "@/lib/research-api";
import { useToast } from "@/components/toast";
import { criteria, display, friendly, methods, science, type Assessment, type Criterion, type Rubric } from "@/lib/evaluation-api";
import { PageControls, RubricSelect, ScienceNotice, SectionTitle, useScienceOptions } from "@/components/science-controls";
import { ReviewQueue, DisputeQueue } from "@/components/review-queue";

const busyState = (state: Assessment["state"]) => state === "pending" || state === "processing";
const fields = Object.keys(criteria) as Criterion[];
const tabs = ["Automated evaluation", "Rubric versions", "Human review", "Disagreements", "Audit trail"] as const;

export function EvaluationCenter() {
  return <ResearchAccess><Workspace /></ResearchAccess>;
}

function Workspace() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Automated evaluation");
  const [profile, setProfile] = useState<Profile>();
  const [focus, setFocus] = useState<number>();
  const { options, rubrics, error } = useScienceOptions();
  const [created, setCreated] = useState<Rubric[]>([]);
  const available = [...created, ...rubrics];
  useEffect(() => {
    let active = true;
    api.profile().then((value) => { if (active) setProfile(value); }).catch(() => {});
    return () => { active = false; };
  }, []);

  return <div className="science-page">
    <div className="lab-title"><div><span className="eyebrow">EVALUATION AND REVIEW</span><h1>Evaluation Center</h1>
      <p>Inspect evidence, apply a rubric version, and review linguistic judgments.</p></div>
      <Button variant="outline" asChild><Link href="/lab/errors">Error Explorer</Link></Button></div>
    <div className="science-tabs" role="group" aria-label="Evaluation workspace views">
      {tabs.map((name) => <Button key={name} size="small" variant={name === tab ? "primary" : "outline"} aria-pressed={name === tab}
        onClick={() => setTab(name)}>{name}</Button>)}
    </div>
    <Problem error={error} />
    {tab === "Automated evaluation" && <Automated rubrics={available} experiments={options?.experiments ?? []} onAssign={(id) => { setFocus(id); setTab("Human review"); }} />}
    {tab === "Rubric versions" && <Rubrics rubrics={available} onSave={(rubric) => setCreated((rows) => [rubric, ...rows])} />}
    {tab === "Human review" && <ReviewQueue profile={profile} rubrics={available} focused={focus} />}
    {tab === "Disagreements" && <DisputeQueue profile={profile} rubrics={available} />}
    {tab === "Audit trail" && <AuditTrail />}
  </div>;
}

function Automated({ rubrics, experiments, onAssign }: {
  rubrics: Rubric[]; experiments: { id: number; name: string }[]; onAssign: (id: number) => void;
}) {
  const [runId, setRunId] = useState<number>();
  const [runPage, setRunPage] = useState(1);
  const [run, setRun] = useState<Run>();
  const [chosen, setChosen] = useState<number[]>([]);
  const [rubric, setRubric] = useState<number>();
  const [method, setMethod] = useState<"deterministic" | "judge">("deterministic");
  const [judge, setJudge] = useState<Selection>(DEMO);
  const [results, setResults] = useState<Awaited<ReturnType<typeof science.assessments>>>();
  const [viewId, setViewId] = useState<number>();
  const [view, setView] = useState<Assessment>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const { models, error: modelError } = useModels();
  const toast = useToast();

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const selected = Number(search.get("experiment"));
    const assessment = Number(search.get("assessment"));
    if (selected) setRunId(selected);
    if (assessment) setViewId(assessment);
  }, []);

  useEffect(() => {
    if (!runId) return;
    const control = new AbortController();
    research.run(runId, runPage, control.signal).then((value) => { if (!control.signal.aborted) setRun(value); },
      (reason) => { if (!control.signal.aborted) setError(message(reason)); });
    return () => control.abort();
  }, [runId, runPage]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [history, detail] = await Promise.all([science.assessments({ experiment_id: runId, page }),
          viewId ? science.assessment(viewId) : null]);
        if (!active) return;
        setResults(history);
        if (detail) setView(detail);
        if (history.items.some((entry) => busyState(entry.state)) || (detail && busyState(detail.state))) {
          timer = setTimeout(() => void refresh(), 950);
        }
      } catch (reason) { if (active) setError(message(reason)); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [runId, page, revision, viewId]);

  const liveModels = models.filter((option) => option.provider !== "demo");
  const chosenModel = liveModels.length && judge.provider === "demo" ? { provider: liveModels[0].provider, model: liveModels[0].model || undefined } as Selection : judge;
  const rubricId = rubric ?? rubrics.find((row) => row.name === "Standard linguistic rubric")?.id;
  const activeRun = run?.id === runId && run?.responses.page === runPage ? run : undefined;
  const selectable = activeRun?.responses.items.filter((row) => row.state === "completed" || (row.state === "failed" && !!row.preview)) ?? [];

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rubricId || !chosen.length) return;
    setWorking(true);
    setError("");
    try {
      const jobs = await science.runEvaluation({ response_ids: chosen, rubric_id: rubricId, method, judge: method === "judge" ? chosenModel : undefined });
      setPage(1);
      setViewId(jobs[0].id);
      setRevision((value) => value + 1);
      setChosen([]);
      toast(`${jobs.length} evaluation${jobs.length > 1 ? "s" : ""} queued`);
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  async function retry(id: number) {
    setError("");
    setWorking(true);
    try { setView(await science.retryEvaluation(id)); setRevision((value) => value + 1); toast("Evaluation retry queued"); }
    catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  return <>
    <ScienceNotice busy={false} error={error || modelError} />
    <div className="studio-grid">
      <section className="surface dashboard-panel">
        <SectionTitle title="Evaluate stored responses" note="Select eligible trials and a reproducible rubric." action={<ClipboardCheck size={19} />} />
        <form className="research-form" onSubmit={schedule}>
          <label>Experiment<select aria-label="Experiment" value={runId ?? ""} onChange={(event) => {
            setRunId(Number(event.target.value) || undefined); setRun(undefined); setRunPage(1); setPage(1); setChosen([]); setView(undefined); setViewId(undefined);
          }}><option value="">Choose an experiment</option>{experiments.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          {runId && !activeRun && !error && <Busy text="Loading saved trials…" />}
          {activeRun && <>
            {selectable.length > 0 ? <fieldset className="select-datasets"><legend>Responses</legend>
              {selectable.map((row) => <label className="check-field" key={row.id}>
                <input type="checkbox" checked={chosen.includes(row.id)} disabled={!chosen.includes(row.id) && chosen.length >= 80}
                  onChange={(event) => setChosen(event.target.checked ? [...chosen, row.id] : chosen.filter((id) => id !== row.id))} />
                <span>{row.item_key} · {row.model} · trial {row.trial}
                  <small>{showStimulus(row.stimulus).slice(0, 120)}</small></span></label>)}
            </fieldset> : <p className="empty-state">No stored output on this trial page.</p>}
            {!!selectable.length && <Button variant="outline" size="small" onClick={() =>
              setChosen((previous) => [...new Set([...previous, ...selectable.map((row) => row.id)])].slice(0, 80))}>Select eligible page</Button>}
            <PageControls page={runPage} total={activeRun.responses.total} size={activeRun.responses.page_size} change={setRunPage} />
          </>}
          <RubricSelect rubrics={rubrics} value={rubric} change={setRubric} />
          <label>Scoring mode<select aria-label="Scoring mode" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="deterministic">Deterministic checks</option><option value="judge">AI-assisted judge</option>
          </select></label>
          {method === "judge" && (liveModels.length ? <ModelSelector models={liveModels} value={chosenModel} onChange={setJudge} label="Separate judge model" /> :
            <Link href="/lab/settings" className="text-link">Configure a live judge model</Link>)}
          <Button type="submit" disabled={working || !rubricId || !chosen.length || (method === "judge" && !chosenModel.model)}>
            <ListChecks size={16} /> Run evaluation{chosen.length ? ` · ${chosen.length}` : ""}
          </Button>
        </form>
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Evaluation history" note="Scores are scoped to the selected rubric and method." />
        {results?.items.length ? <div className="research-list science-evaluation-list">{results.items.map((job) => <button key={job.id} type="button"
          aria-pressed={job.id === viewId} onClick={() => { setView(undefined); setViewId(job.id); }}>
          <strong>Response {job.response_id} · {methods[job.method]}</strong><small>{job.rubric.name} · v{job.rubric.version} · Attempt {job.attempt}</small>
          <span className={`pill status-${job.state === "processing" ? "running" : job.state}`}>{friendly(job.state)} · {display(job.score)}</span>
        </button>)}</div> : results ? <div className="empty-state">No evaluations match this experiment.</div> : <Busy text="Loading evaluation history…" />}
        {results && <PageControls page={page} total={results.total} size={results.page_size} change={setPage} />}
      </section>
    </div>
    {viewId && <section className="surface dashboard-panel">
      <SectionTitle title="Evaluation evidence" note={view ? `Response ${view.response_id} · ${methods[view.method]} · Attempt ${view.attempt}` : undefined}
        action={view && <div className="research-actions">
          <Button size="small" variant="outline" disabled={working || busyState(view.state) || view.attempt >= 4} onClick={() => retry(view.id)}><RotateCcw size={14} /> Retry</Button>
          <Button size="small" variant="outline" onClick={() => onAssign(view.response_id)}><Users size={14} /> Assign human review</Button>
        </div>} />
      {view ? <AssessmentEvidence view={view} /> : <Busy text="Opening evaluation…" />}
    </section>}
  </>;
}

function AssessmentEvidence({ view }: { view: Assessment }) {
  return <div className="result-audit">
    <div className="result-provenance"><span className="pill">{friendly(view.state)}</span>
      <span className="pill">Weighted score {display(view.score)}</span><span className="pill">Verdict {view.result.verdict ?? "unavailable"}</span></div>
    <Problem error={view.result.error ?? ""} />
    {view.judge && <p className="research-note">Judge {view.judge.provider} / {view.judge.model} · {view.judge.prompt_version} · Confidence {view.result.confidence ?? "unavailable"}</p>}
    {view.result.scores && <div className="table-scroll"><table><thead><tr><th>Criterion</th><th>Weight</th><th>Score</th><th>Evidence</th></tr></thead>
      <tbody>{fields.map((key) => <tr key={key}><th scope="row">{criteria[key]}</th><td>{view.rubric.weights[key]}%</td>
        <td>{display(view.result.scores?.[key])}</td><td className="science-wrap">{view.result.criteria?.[key]?.evidence ?? "See the recorded checks"}</td></tr>)}</tbody>
    </table></div>}
    {view.result.justification && <p>{view.result.justification}</p>}
    {view.result.assessment && <p>{view.result.assessment}</p>}
    {!!view.result.checks?.length && <details><summary>Reference and formal checks</summary><pre>{JSON.stringify(view.result.checks, null, 2)}</pre></details>}
    {!!view.result.errors?.length && <details><summary>Error suggestions</summary><pre>{JSON.stringify(view.result.errors, null, 2)}</pre></details>}
    {view.attempts?.map((attempt) => <details key={attempt.id}><summary>Attempt {attempt.number} · {friendly(attempt.state)} · {display(attempt.score)}</summary>
      <pre>{JSON.stringify(attempt.result, null, 2)}</pre>
      {attempt.raw_output && <pre>{attempt.raw_output}</pre>}
      {attempt.judge_prompt && <details><summary>Exact judge prompt</summary><pre>{attempt.judge_prompt}</pre></details>}
    </details>)}
  </div>;
}

function Rubrics({ rubrics, onSave }: { rubrics: Rubric[]; onSave: (value: Rubric) => void }) {
  const standard = rubrics.find((row) => row.name === "Standard linguistic rubric");
  const [base, setBase] = useState<Rubric>();
  const template = base ?? standard;
  const [name, setName] = useState("");
  const [weights, setWeights] = useState<Rubric["weights"]>();
  const [descriptions, setDescriptions] = useState<Rubric["criteria"]>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const chosen = weights ?? template?.weights;
  const notes = descriptions ?? template?.criteria;
  const sum = chosen ? Object.values(chosen).reduce((a, b) => a + b, 0) : 0;
  const toast = useToast();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || !notes) return;
    setWorking(true);
    setError("");
    try {
      const row = await science.saveRubric({ name, weights: chosen, criteria: notes });
      onSave(row); setBase(row); toast(`Rubric version ${row.version} saved`);
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  return <div className="studio-grid">
    <section className="surface dashboard-panel"><SectionTitle title="Rubric library" note="Published versions retain their weights." action={<Scale size={19} />} />
      <div className="research-list">{rubrics.map((row) => <button key={row.id} type="button" aria-pressed={row.id === template?.id} onClick={() => {
        setBase(row); setWeights(undefined); setDescriptions(undefined); setName(row.name === "Standard linguistic rubric" ? "" : row.name);
      }}><strong>{row.name}</strong><small>Version {row.version}</small></button>)}</div>
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Save a rubric version" note="All weights must total 100. Use zero to exclude a criterion from the weighted total." />
      <Problem error={error} />
      {chosen && notes ? <form className="research-form" onSubmit={save}>
        <label>Rubric name<input required maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {fields.map((key) => <div className="science-rubric-row" key={key}>
          <label>{criteria[key]} weight<input type="number" min={0} max={100} step=".01" required value={chosen[key]}
            onChange={(event) => setWeights({ ...chosen, [key]: event.target.valueAsNumber || 0 })} /></label>
          <label>{criteria[key]} guidance<textarea rows={2} required maxLength={1800} value={notes[key]}
            onChange={(event) => setDescriptions({ ...notes, [key]: event.target.value })} /></label>
        </div>)}
        <div className="research-actions"><span className="pill">Total {display(sum, "%")}</span>
          <Button type="submit" disabled={working || Math.abs(sum - 100) > 1e-8}>Save rubric version</Button></div>
      </form> : <Busy text="Loading the standard rubric…" />}
    </section>
  </div>;
}

function AuditTrail() {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof science.audit>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    science.audit(page).then((value) => { if (active) setRows(value); }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [page]);
  return <section className="surface dashboard-panel">
    <SectionTitle title="Research audit trail" note="Recorded changes to evaluations, reviews, and exports." />
    <ScienceNotice busy={!rows && !error} error={error} />
    {rows?.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Actor ID</th><th>Record ID</th><th>Time</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{friendly(row.action)}</th><td>{row.actor_id}</td><td>{row.target_id}</td>
        <td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : rows && <div className="empty-state">No recorded changes yet.</div>}
    <PageControls page={page} hasNext={rows?.length === 30} size={30} change={setPage} />
  </section>;
}
