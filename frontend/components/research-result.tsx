"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ClipboardCheck, GitCompareArrows, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TreeViewer } from "@/components/tree-viewer";
import { MODEL_NAMES, Problem, StatusBadge, message } from "@/components/research-controls";
import { downloadBlob, research, showStimulus, type AmbiguityAnswer, type MovementAnswer, type PhonologyAnswer, type RecursionAnswer, type Result } from "@/lib/research-api";

function AmbiguityView({ answer }: { answer: AmbiguityAnswer }) {
  const [mode, setMode] = useState<number | "compare">(0);
  return <>
    <div className="research-actions" role="group" aria-label="Syntax tree comparison">
      {answer.readings.map((reading, index) => <Button key={reading.attachment} size="small" variant={mode === index ? "primary" : "outline"}
        aria-pressed={mode === index} onClick={() => setMode(index)}>Reading {index + 1}</Button>)}
      {answer.readings.length > 1 && <Button size="small" variant={mode === "compare" ? "primary" : "outline"}
        aria-pressed={mode === "compare"} onClick={() => setMode("compare")}><GitCompareArrows size={14} /> Compare trees</Button>}
    </div>
    <div className={mode === "compare" ? "tree-pair" : "tree-stack"}>
      {answer.readings.map((reading, index) => (mode === "compare" || mode === index) && <div className="reading-source" key={index}>
        <h3>{reading.attachment}</h3><p>{reading.meaning}</p><TreeViewer tree={reading.tree} label={`Reading ${index + 1} tree`} />
      </div>)}
    </div>
  </>;
}

function RecursionView({ answer }: { answer: RecursionAnswer }) {
  const [depth, setDepth] = useState(0);
  return <>
    {answer.detected && <div className="research-facts">
      <div><span>Category</span><strong>{answer.category}</strong></div>
      <div><span>Recursive segment</span><strong>{answer.segment}</strong></div>
      <div><span>Model-estimated depth</span><strong>{answer.estimated_depth ?? "Unspecified"}</strong></div>
    </div>}
    {answer.expanded_tree && <label className="depth-control">Visible tree levels <strong>{depth || "All"}</strong>
      <input aria-label="Visible tree levels" type="range" min={0} max={24} value={depth} onChange={(event) => setDepth(event.target.valueAsNumber)} />
    </label>}
    <div className={answer.expanded_tree ? "tree-pair" : "tree-stack"}>
      <TreeViewer tree={answer.tree} label="Original tree" maximumDepth={depth} />
      {answer.expanded_tree && <div><blockquote className="research-quote">{answer.expanded_sentence}</blockquote>
        <TreeViewer tree={answer.expanded_tree} label="Expanded tree" maximumDepth={depth} highlights={answer.added_node_ids} />
      </div>}
    </div>
  </>;
}

function MovementView({ answer }: { answer: MovementAnswer }) {
  const [selected, setSelected] = useState<number>();
  const highlighted = answer.links.filter((link) => selected === undefined || link.index === selected);
  return <>
    {answer.detected && <div className="research-facts">
      <div><span>Movement category</span><strong>{answer.category}</strong></div>
      <div><span>Constituent</span><strong>{answer.constituent}</strong></div>
      <div><span>Original position</span><strong>{answer.origin}</strong></div>
      <div><span>Landing position</span><strong>{answer.landing}</strong></div>
    </div>}
    {answer.links.length > 0 && <div className="research-actions" role="group" aria-label="Movement dependencies">
      <Button variant={selected === undefined ? "primary" : "outline"} size="small" aria-pressed={selected === undefined} onClick={() => setSelected(undefined)}>All dependencies</Button>
      {[...new Set(answer.links.map((link) => link.index))].map((index) => <Button key={index} size="small"
        variant={selected === index ? "primary" : "outline"} aria-pressed={selected === index} onClick={() => setSelected(index)}>
        <Waypoints size={14} /> Trace {index}
      </Button>)}
    </div>}
    <TreeViewer tree={answer.tree} label="Movement tree" links={answer.links} selectedLink={selected}
      highlights={highlighted.flatMap((link) => [link.source_id, link.destination_id])} />
  </>;
}

