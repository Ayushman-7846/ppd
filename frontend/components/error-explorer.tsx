"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { message } from "@/components/research-controls";
import { PageControls, ScienceNotice, SectionTitle } from "@/components/science-controls";
import { dimensions, type Dimension } from "@/lib/research";
import { friendly, science, type ErrorRecord, type ReviewMaterial } from "@/lib/evaluation-api";
import { showStimulus, type Page } from "@/lib/research-api";

export function ErrorExplorer() {
  return <ResearchAccess><Explorer /></ResearchAccess>;
}

function Explorer() {
  const [dimension, setDimension] = useState<Dimension>();
  const [severity, setSeverity] = useState("");
  const [state, setState] = useState("");
  const [category, setCategory] = useState("");
  const [taxonomy, setTaxonomy] = useState<Record<Dimension | "general", string[]>>();
  const [rows, setRows] = useState<Page<ErrorRecord>>();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<ErrorRecord>();
  const [evidence, setEvidence] = useState<{ id: number; input: ReviewMaterial | null }>();
  const [evidenceError, setEvidenceError] = useState("");
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState<number>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    science.taxonomy().then((data) => { if (active) setTaxonomy(data); }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    science.errors({ dimension, state, severity, category, page }).then((data) => { if (active) setRows(data); },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [dimension, state, severity, category, page, revision]);
  useEffect(() => {
    if (!source) return;
    let active = true;
    science.error(source.id).then((data) => { if (active) setEvidence(data); },
      (reason) => { if (active) setEvidenceError(message(reason)); });
    return () => { active = false; };
  }, [source]);

  const choices = taxonomy ? [...new Set(dimension ? [...taxonomy.general, ...taxonomy[dimension]] : Object.values(taxonomy).flat())] : [];
  async function resolve(id: number, value: "confirmed" | "dismissed") {
    setWorking(id); setError("");
    try { await science.resolveError(id, value); setRevision((counter) => counter + 1); }
    catch (reason) { setError(message(reason)); }
    finally { setWorking(undefined); }
  }

  return <div className="science-page">
    <div className="lab-title"><div><span className="eyebrow"><AlertCircle size={15} /> LINGUISTIC EVIDENCE</span><h1>Error Explorer</h1>
      <p>Inspect automatic suggestions, human annotations, and source responses.</p></div></div>
    <section className="surface dashboard-panel">
      <SectionTitle title="Error history" note="Filters apply to recorded annotations." />
      <div className="science-filters research-form">
        <label>Task<select aria-label="Error task" value={dimension ?? ""} onChange={(event) => {
          setDimension((event.target.value || undefined) as Dimension | undefined); setCategory(""); setPage(1);
        }}><option value="">All tasks</option>{dimensions.map((row) => <option value={row.id} key={row.id}>{row.label}</option>)}</select></label>
        <label>Category<select aria-label="Error category" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
          <option value="">All categories</option>{choices.map((option) => <option key={option} value={option}>{friendly(option)}</option>)}</select></label>
        <label>Severity<select aria-label="Error severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}>
          <option value="">All severities</option><option>minor</option><option>major</option><option>critical</option></select></label>
        <label>Review state<select aria-label="Error review state" value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}>
          <option value="">All states</option><option>suggested</option><option>confirmed</option><option>dismissed</option></select></label>
      </div>
      <ScienceNotice busy={!rows && !error} error={error} />
      {rows?.items.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">Category</th><th scope="col">Source / severity</th><th scope="col">Evidence</th><th scope="col">Response</th><th scope="col">Review suggestion</th></tr></thead>
        <tbody>{rows.items.map((item) => <tr key={item.id}><th scope="row" className="science-wrap">{friendly(item.category)}
          <small className="science-block muted">{item.dimension} · {item.model}</small></th>
          <td>{item.source} · {item.severity}<small className="science-block muted">{item.state}</small></td>
          <td className="science-wrap">{item.evidence}</td>
          <td><Button size="small" variant="outline" onClick={() => { setSource({ ...item }); setEvidenceError(""); }}>Open {item.response_id}</Button></td>
          <td>{item.source === "human" ? <small>Submitted review</small> : <div className="research-actions">
            <Button size="icon" variant="ghost" aria-label={`Confirm annotation ${item.id}`} disabled={working === item.id || item.state === "confirmed"}
              onClick={() => resolve(item.id, "confirmed")}><Check size={16} /></Button>
            <Button size="icon" variant="ghost" aria-label={`Dismiss annotation ${item.id}`} disabled={working === item.id || item.state === "dismissed"}
              onClick={() => resolve(item.id, "dismissed")}><X size={16} /></Button>
          </div>}</td>
        </tr>)}</tbody>
      </table></div> : rows && <p className="empty-state">No error annotations match these filters.</p>}
      {rows && <PageControls page={page} total={rows.total} size={rows.page_size} change={setPage} />}
    </section>
    {source && <section className="surface dashboard-panel">
      <SectionTitle title={`Original response ${source.response_id}`} note={`${source.model} · Annotation ${source.id}`}
        action={<Button variant="outline" size="small" onClick={() => setSource(undefined)}>Close response</Button>} />
      <ScienceNotice busy={evidence?.id !== source.id && !evidenceError} error={evidenceError} />
      {evidence?.id === source.id && (evidence.input ? <>
        <blockquote className="research-quote">{showStimulus(evidence.input.stimulus)}</blockquote>
        <div className="result-audit"><pre>{evidence.input.raw_output ?? "No text was stored for this annotation."}</pre></div>
      </> : <p className="empty-state">The annotation has no saved source response.</p>)}
    </section>}
  </div>;
}
