"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { FlaskConical, GitCompareArrows, Play, Upload } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { LabExample } from "@/components/lab-example";
import { dimensions, type Dimension } from "@/lib/research";
import { research, running, showStimulus, type Analysis, type Dataset, type DatasetDetail, type Item, type PhoneRow, type Prompt, type Selection } from "@/lib/research-api";
import { Busy, DEMO, ModelParameters, ModelSelector, Problem, PromptSelector, message, useModels } from "@/components/research-controls";
import { Button } from "@/components/ui/button";
import { PhoneInput, cleanPhone } from "@/components/phone-input";
import { AnalysisHistory } from "@/components/analysis-history";
import { ResultAudit, ResultVisualization } from "@/components/research-result";
import { useResearchPoll } from "@/components/research-poll";
import { useToast } from "@/components/toast";

const categories = {
  recursion: ["adjectival", "possessive", "prepositional", "clausal", "center embedding"],
  movement: ["wh-movement", "auxiliary inversion", "passive", "topicalization", "relative clause", "raising"],
  ambiguity: [], phonology: [],
};

export function ResearchAnalyzer({ dimension }: { dimension: Dimension }) {
  return <ResearchAccess demo={<LabExample dimension={dimension} />}><Analyzer dimension={dimension} /></ResearchAccess>;
}