function PhonologyView({ answer, result }: { answer: PhonologyAnswer; result: Result }) {
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | "support" | "exceptions">("all");
  const [prediction, setPrediction] = useState<{ surface: string; rule_evidence: string }>();
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const allRows = result.stimulus.rows ?? [];
  const evidence = result.execution.validation?.rule_evidence;
  const rows = allRows.filter((row) => evidenceFilter === "all" ||
    (evidenceFilter === "support" ? answer.supporting_ids : answer.exception_ids).includes(row.word_id));
  const distributions = [answer.input_phone, answer.output_phone].filter((value): value is string => !!value).map((phone) => ({
    phone, underlying: allRows.filter((row) => row.underlying?.split(/\s+/).includes(phone)).length,
    surface: allRows.filter((row) => row.surface.split(/\s+/).includes(phone)).length,
  }));

  async function test(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("rule-word") as string;
    setTesting(true);
    setError("");
    setPrediction(undefined);
    try { setPrediction(await research.testRule(result.id, input)); }
    catch (reason) { setError(message(reason)); }
    finally { setTesting(false); }
  }

  return <>
    {answer.formal_rule && <div className="rule-card"><span className="eyebrow">PROPOSED SOUND RULE</span><strong>{answer.formal_rule}</strong>
      <span>Environment {answer.environment}</span>
      {evidence?.status === "verified_on_examples" && <span className="pill status-completed">Verified on supplied examples</span>}
      {evidence?.status === "contradicted_by_examples" && <span className="pill status-failed">Observed mismatch</span>}
      {evidence?.status === "insufficient_examples" && <span className="pill">Insufficient matched examples</span>}
    </div>}
    {distributions.length > 0 && <section className="distribution">
      <h3>Forms containing each phone</h3>
      {distributions.map(({ phone, underlying, surface }) => <div key={phone} className="distribution-row">
        <strong>{phone}</strong><div><span>Underlying {underlying}</span><meter value={underlying} max={allRows.length || 1} /></div>
        <div><span>Surface {surface}</span><meter value={surface} max={allRows.length || 1} /></div>
      </div>)}
    </section>}
    <div className="research-actions" role="group" aria-label="Phonological evidence filters">
      {(["all", "support", "exceptions"] as const).map((filter) => <Button variant={filter === evidenceFilter ? "primary" : "outline"}
        size="small" key={filter} aria-pressed={filter === evidenceFilter} onClick={() => setEvidenceFilter(filter)}>
        {filter === "all" ? "All rows" : filter === "support" ? "Supporting examples" : "Exceptions"}
      </Button>)}
    </div>
    {rows.length > 0 ? <div className="table-scroll"><table>
      <thead><tr><th>Word</th><th>Underlying</th><th>Surface</th><th>Rule check</th></tr></thead>
      <tbody>{rows.map((row) => {
        const check = evidence?.rows.find((entry) => entry.word_id === row.word_id);
        return <tr key={row.word_id}><th scope="row">{row.word_id}</th><td><code>{row.underlying || "—"}</code></td>
          <td><code>{row.surface}</code></td><td>{check ? check.matches ? "Matches" : `Predicted ${check.predicted}` : "—"}</td></tr>;
      })}</tbody>
    </table></div> : <p className="empty-state">No rows in this evidence category.</p>}
    {answer.generalization && <p className="research-note"><strong>{result.provider === "demo" ? "Curated generalization" : "Model-generated generalization"}</strong> {answer.generalization}</p>}
    {answer.substitution ? <form className="research-form rule-test" onSubmit={test}>
      <label>Test an unseen word<input name="rule-word" placeholder="Enter space-separated phones" required maxLength={1800} /></label>
      <Button size="small" type="submit" disabled={testing}>{testing ? "Applying rule…" : "Apply substitution"}</Button>
      <Problem error={error} />
      {prediction && <p className="research-note" aria-live="polite"><strong>Predicted surface form</strong> <code>{prediction.surface}</code>
        <small>{prediction.rule_evidence === "verified_on_examples" ? "The substitution matched the supplied dataset." : "Programmatic hypothesis."}</small></p>}
    </form> : <p className="research-note">This response has no programmatic substitution. Its predictions are model-generated.</p>}
  </>;
}

