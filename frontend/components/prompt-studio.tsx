"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Braces, Play, Save } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { Busy, DEMO, ModelSelector, Problem, message, useModels } from "@/components/research-controls";
import { dimensions, type Dimension } from "@/lib/research";
import { research, running, showStimulus, type DatasetDetail, type Prompt, type Selection } from "@/lib/research-api";
import { ResultAudit, ResultVisualization } from "@/components/research-result";
import { useResearchPoll } from "@/components/research-poll";
import { useToast } from "@/components/toast";

export function PromptStudio() {
  return <ResearchAccess demo={<div className="lab-title"><div><h1>Prompt Studio</h1><p>Version standardized task instructions and preview the exact prompt sent to the model.</p></div></div>}>
    <PromptWorkspace />
  </ResearchAccess>;
}

function PromptWorkspace() {
  const [dimension, setDimension] = useState<Dimension>("ambiguity");
  const [items, setItems] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<Prompt>();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [dataset, setDataset] = useState<DatasetDetail>();
  const [item, setItem] = useState("");
  const [preview, setPreview] = useState<{ text: string; schema: Record<string, unknown> }>();
  const [responseId, setResponseId] = useState<number>();
  const [selection, setSelection] = useState<Selection>(DEMO);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const { models, error: modelError } = useModels();
  const poll = useResearchPoll(responseId, research.result);
  const toast = useToast();

  function open(record: Prompt) {
    setSelected(record);
    setName(record.name);
    setTemplate(record.template);
    setPreview(undefined);
  }

  useEffect(() => {
    let active = true;
    Promise.all([research.prompts(dimension), research.dataset(`builtin:${dimension}`)]).then(([data, fixtures]) => {
      if (!active) return;
      setItems(data);
      setDataset(fixtures);
      setItem(fixtures.items[0]?.item_key ?? "");
      if (data[0]) open(data[0]);
    }, (reason) => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dimension]);

  async function run<T>(work: () => Promise<T>, done: (value: T) => void) {
    setError("");
    setWorking(true);
    try { done(await work()); }
    catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => research.savePrompt({ name, template, dimension }), (value) => {
      setItems((previous) => [value, ...previous]); open(value); toast(`Prompt version ${value.version} saved`);
    });
  }

  const chosenItem = dataset?.items.find((entry) => entry.item_key === item);
  const dirty = !selected || name !== selected.name || template !== selected.template;

  return <>
    <div className="lab-title"><div><h1>Prompt Studio</h1><p>Every save creates an immutable version. Past trials retain their exact rendered prompt.</p></div></div>
    <Problem error={error || modelError} />
    <div className="studio-grid">
      <section className="surface dashboard-panel research-form">
        <div className="panel-heading"><div><h2>Template library</h2><p>One standard protocol per task</p></div><Braces size={19} /></div>
        <label>Prompt task<select aria-label="Prompt task" value={dimension} onChange={(event) => {
          setLoading(true); setSelected(undefined); setDataset(undefined); setItems([]); setPreview(undefined); setResponseId(undefined);
          setDimension(event.target.value as Dimension);
        }}>{dimensions.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
        {loading && <Busy text="Loading templates…" />}
        <div className="research-list">{items.map((record) => <button key={record.id} type="button"
          aria-pressed={selected?.id === record.id} onClick={() => open(record)}>
          <strong>{record.name.startsWith("@default:") ? "Standard protocol" : record.name}</strong><small>Version {record.version}</small>
        </button>)}</div>
        {!!items.length && <Button size="small" variant="outline" onClick={() => { setSelected(undefined); setName(""); setPreview(undefined); }}>New template</Button>}
      </section>
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Prompt editor</h2><p>Supported variables use a dollar sign. The renderer also appends the stimulus and output schema.</p></div></div>
        <form className="research-form" onSubmit={save}>
          <label>Template name<input required value={name} maxLength={150} onChange={(event) => setName(event.target.value)} /></label>
          <label>Template body<textarea className="code-editor" value={template} onChange={(event) => { setTemplate(event.target.value); setPreview(undefined); }}
            rows={10} maxLength={4000} required /></label>
          <p className="research-hint"><code>$sentence $dataset $task_type $analysis_requirements $category $phones_of_interest</code></p>
          <Button type="submit" disabled={working || loading}><Save size={15} /> Save new version</Button>
        </form>
        {dataset && <form className="research-form prompt-preview" onSubmit={(event) => {
          event.preventDefault();
          if (selected && chosenItem) void run(() => research.analyze(dimension, { dataset_id: dataset.id, item_key: chosenItem.item_key }, selection, selected.id),
            (value) => setResponseId(value.response_id!));
        }}>
          <h3>Preview and test</h3>
          <label>Preview stimulus<select aria-label="Preview stimulus" value={item} onChange={(event) => { setItem(event.target.value); setPreview(undefined); }}>
            {dataset.items.map((entry) => <option value={entry.item_key} key={entry.item_key}>{showStimulus(entry.stimulus).slice(0, 120)}</option>)}
          </select></label>
          <ModelSelector models={models} value={selection} onChange={setSelection} />
          <div className="research-actions">
            <Button variant="outline" disabled={!chosenItem || working || loading} onClick={() => {
              const basis = selected ?? items[0];
              if (basis && chosenItem) void run(() => research.previewPrompt(basis.id, chosenItem.stimulus, template), setPreview);
            }}>Preview rendered prompt</Button>
            <Button type="submit" disabled={dirty || working || (poll.value !== undefined && running(poll.value.state))}><Play size={15} /> Test saved prompt</Button>
          </div>
          {selection.provider === "demo" && <p className="research-hint">Demo profiles use authored outputs. Use a configured live model to test how prompt edits change its output.</p>}
        </form>}
        {preview && <div className="result-audit"><details open><summary>Rendered prompt</summary><pre>{preview.text}</pre></details>
          <details><summary>Task response schema</summary><pre>{JSON.stringify(preview.schema, null, 2)}</pre></details></div>}
      </section>
    </div>
    {responseId && <section className="surface dashboard-panel">
      <div className="panel-heading"><div><h2>Prompt test result</h2></div></div>
      <Problem error={poll.error} />
      {poll.error && <Button variant="outline" onClick={poll.retry}>Reconnect</Button>}
      {!poll.error && (!poll.value || running(poll.value.state)) ? <Busy text="Waiting for response…" /> :
        poll.value && <div className="tree-pair"><ResultVisualization result={poll.value} /><ResultAudit result={poll.value} /></div>}
    </section>}
  </>;
}