function Analyzer({ dimension }: { dimension: Dimension }) {
  const task = dimensions.find((item) => item.id === dimension)!;
  const { models, error: modelError } = useModels();
  const [source, setSource] = useState<"dataset" | "manual">("dataset");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState<string | number>();
  const [dataset, setDataset] = useState<DatasetDetail>();
  const [item, setItem] = useState("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [prompt, setPrompt] = useState<number>();
  const [selection, setSelection] = useState<Selection>(DEMO);
  const [sentence, setSentence] = useState("");
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<PhoneRow[]>([{ word_id: "w1", surface: "" }]);
  const [phones, setPhones] = useState("");
  const [imports, setImports] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [responseId, setResponseId] = useState<number>();
  const [compareId, setCompareId] = useState<number>();
  const [historyRevision, setHistoryRevision] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const toast = useToast();
  const visual = useRef<HTMLElement>(null);
  const poll = useResearchPoll(responseId, research.result);
  const comparison = useResearchPoll(compareId, research.result);
  const result = poll.value;
  const busy = submitting || (!!responseId && !poll.error && (!result || running(result.state)));

  useEffect(() => {
    let active = true;
    Promise.all([research.datasets(dimension), research.prompts(dimension)]).then(([data, versions]) => {
      if (!active) return;
      setDatasets(data);
      setDatasetId(data.find((entry) => entry.kind === "builtin")?.id ?? data[0]?.id);
      setPrompts(versions);
    }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [dimension]);

  useEffect(() => {
    if (datasetId === undefined) return;
    let active = true;
    research.dataset(datasetId).then((data) => {
      if (active) { setDataset(data); setItem(data.items[0]?.item_key ?? ""); }
    }, (reason) => { if (active) setError(message(reason)); })
      .finally(() => { if (active) setLoadingSource(false); });
    return () => { active = false; };
  }, [datasetId]);

  useEffect(() => {
    if (result && !running(result.state)) {
      setHistoryRevision((value) => value + 1);
      if (result.state === "completed") toast("Analysis saved to history");
    }
  }, [result, toast]);

  function useItem(selected: Item) {
    setSentence(selected.stimulus.sentence ?? "");
    setCategory(selected.stimulus.category ?? "");
    setRows(selected.stimulus.rows?.length ? selected.stimulus.rows : [{ word_id: "w1", surface: "" }]);
    setPhones(selected.stimulus.phones_of_interest?.join(" ") ?? "");
    setSource("manual");
  }

  async function upload(file: File) {
    setError("");
    setLoadingSource(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("dimension", dimension);
      const data = await research.previewImport(form);
      setImports(data);
      useItem(data[0]);
      toast(`Loaded ${data.length} item${data.length === 1 ? "" : "s"} for editing`);
    } catch (reason) { setError(message(reason)); }
    finally { setLoadingSource(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let data: Analysis;
      if (source === "dataset") {
        if (!dataset || !item) throw new Error("Select a dataset item.");
        data = { dataset_id: dataset.id, item_key: item };
      } else {
        data = { stimulus: dimension === "phonology"
          ? { rows: rows.map(cleanPhone), phones_of_interest: phones.split(/\s+/).filter(Boolean) }
          : { sentence, category: category || undefined } };
      }
      const queued = await research.analyze(dimension, data, selection, prompt);
      setResponseId(queued.response_id!);
      setCancelled(false);
    } catch (reason) { setError(message(reason)); }
    finally { setSubmitting(false); }
  }

  async function rerun(id: number) {
    setError("");
    setSubmitting(true);
    try {
      const queued = await research.retryResponse(id);
      setResponseId(queued.response_id!);
      setCancelled(false);
      visual.current?.scrollIntoView({ block: "nearest" });
    } catch (reason) { setError(message(reason)); }
    finally { setSubmitting(false); }
  }

  async function remove(id: number) {
    setError("");
    try {
      await research.removeResponse(id);
      if (responseId === id) setResponseId(undefined);
      if (compareId === id) setCompareId(undefined);
      setHistoryRevision((value) => value + 1);
      toast("Response removed from history");
    } catch (reason) { setError(message(reason)); }
  }

  async function cancel() {
    if (!result) return;
    try { await research.cancel(result.experiment_id); setCancelled(true); }
    catch (reason) { setError(message(reason)); }
  }

  const selectedItem = dataset?.items.find((entry) => entry.item_key === item);

  return <>
    <div className="lab-title">
      <div><span className={selection.provider === "demo" ? "pill pill-demo" : "pill status-running"}>
        {selection.provider === "demo" ? (selection.model === "lingualens-baseline" ? "Demo execution · Simplified baseline" : "Demo execution · Curated reference") : "Live execution"}
      </span><h1>{task.label}</h1><p>{task.question}</p></div>
      <Button variant="outline" asChild><Link href="/lab/settings">AI Model Configuration</Link></Button>
    </div>
    <Problem error={error || modelError} />
    <div className="research-workbench">
      <section className="surface dashboard-panel research-input-panel">
        <div className="panel-heading"><div><h2>Input and model</h2><p>Choose a stimulus and an execution protocol</p></div></div>
        <form onSubmit={submit} className="research-form">
          <fieldset disabled={busy}><legend className="sr-only">Analysis parameters</legend>
            <label>Input source<select aria-label="Input source" value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
              <option value="dataset">Dataset item</option><option value="manual">Manual input</option>
            </select></label>
            {source === "dataset" ? <>
              <label>Dataset<select aria-label="Dataset" value={datasetId ?? ""} onChange={(event) => {
                setLoadingSource(true); setDataset(undefined); setItem(""); setDatasetId(event.target.value);
              }}>
                <option value="" disabled>Select a dataset</option>
                {datasets.map((entry) => <option value={entry.id} key={entry.id}>{entry.name} · v{entry.version}</option>)}
              </select></label>
              {loadingSource && <Busy text="Loading dataset…" />}
              {dataset && <label>Example item<select aria-label="Example item" value={item} onChange={(event) => setItem(event.target.value)}>
                {dataset.items.map((entry) => <option value={entry.item_key} key={entry.item_key}>
                  {entry.stimulus.sentence || `${entry.item_key} · ${entry.stimulus.phones_of_interest?.join(" ") ?? "Phonological dataset"}`}
                </option>)}
              </select></label>}
              {selectedItem && <div className="input-preview"><p>{showStimulus(selectedItem.stimulus)}</p>
                <Button size="small" variant="outline" onClick={() => useItem(selectedItem)}>Edit as custom input</Button></div>}
            </> : dimension === "phonology" ? <>
              <label className="file-label"><Upload size={15} /> Load CSV or JSON for editing<input type="file" accept=".csv,.json" disabled={loadingSource} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }} /></label>
              {imports.length > 1 && <label>Imported item<select aria-label="Imported item" defaultValue={imports[0].item_key} onChange={(event) => {
                const chosen = imports.find((entry) => entry.item_key === event.target.value);
                if (chosen) useItem(chosen);
              }}>{imports.map((entry) => <option key={entry.item_key}>{entry.item_key}</option>)}</select></label>}
              <PhoneInput rows={rows} setRows={setRows} phones={phones} setPhones={setPhones} disabled={busy} />
            </> : <>
              <label>Sentence<textarea rows={4} maxLength={1800} required value={sentence} onChange={(event) => setSentence(event.target.value)} /></label>
              {categories[dimension].length > 0 && <label>Category hint<select aria-label="Category hint" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Infer category</option>
                {categories[dimension].map((value) => <option key={value}>{value}</option>)}
              </select></label>}
            </>}
            <ModelSelector models={models} value={selection} onChange={setSelection} />
            <details><summary>Advanced settings</summary>
              <PromptSelector prompts={prompts} dimension={dimension} value={prompt} onChange={setPrompt} />
              <ModelParameters provider={selection.provider} value={selection.parameters ?? {}} onChange={(parameters) => setSelection({ ...selection, parameters })} />
            </details>
          </fieldset>
          <Button type="submit" disabled={busy || loadingSource || (source === "dataset" && !selectedItem)}><Play size={16} /> Analyze</Button>
          {selection.provider === "demo" && <p className="research-hint">Demo profiles use authored outputs for matching teaching examples.</p>}
          {result && running(result.state) && <Button variant="outline" disabled={cancelled} onClick={cancel}>{cancelled ? "Cancellation requested" : "Cancel analysis"}</Button>}
        </form>
      </section>
      <section className="surface dashboard-panel" ref={visual}>
        <div className="panel-heading"><div><h2>Visual analysis</h2><p>Inspect the structures and proposed explanation</p></div><FlaskConical size={19} /></div>
        {busy && <Busy text={result?.state === "running" ? "Analyzing linguistic input…" : "Waiting for the research worker…"} />}
        <Problem error={poll.error} />
        {poll.error && <Button variant="outline" onClick={poll.retry}>Reconnect</Button>}
        {result && !running(result.state) && <ResultVisualization result={result} />}
        {!busy && !result && !poll.error && <div className="empty-state">Submit an analysis or open a saved response.</div>}
      </section>
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Execution and validation</h2><p>Inspect provenance, raw text, and structural checks</p></div></div>
        {result ? <ResultAudit result={result} /> : <div className="empty-state">Execution details appear here when a response is saved.</div>}
      </section>
    </div>
    <AnalysisHistory dimension={dimension} revision={historyRevision} current={responseId}
      onOpen={(id) => { setResponseId(id); setCancelled(false); visual.current?.scrollIntoView({ block: "nearest" }); }}
      onCompare={setCompareId} onRerun={rerun} onRemove={remove} />
    {compareId && <section className="surface dashboard-panel">
      <div className="panel-heading"><div><h2><GitCompareArrows size={18} /> Compare saved analyses</h2></div>
        <Button size="small" variant="outline" onClick={() => setCompareId(undefined)}>Close comparison</Button></div>
      <Problem error={comparison.error} />
      {comparison.error && <Button size="small" variant="outline" onClick={comparison.retry}>Reconnect</Button>}
      {comparison.value && result ? <div className="tree-pair">
        <div><h3>Current response</h3><ResultVisualization result={result} /></div>
        <div><h3>Saved response</h3><ResultVisualization result={comparison.value} /></div>
      </div> : !comparison.error && <Busy text="Loading comparison…" />}
    </section>}
    <details className="surface prior-demo"><summary>Open the Phase 1 practice walkthrough</summary><LabExample dimension={dimension} /></details>
  </>;
}
