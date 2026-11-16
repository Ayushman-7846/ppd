"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Copy, Database, Download, Plus, Save, Trash2, Upload } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { Datasets as DemoDatasets } from "@/components/lab-tools";
import { Button } from "@/components/ui/button";
import { dimensions, studyUrl, type Dimension } from "@/lib/research";
import { datasetExport, research, showStimulus, type Dataset, type DatasetDetail, type DatasetInput } from "@/lib/research-api";
import { Busy, Problem, message } from "@/components/research-controls";
import { useToast } from "@/components/toast";

type Editor = { id?: number; name: string; dimension: Dimension; provenance: string; contents: string };

function placeholder(dimension: Dimension): Editor {
  const stimulus = dimension === "phonology" ? { rows: [{ word_id: "w1", underlying: "a b", surface: "a p", target: "b" }], phones_of_interest: ["b", "p"] } : { sentence: "" };
  return { name: "", dimension, provenance: "Researcher supplied", contents: JSON.stringify([{ item_key: "item-01", stimulus, reference: {} }], null, 2) };
}

export function DatasetStudio() {
  return <ResearchAccess demo={<DemoDatasets />}><DatasetWorkspace /></ResearchAccess>;
}

function DatasetWorkspace() {
  const [filter, setFilter] = useState<Dimension | "">("");
  const [phrase, setPhrase] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Dataset[]>();
  const [selected, setSelected] = useState<DatasetDetail>();
  const [editor, setEditor] = useState<Editor>();
  const [importing, setImporting] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    let active = true;
    research.datasets(filter || undefined, search).then((data) => { if (active) setItems(data); },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [filter, search, revision]);

  async function action<T>(work: () => Promise<T>, done: (value: T) => void) {
    setError("");
    setWorking(true);
    try { done(await work()); }
    catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  function select(value: DatasetDetail) {
    setSelected(value);
    setEditor(undefined);
    setImporting(false);
    setCopyName(value.name + " copy");
  }

  function commit(value: DatasetDetail) {
    select(value);
    setRevision((number) => number + 1);
    toast("Dataset saved");
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    void action(async () => {
      let data: DatasetInput["items"];
      try { data = JSON.parse(editor.contents); }
      catch { throw new Error("The item editor must contain valid JSON."); }
      return research.saveDataset({ name: editor.name, dimension: editor.dimension, provenance: editor.provenance, items: data }, editor.id);
    }, commit);
  }

  return <>
    <div className="lab-title"><div><h1>Dataset Studio</h1><p>Create, version, and inspect linguistic stimuli and reference annotations.</p></div>
      <div className="research-actions">
        <Button variant="outline" onClick={() => { setImporting(true); setEditor(undefined); }}><Upload size={16} /> Import CSV / JSON</Button>
        <Button onClick={() => { setEditor(placeholder(filter || "ambiguity")); setImporting(false); }}><Plus size={16} /> New dataset</Button>
      </div>
    </div>
    <Problem error={error} />
    <div className="studio-grid">
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Collections</h2><p>Private datasets and original LinguaLens teaching cases</p></div><Database size={18} /></div>
        <form className="research-form" onSubmit={(event) => { event.preventDefault(); setSearch(phrase.trim()); }}>
          <label>Task<select aria-label="Task" value={filter} onChange={(event) => setFilter(event.target.value as Dimension | "")}>
            <option value="">All tasks</option>
            {dimensions.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
          </select></label>
          <label>Search datasets<input value={phrase} maxLength={150} onChange={(event) => setPhrase(event.target.value)} /></label>
          <Button size="small" variant="outline" type="submit">Search</Button>
        </form>
        {items ? <div className="research-list">{items.map((entry) => <button type="button" key={entry.id}
          disabled={working} aria-pressed={selected?.id === entry.id} onClick={() => action(() => research.dataset(entry.id), select)}>
          <strong>{entry.name}</strong><small>{entry.dimension} · v{entry.version} · {entry.item_count} items</small>
        </button>)}{!items.length && <p className="empty-state">No collections match these filters.</p>}</div>
          : error ? <Button variant="outline" size="small" onClick={() => setRevision((number) => number + 1)}>Reload datasets</Button> : <Busy text="Loading datasets…" />}
        <a href={studyUrl} className="text-link" target="_blank" rel="noreferrer">Original study materials <ArrowUpRight size={14} /></a>
      </section>
      <section className="surface dashboard-panel">
        {importing ? <>
          <div className="panel-heading"><div><h2>Import a dataset</h2><p>UTF-8 CSV or JSON, up to 750 KB.</p></div></div>
          <form className="research-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void action(() => research.importDataset(data), commit); }}>
            <label>Dataset name<input required name="name" maxLength={150} /></label>
            <label>Dataset task<select aria-label="Dataset task" name="dimension" defaultValue={filter || "ambiguity"}>
              {dimensions.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select></label>
            <label>Dataset file<input name="file" type="file" accept=".csv,.json" required /></label>
            <p className="research-hint">Syntax CSV requires item_key and sentence. Phonology CSV requires item_key, word_id, and surface. Export a teaching dataset for a complete template.</p>
            <div className="research-actions"><Button type="submit" disabled={working}><Upload size={16} /> Import dataset</Button>
              <Button variant="outline" onClick={() => setImporting(false)}>Cancel</Button></div>
          </form>
        </> : editor ? <>
          <div className="panel-heading"><div><h2>{editor.id === undefined ? "New dataset" : "Edit dataset version"}</h2><p>Saved experiments retain the exact dataset version they used.</p></div></div>
          <form className="research-form" onSubmit={save}>
            <label>Dataset name<input required maxLength={150} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>Dataset task<select aria-label="Dataset task" disabled={editor.id !== undefined} value={editor.dimension} onChange={(event) => {
              const proposed = placeholder(event.target.value as Dimension);
              setEditor({ ...proposed, name: editor.name, provenance: editor.provenance });
            }}>{dimensions.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
            <label>Provenance<input value={editor.provenance} required maxLength={1800} onChange={(event) => setEditor({ ...editor, provenance: event.target.value })} /></label>
            <label>Items and reference annotations<textarea className="code-editor" rows={17} value={editor.contents}
              onChange={(event) => setEditor({ ...editor, contents: event.target.value })} required /></label>
            <div className="research-actions"><Button type="submit" disabled={working}><Save size={16} /> Save dataset</Button>
              <Button variant="outline" onClick={() => setEditor(undefined)}>Cancel</Button></div>
          </form>
        </> : selected ? <>
          <div className="panel-heading"><div><h2>{selected.name}</h2><p>{selected.provenance} · Version {selected.version} · {selected.item_count} items</p></div></div>
          <div className="research-actions">
            <Button asChild size="small" variant="outline"><a href={datasetExport(selected.id, "json")}><Download size={14} /> JSON</a></Button>
            <Button asChild size="small" variant="outline"><a href={datasetExport(selected.id, "csv")}><Download size={14} /> CSV</a></Button>
            {typeof selected.id === "number" && <>
              <Button size="small" variant="outline" onClick={() => setEditor({ id: selected.id as number, name: selected.name, dimension: selected.dimension,
                provenance: selected.provenance, contents: JSON.stringify(selected.items, null, 2) })}>Edit dataset</Button>
              <Button size="small" variant="ghost" disabled={working} onClick={() => action(() => research.removeDataset(selected.id as number), () => {
                setSelected(undefined); setRevision((number) => number + 1); toast("Dataset deleted from the active catalog");
              })}><Trash2 size={14} /> Delete dataset</Button>
            </>}
          </div>
          <form className="research-form duplicate-form" onSubmit={(event) => {
            event.preventDefault(); void action(() => research.duplicateDataset(selected.id, copyName), commit);
          }}><label>Duplicate as<input required maxLength={150} value={copyName} onChange={(event) => setCopyName(event.target.value)} /></label>
            <Button variant="outline" size="small" type="submit" disabled={working}><Copy size={14} /> Duplicate</Button></form>
          <div className="dataset-preview">{selected.items.map((item) => <details key={item.item_key}>
            <summary><strong>{item.item_key}</strong> {showStimulus(item.stimulus).slice(0, 100)}</summary>
            {item.reference.annotation && <p>{item.reference.annotation}</p>}
            {item.stimulus.rows && item.stimulus.rows.length > 0 && <div className="table-scroll"><table>
              <thead><tr><th>Word</th><th>Underlying</th><th>Surface</th><th>Target</th></tr></thead>
              <tbody>{item.stimulus.rows.map((row) => <tr key={row.word_id}><th scope="row">{row.word_id}</th><td>{row.underlying || "—"}</td><td>{row.surface}</td><td>{row.target || "—"}</td></tr>)}</tbody>
            </table></div>}
          </details>)}</div>
        </> : <div className="empty-state">Select a collection to preview its stimuli, or create a new dataset.</div>}
        {working && <Busy text="Updating dataset…" />}
      </section>
    </div>
  </>;
}
