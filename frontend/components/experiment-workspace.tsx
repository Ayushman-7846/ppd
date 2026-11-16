"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FlaskConical, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { ExperimentLab as DemoLaboratory } from "@/components/lab-tools";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { Busy, DEMO, DEMO_BASELINE, ModelParameters, ModelSelector, Problem, PromptSelector, StatusBadge, message, useModels } from "@/components/research-controls";
import { research, running, showStimulus, type Dataset, type Experiment, type Prompt, type Run, type Selection } from "@/lib/research-api";
import type { Dimension } from "@/lib/research";
import { useResearchPoll } from "@/components/research-poll";
import { ResultAudit, ResultVisualization } from "@/components/research-result";
import { useToast } from "@/components/toast";

export function ExperimentWorkspace() {
  return <ResearchAccess demo={<DemoLaboratory />}><ExperimentLab /></ResearchAccess>;
}

function ExperimentLab() {
  const [catalog, setCatalog] = useState<Dataset[]>();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>();
  const [historyPage, setHistoryPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [name, setName] = useState("");
  const [datasets, setDatasets] = useState<Dataset["id"][]>(["builtin:ambiguity"]);
  const [selections, setSelections] = useState<Selection[]>([DEMO]);
  const [promptIds, setPromptIds] = useState<Partial<Record<Dimension, number>>>({});
  const [repetitions, setRepetitions] = useState(1);
  const [showcase, setShowcase] = useState(false);
  const [runId, setRunId] = useState<number>();
  const [responseId, setResponseId] = useState<number>();
  const [review, setReview] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const { models, error: modelsError } = useModels();
  const getRun = useCallback((id: number, signal: AbortSignal) => research.run(id, runPage, signal), [runPage]);
  const poll = useResearchPoll(runId, getRun, revision);
  const result = useResearchPoll(responseId, research.result, revision);
  const toast = useToast();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("showcase") !== "1") return;
    setShowcase(true);
    setName("Showcase · Attachment reliability");
    setSelections([DEMO, DEMO_BASELINE]);
    setRepetitions(2);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([research.datasets(), research.prompts()]).then(([data, versions]) => {
      if (active) { setCatalog(data); setPrompts(versions); }
    }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    research.experiments(historyPage).then((records) => { if (active) setExperiments(records); },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [historyPage, historyRevision, poll.value?.state]);

  const chosen = (catalog ?? []).filter((entry) => datasets.includes(entry.id));
  const tasks = [...new Set(chosen.map((entry) => entry.dimension))];
  const size = chosen.reduce((total, entry) => total + entry.item_count, 0) * selections.length * repetitions;
  const selectionValid = selections.every((model) => !!model.model);
  const mixed = selections.some((model) => model.provider === "demo") && selections.some((model) => model.provider !== "demo");

  function choose(id: number) {
    setRunPage(1);
    setResponseId(undefined);
    setRunId(id);
  }

  function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!size || size > 160 || !selectionValid) {
      setError("Choose datasets, model identifiers, and repetitions totaling 1–160 requests.");
      return;
    }
    if (new Set(selections.map((value) => `${value.provider}|${value.model}`)).size !== selections.length) {
      setError("Choose each model only once.");
      return;
    }
    setReview(true);
  }

  async function start() {
    setWorking(true);
    setError("");
    try {
      const result = await research.start({ name, dataset_ids: datasets, selections, repetitions, prompt_ids: promptIds });
      choose(result.experiment_id);
      setReview(false);
      setHistoryPage(1);
      setHistoryRevision((value) => value + 1);
      toast("Experiment queued");
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  async function mutate(op: "cancel" | "retry") {
    if (!runId) return;
    setWorking(true);
    setError("");
    try {
      if (op === "cancel") await research.cancel(runId);
      else await research.retryRun(runId);
      setRevision((value) => value + 1);
      toast(op === "cancel" ? "Cancellation requested" : "Failed items requeued");
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  return <>
    <div className="lab-title"><div><h1>Experiment Laboratory</h1><p>Run versioned datasets across selected models and keep each trial’s output.</p></div></div>
    {showcase && <p className="research-note">Showcase preset · Curated demonstration. Review the 40-trial configuration before starting.</p>}
    <Problem error={error || modelsError} />
    <div className="studio-grid experiment-grid">
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>New experiment</h2><p>Choose up to four datasets and six models</p></div><FlaskConical size={19} /></div>
        <form className="research-form" onSubmit={inspect}>
          <fieldset disabled={working || review}><legend className="sr-only">Experiment specification</legend>
            <label>Experiment name<input required maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
            {catalog && <fieldset className="select-datasets"><legend>Datasets and dimensions</legend>
              {catalog.map((entry) => <label key={entry.id} className="check-field">
                <input type="checkbox" checked={datasets.includes(entry.id)} disabled={!datasets.includes(entry.id) && datasets.length >= 4}
                  onChange={(event) => setDatasets(event.target.checked ? [...datasets, entry.id] : datasets.filter((value) => value !== entry.id))} />
                <span>{entry.name}<small>{entry.dimension} · v{entry.version} · {entry.item_count} items</small></span>
              </label>)}
            </fieldset>}
            {!catalog && !error && <Busy text="Loading dataset catalog…" />}
            <label>Repetitions per item and model<input type="number" min={1} max={5} required value={repetitions || ""} onChange={(event) => setRepetitions(event.target.valueAsNumber || 0)} /></label>
            <div className="research-models">{selections.map((entry, index) => <fieldset key={index} className="model-row">
              <legend>Model {index + 1}</legend>
              <ModelSelector models={models} value={entry} onChange={(model) => setSelections(selections.map((value, i) => index === i ? model : value))} />
              <details><summary>Model parameters</summary>
                <ModelParameters provider={entry.provider} value={entry.parameters ?? {}}
                  onChange={(parameters) => setSelections(selections.map((value, i) => i === index ? { ...value, parameters } : value))} />
              </details>
              {selections.length > 1 && <Button variant="ghost" size="small" onClick={() => setSelections(selections.filter((_, i) => i !== index))}><Trash2 size={14} /> Remove model</Button>}
            </fieldset>)}</div>
            <Button variant="outline" size="small" disabled={selections.length >= 6} onClick={() => setSelections([...selections, DEMO])}><Plus size={14} /> Add model</Button>
            <details><summary>Prompt versions</summary>
              {tasks.map((dimension) => <div className="labeled-prompt" key={dimension}><small>{dimension}</small>
                <PromptSelector prompts={prompts} dimension={dimension} value={promptIds[dimension]}
                  onChange={(version) => setPromptIds({ ...promptIds, [dimension]: version })} />
              </div>)}
            </details>
          </fieldset>
          {!review && <Button type="submit" disabled={working || !catalog}>Review experiment</Button>}
        </form>
        {review && <section className="experiment-review" aria-label="Review settings">
          <h3>Review settings</h3><p><strong>{size}</strong> requests across {chosen.length} dataset{chosen.length === 1 ? "" : "s"} and {selections.length} model{selections.length === 1 ? "" : "s"}.</p>
          <div className="result-provenance">
            <span className="pill">{mixed ? "Mixed demo and live" : selections[0].provider === "demo" ? "Curated demo profiles" : "Live providers"}</span>
            <span className="pill">{repetitions} repetition{repetitions === 1 ? "" : "s"}</span>
          </div>
          <ul>{selections.map((model, index) => <li key={index}>{model.model} · {model.provider}</li>)}</ul>
          <div className="research-actions"><Button onClick={start} disabled={working}><Play size={16} /> Start experiment</Button>
            <Button variant="outline" onClick={() => setReview(false)} disabled={working}>Edit settings</Button></div>
        </section>}
      </section>
      <div className="experiment-monitor">
        <section className="surface dashboard-panel">
          <div className="panel-heading"><div><h2>Run monitor</h2><p>Persisted model and item progress</p></div></div>
          <Problem error={poll.error} />
          {poll.error && <Button variant="outline" onClick={poll.retry}>Reconnect</Button>}
          {!runId && <div className="empty-state">Start an experiment or select a saved run.</div>}
          {runId && !poll.value && !poll.error && <Busy text="Loading run…" />}
          {poll.value && <RunMonitor run={poll.value} page={runPage} setPage={setRunPage} busy={working}
            onCancel={() => mutate("cancel")} onRetry={() => mutate("retry")} onResponse={setResponseId} />}
        </section>
        <section className="surface dashboard-panel">
          <div className="panel-heading"><div><h2>Experiment history</h2><p>Saved batch manifests and results</p></div></div>
          <div className="research-list">{experiments?.map((entry) => <button type="button" key={entry.id} onClick={() => choose(entry.id)} aria-pressed={entry.id === runId}>
            <strong>{entry.name}</strong><StatusBadge state={entry.state} />
          </button>)}</div>
          {!experiments?.length && !error && <p className="empty-state">No batch runs on this page.</p>}
          {(historyPage > 1 || experiments?.length === 20) && <div className="research-actions pagination">
            <Button size="small" variant="outline" disabled={historyPage === 1} onClick={() => setHistoryPage((state) => state - 1)}>Previous</Button>
            <Button size="small" variant="outline" disabled={experiments?.length !== 20} onClick={() => setHistoryPage((state) => state + 1)}>Next</Button>
          </div>}
        </section>
      </div>
    </div>
    {responseId && <section className="surface dashboard-panel">
      <div className="panel-heading"><div><h2>Trial response</h2><p>Inspect the stored output and exact execution details</p></div>
        <Button size="small" variant="outline" onClick={() => setResponseId(undefined)}>Close response</Button></div>
      <Problem error={result.error} />
      {result.error && <Button size="small" variant="outline" onClick={result.retry}>Reconnect</Button>}
      {result.value ? <div className="tree-pair"><ResultVisualization result={result.value} /><ResultAudit result={result.value} /></div> :
        !result.error && <Busy text="Loading response…" />}
    </section>}
    <details className="surface prior-demo"><summary>Open the Phase 1 practice laboratory</summary><DemoLaboratory /></details>
  </>;
}

function RunMonitor({ run, page, setPage, busy, onCancel, onRetry, onResponse }:
  { run: Run; page: number; setPage: (value: number) => void; busy: boolean; onCancel: () => void; onRetry: () => void; onResponse: (id: number) => void }) {
  const total = Object.values(run.counts).reduce((value, count) => value + count, 0);
  const terminal = (run.counts.completed ?? 0) + (run.counts.failed ?? 0) + (run.counts.cancelled ?? 0);
  return <>
    <div className="progress-heading"><h3>{run.name}</h3><StatusBadge state={run.state} /></div>
    <label className="run-progress">Settled trials {terminal} / {total}<progress value={terminal} max={total || 1} /></label>
    <div className="result-provenance">{Object.entries(run.counts).map(([state, count]) => <span className="pill" key={state}>{count} {state}</span>)}</div>
    <div className="research-actions">
      {running(run.state) && <Button size="small" variant="outline" disabled={busy || (run.counts.cancelled ?? 0) > 0} onClick={onCancel}><Square size={14} /> Cancel remaining trials</Button>}
      {!running(run.state) && !!run.counts.failed && <Button size="small" variant="outline" disabled={busy} onClick={onRetry}><RotateCcw size={14} /> Retry failed trials</Button>}
    </div>
    <div className="research-list run-models">{run.models.map((entry) => <div key={`${entry.provider}|${entry.model}`}>
      <strong>{entry.model} · {entry.provider === "demo" ? "Demo" : entry.provider}</strong>
      <small>{Object.entries(entry.counts).map(([state, count]) => `${count} ${state}`).join(" · ")}</small>
    </div>)}</div>
    <div className="table-scroll"><table>
      <thead><tr><th>Item</th><th>Model / trial</th><th>Status</th></tr></thead>
      <tbody>{run.responses.items.map((item) => <tr key={item.id}>
        <th scope="row" className="history-stimulus"><button className="text-link" type="button" onClick={() => onResponse(item.id)}>{item.item_key}</button>
          <small title={showStimulus(item.stimulus)}>{showStimulus(item.stimulus)}</small></th>
        <td>{item.model} / {item.trial}</td><td><StatusBadge state={item.state} />{item.error && <small className="trial-error">{item.error}</small>}</td>
      </tr>)}</tbody>
    </table></div>
    {run.responses.total > run.responses.page_size && <div className="research-actions pagination">
      <Button size="small" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span>Page {page}</span>
      <Button size="small" variant="outline" disabled={page * run.responses.page_size >= run.responses.total} onClick={() => setPage(page + 1)}>Next</Button>
    </div>}
    <details className="result-audit"><summary>Reproducibility manifest</summary><pre>{JSON.stringify(run.protocol, null, 2)}</pre></details>
  </>;
}
