"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, GitCompareArrows, History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { research, showStimulus, running, type Page, type ResponseSummary, type Status } from "@/lib/research-api";
import type { Dimension } from "@/lib/research";
import { Busy, Problem, StatusBadge, message } from "@/components/research-controls";

export function AnalysisHistory({ dimension, revision, current, onOpen, onCompare, onRerun, onRemove }:
  { dimension: Dimension; revision: number; current?: number; onOpen: (id: number) => void; onCompare: (id: number) => void;
    onRerun: (id: number) => void; onRemove: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<Status>();
  const [results, setResults] = useState<Page<ResponseSummary>>();
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    research.history({ dimension, page, state, model: modelFilter }).then((data) => {
      if (!active) return;
      if (page > 1 && data.items.length === 0) setPage(page - 1);
      else { setResults(data); setError(""); }
    }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [dimension, page, state, modelFilter, revision, reload]);

  return <section className="surface dashboard-panel analysis-history">
    <div className="panel-heading"><div><h2>Analysis history</h2><p>Saved runs and responses for this task</p></div><History size={18} /></div>
    <form className="research-form history-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setModelFilter(model.trim()); }}>
      <label>Status<select aria-label="Status" value={state ?? ""} onChange={(event) => { setPage(1); setState((event.target.value || undefined) as Status); }}>
        <option value="">All statuses</option>
        {["pending", "running", "completed", "failed", "cancelled"].map((option) => <option key={option}>{option}</option>)}
      </select></label>
      <label>Model identifier<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Exact identifier" maxLength={200} /></label>
      <Button size="small" variant="outline" type="submit">Filter</Button>
    </form>
    <Problem error={error} />
    {error && <Button variant="outline" size="small" onClick={() => setReload((value) => value + 1)}>Reload history</Button>}
    {!results && !error && <Busy text="Loading history…" />}
    {results && (results.items.length ? <div className="table-scroll"><table>
      <thead><tr><th>Input</th><th>Model</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead>
      <tbody>{results.items.map((item) => <tr key={item.id}><th scope="row" className="history-stimulus">
        <button type="button" className="text-link" onClick={() => onOpen(item.id)}>{showStimulus(item.stimulus)}</button>
        {item.preview && <small title={item.preview}>{item.preview}</small>}
      </th><td>{item.model}</td><td><StatusBadge state={item.state} /></td><td>{new Date(item.created_at).toLocaleString()}</td>
        <td><div className="research-actions history-actions">
          <Button size="small" variant="ghost" onClick={() => onRerun(item.id)} disabled={running(item.state)} title="Re-run exact input and prompt"><RotateCcw size={14} /> Re-run</Button>
          {!!current && current !== item.id && <Button size="small" variant="ghost" onClick={() => onCompare(item.id)}><GitCompareArrows size={14} /> Compare</Button>}
          <Button size="icon" variant="ghost" aria-label={`Remove response ${item.id} from history`} disabled={running(item.state)} onClick={() => onRemove(item.id)}><Trash2 size={15} /></Button>
        </div></td>
      </tr>)}</tbody>
    </table></div> : <div className="empty-state">No saved responses match these filters.</div>)}
    {!!results && results.total > results.page_size && <div className="research-actions pagination">
      <Button size="small" variant="outline" onClick={() => setPage((value) => value - 1)} disabled={page === 1}><ArrowLeft size={14} /> Previous</Button>
      <span>Page {page} of {Math.ceil(results.total / results.page_size)}</span>
      <Button size="small" variant="outline" onClick={() => setPage((value) => value + 1)} disabled={page * results.page_size >= results.total}>Next <ArrowRight size={14} /></Button>
    </div>}
  </section>;
}