export function ResultVisualization({ result }: { result: Result }) {
  const resultValue = result.parsed_output;
  if (!resultValue) return <div className="empty-state">
    {result.error || "The visualization will be available after structured validation."}
  </div>;
  const target = { ambiguity: "Ambiguity", recursion: "Recursion", movement: "Movement", phonology: "Sound rule" }[result.dimension];
  return <div className="research-result" key={result.id}>
    <div className="result-provenance">
      <span className={result.provider === "demo" ? "pill pill-demo" : "pill status-completed"}>
        {result.provider === "demo" ? (result.model === "lingualens-baseline" ? "Demo · Simplified baseline" : "Demo · Curated reference") : `Live · ${MODEL_NAMES[result.provider]}`}
      </span>
      <span className="pill">{resultValue.detected ? `${target} reported` : `No ${target.toLowerCase()} reported`}</span>
      {"readings" in resultValue && <span className="pill">{resultValue.readings.length} {resultValue.readings.length === 1 ? "reading" : "readings"}</span>}
    </div>
    <blockquote className="research-quote">{showStimulus(result.stimulus)}</blockquote>
    <p>{resultValue.explanation}</p>
    {result.dimension === "ambiguity" && <AmbiguityView answer={resultValue as AmbiguityAnswer} />}
    {result.dimension === "recursion" && <RecursionView answer={resultValue as RecursionAnswer} />}
    {result.dimension === "movement" && <MovementView answer={resultValue as MovementAnswer} />}
    {result.dimension === "phonology" && <PhonologyView result={result} answer={resultValue as PhonologyAnswer} />}
  </div>;
}

export function ResultAudit({ result }: { result: Result }) {
  const report = result.execution.validation;
  const details = result.execution;
  return <div className="result-audit">
    <div className="result-provenance"><StatusBadge state={result.state} /><span className="pill">{result.provider === "demo"
      ? (result.model === "lingualens-baseline" ? "Demo baseline" : "Demo reference") : "Live request"}</span></div>
    <dl className="audit-grid">
      <dt>Model</dt><dd>{result.model}</dd>
      <dt>Provider</dt><dd>{MODEL_NAMES[result.provider]}</dd>
      <dt>Trial</dt><dd>{result.trial}</dd>
      <dt>Prompt version</dt><dd>{details.prompt_version ?? "—"}</dd>
      <dt>Dataset version</dt><dd>{details.dataset_version ?? "—"}</dd>
      <dt>Latency</dt><dd>{details.latency_ms != null ? `${details.latency_ms} ms` : "—"}</dd>
      <dt>Tokens in / out</dt><dd>{details.input_tokens ?? "—"} / {details.output_tokens ?? "—"}</dd>
      <dt>Attempts</dt><dd>{details.attempts ?? "—"}</dd>
      <dt>Finished</dt><dd>{result.finished_at ? new Date(result.finished_at).toLocaleString() : "—"}</dd>
    </dl>
    {report && <section className="result-validation">
      <h3><ClipboardCheck size={16} /> Validation</h3>
      <dl className="audit-grid"><dt>Schema</dt><dd>{report.schema}</dd><dt>Structure</dt><dd>{report.structure.replaceAll("_", " ")}</dd>
        <dt>Execution-time correctness</dt><dd>Unreviewed</dd></dl>
      {report.errors.length > 0 && <ul>{report.errors.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      {report.reference_checks.length > 0 && <details><summary>Reference field checks</summary>
        <ul>{report.reference_checks.map((check) => <li key={check.field}>{check.field.replaceAll("_", " ")} · {check.matches ? "matches reference" : `expected ${check.expected}, received ${check.observed}`}</li>)}</ul>
      </details>}
      {result.reference?.annotation && <p className="research-note">{result.reference.annotation}</p>}
    </section>}
    {result.raw_output !== null && <details><summary>Raw model output</summary><pre>{result.raw_output || "The provider returned no text."}</pre></details>}
    <details><summary>Exact prompt</summary><pre>{result.prompt_rendered}</pre></details>
    <details><summary>Execution settings</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>
    <Button variant="outline" size="small" onClick={() => downloadBlob(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }), `lingualens-response-${result.id}.json`)}>Export response JSON</Button>
    <Link className="text-link" href={`/lab/evaluation?experiment=${result.experiment_id}`}>Open Evaluation Center</Link>
  </div>;
}
