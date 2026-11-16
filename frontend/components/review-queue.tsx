"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlignLeft, ClipboardCheck, EyeOff, Plus, Scale, Trash2, UserRoundPlus } from "lucide-react";
import type { Profile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Busy, Problem, message } from "@/components/research-controls";
import { PageControls, Population, RubricSelect, ScienceNotice, ScoreCard, SectionTitle } from "@/components/science-controls";
import { TreeViewer } from "@/components/tree-viewer";
import { useToast } from "@/components/toast";
import { criteria, display, friendly, science, type Annotation, type Assignment, type Consensus, type Criterion, type Dispute, type ReviewDraft, type Rubric, type StudyFilters, type Verdict } from "@/lib/evaluation-api";
import { showStimulus, type TreeNode } from "@/lib/research-api";

const keys = Object.keys(criteria) as Criterion[];

export function ReviewQueue({ profile, rubrics, focused }: { profile?: Profile; rubrics: Rubric[]; focused?: number }) {
  const reviewer = profile?.role === "reviewer" || profile?.role === "admin";
  const [scope, setScope] = useState<"mine" | "sent">();
  const activeScope = scope ?? (reviewer && !focused ? "mine" : "sent");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Awaited<ReturnType<typeof science.assignments>>>();
  const [active, setActive] = useState<Assignment>();
  const [opening, setOpening] = useState(false);
  const [response, setResponse] = useState<number | undefined>(focused);
  const [rubric, setRubric] = useState<number>();
  const [email, setEmail] = useState("");
  const [blind, setBlind] = useState(true);
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const rubricId = rubric ?? rubrics.find((row) => row.name === "Standard linguistic rubric")?.id;

  useEffect(() => {
    let live = true;
    science.assignments({ scope: activeScope, state, page }).then((value) => { if (live) setValues(value); },
      (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [activeScope, state, page, revision]);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!response || !rubricId) return;
    setWorking(true);
    setError("");
    try {
      await science.assign({ response_id: response, rubric_id: rubricId, reviewer: email, blind });
      setScope("sent"); setPage(1); setState(""); setEmail(""); setRevision((value) => value + 1);
      toast("Human review assigned");
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  async function open(id: number) {
    setOpening(true); setError("");
    try { setActive(await science.review(id)); }
    catch (reason) { setError(message(reason)); }
    finally { setOpening(false); }
  }

  return <>
    <Problem error={error} />
    <div className="studio-grid">
      <section className="surface dashboard-panel">
        <SectionTitle title="Review queue" note="Browse assigned or sent reviews by state." action={<ClipboardCheck size={19} />} />
        <div className="science-tabs" role="group" aria-label="Review scope">
          {reviewer && <Button size="small" variant={activeScope === "mine" ? "primary" : "outline"}
            aria-pressed={activeScope === "mine"} onClick={() => { setScope("mine"); setPage(1); setActive(undefined); }}>Assigned to me</Button>}
          <Button size="small" variant={activeScope === "sent" ? "primary" : "outline"}
            aria-pressed={activeScope === "sent"} onClick={() => { setScope("sent"); setPage(1); setActive(undefined); }}>Sent assignments</Button>
        </div>
        <div className="research-form"><label>Review state<select aria-label="Review state" value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}>
          <option value="">All states</option><option value="pending">Pending</option><option value="draft">Draft</option><option value="submitted">Completed</option>
        </select></label></div>
        {opening && <Busy text="Opening review…" />}
        {values?.items.length ? <div className="research-list">{values.items.map((item) => <button key={item.id} type="button" disabled={opening}
          aria-pressed={active?.id === item.id} onClick={() => open(item.id)}>
          <strong>{item.item_key} · {item.dimension}</strong><small>{item.reviewer} · {item.state} · {item.blind ? "Blind" : "Open"} review</small>
        </button>)}</div> : values ? <p className="empty-state">No reviews match this queue.</p> : !error && <Busy text="Loading assignments…" />}
        {values && <PageControls page={page} total={values.total} size={values.page_size} change={setPage} />}
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Assign a human reviewer" note="Use an authorized account. Blind reviews hide platform model metadata until submission."
          action={<UserRoundPlus size={18} />} />
        <form className="research-form" onSubmit={assign}>
          <label>Response ID<input type="number" min={1} required value={response ?? ""} onChange={(event) => setResponse(event.target.valueAsNumber || undefined)} /></label>
          <RubricSelect rubrics={rubrics} value={rubric} change={setRubric} />
          <label>Reviewer email<input type="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="check-field"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} />
            <span>Blind review</span></label>
          <Button type="submit" disabled={working || !rubricId}><UserRoundPlus size={16} /> Assign review</Button>
        </form>
      </section>
    </div>
    {active && <ReviewWorkspace key={`${active.id}-${active.revision}`} review={active} profile={profile}
      onSave={(saved) => { setActive(saved); setRevision((value) => value + 1); }} />}
  </>;
}

function ReviewWorkspace({ review, profile, onSave }: { review: Assignment; profile?: Profile; onSave: (saved: Assignment) => void }) {
  const [draft, setDraft] = useState<ReviewDraft>({
    scores: review.draft?.scores ?? {}, comment: review.draft?.comment ?? "", verdict: review.draft?.verdict,
    errors: review.draft?.errors ?? [],
  });
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
  const [consensus, setConsensus] = useState<Consensus>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => {
    let live = true;
    if (review.can_edit) {
      science.taxonomy().then((value) => { if (live) setTaxonomy([...value[review.dimension], ...value.general]); },
        (reason) => { if (live) setError(message(reason)); });
    }
    if (review.state === "submitted") {
      science.consensus(review.response_id, review.rubric.id, review.id).then((value) => { if (live) setConsensus(value); },
        (reason) => { if (live) setError(message(reason)); });
    }
    return () => { live = false; };
  }, [review]);

  if (!review.item) return <div className="empty-state">Review material unavailable.</div>;
  const item = review.item;
  const result = item.parsed_output;
  const treeList: { tree: TreeNode; label: string }[] = result ? (
    "readings" in result ? result.readings.map((row, index) => ({ tree: row.tree, label: row.attachment || `Reading ${index + 1}` })) :
      "tree" in result ? [{ tree: result.tree, label: "Original tree" }, ...("expanded_tree" in result && result.expanded_tree
        ? [{ tree: result.expanded_tree, label: "Expanded tree" }] : [])] : []
  ) : [];

  async function save(submit: boolean) {
    setError(""); setWorking(true);
    try {
      const updated = await science.grade(review.id, { ...draft, revision: review.revision, submit });
      toast(submit ? "Human review submitted" : "Review draft saved");
      onSave(updated);
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }
  const typeLabel = review.blind ? "Blind review" : "Open review";

  function changeError(index: number, value: Annotation) {
    setDraft({ ...draft, errors: draft.errors.map((original, position) => index === position ? value : original) });
  }

  return <>
    <div className="result-provenance science-review-title"><span className="pill">{typeLabel}</span><span className="pill">Response {review.response_id}</span>
      <span className="pill">{review.state}</span>{review.model ? <span className="pill">{review.model.identifier} · {review.model.provider}</span> :
        <span className="pill pill-demo"><EyeOff size={13} /> Model metadata hidden</span>}</div>
    <Problem error={error} />
    <div className="research-workbench">
      <section className="surface dashboard-panel">
        <SectionTitle title="Question and reference" note={`${review.dimension} · ${review.item_key}`} />
        <blockquote className="research-quote">{showStimulus(item.stimulus)}</blockquote>
        <p className="research-hint">{item.dataset_name} · v{item.dataset_version}</p>
        {Object.keys(item.reference).length > 0 && <div className="result-audit">
          <details><summary>Reference data</summary><pre>{JSON.stringify(item.reference, null, 2)}</pre></details>
        </div>}
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Response under review" note="Inspect the stored response before grading." action={<AlignLeft size={18} />} />
        <div className="research-result">
          {result ? <><p>{result.explanation}</p>
            {"formal_rule" in result && result.formal_rule && <div className="rule-card"><strong>{result.formal_rule}</strong>{result.environment}</div>}
            {"constituent" in result && <p>{result.constituent} · {result.origin} → {result.landing}</p>}
            {"expanded_sentence" in result && result.expanded_sentence && <p>{result.expanded_sentence}</p>}
            {treeList.map(({ tree, label }, index) => <TreeViewer key={index} tree={tree} label={label}
              links={"links" in result ? result.links : undefined} />)}
          </> : <p className="empty-state">No structured rendering is available. Review the stored raw output.</p>}
          <div className="result-audit"><details><summary>Raw response</summary><pre>{item.raw_output ?? "No stored response text."}</pre></details></div>
        </div>
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Human rubric" note={`${review.rubric.name} · v${review.rubric.version}`} action={<Scale size={17} />} />
        {review.can_edit ? <form className="research-form" onSubmit={(event) => { event.preventDefault(); void save(true); }}>
          {keys.map((criterion) => <label key={criterion}>{criteria[criterion]} · {review.rubric.weights[criterion]}%
            <input aria-label={criteria[criterion]} type="number" min={0} max={100} step=".01" value={draft.scores[criterion] ?? ""}
              onChange={(event) => setDraft({ ...draft, scores: { ...draft.scores, [criterion]:
                event.target.value === "" ? undefined : event.target.valueAsNumber } })} /></label>)}
          <label>Verdict<select aria-label="Verdict" value={draft.verdict ?? ""} onChange={(event) => setDraft({ ...draft, verdict: event.target.value as Verdict || undefined })}>
            <option value="">Choose verdict</option><option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="uncertain">Uncertain</option>
          </select></label>
          <label>Reviewer feedback<textarea rows={3} maxLength={1800} value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} /></label>
          {draft.errors.map((entry, index) => <fieldset className="model-row" key={index}><legend>Error {index + 1}</legend>
            <label>Category<select aria-label={`Error ${index + 1} category`} value={entry.category} onChange={(event) => changeError(index, { ...entry, category: event.target.value })}>
              {taxonomy.map((choice) => <option key={choice} value={choice}>{friendly(choice)}</option>)}</select></label>
            <label>Severity<select aria-label={`Error ${index + 1} severity`} value={entry.severity}
              onChange={(event) => changeError(index, { ...entry, severity: event.target.value as Annotation["severity"] })}>
              <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label>
            <label>Evidence<textarea maxLength={1800} rows={2} value={entry.evidence} onChange={(event) => changeError(index, { ...entry, evidence: event.target.value })} /></label>
            <Button variant="ghost" size="small" onClick={() => setDraft({ ...draft, errors: draft.errors.filter((_, position) => position !== index) })}><Trash2 size={14} /> Remove annotation</Button>
          </fieldset>)}
          <Button variant="outline" size="small" disabled={!taxonomy.length || draft.errors.length >= 20}
            onClick={() => setDraft({ ...draft, errors: [...draft.errors, { category: taxonomy[0], severity: "major", evidence: "" }] })}><Plus size={14} /> Add error</Button>
          <Button variant="outline" disabled={working} onClick={() => save(false)}>Save draft</Button>
          <Button type="submit" disabled={working}>Submit review</Button>
        </form> : review.state === "submitted" ? <div className="result-audit">
          <p>Weighted score {display(review.score)} · {review.verdict}</p>
          <p className="research-note">{review.draft?.comment}</p>
          <dl className="audit-grid">{keys.map((key) => <div key={key} className="audit-pair"><dt>{criteria[key]}</dt><dd>{display(review.draft?.scores[key])}</dd></div>)}</dl>
          {!!review.draft?.errors.length && <details><summary>Submitted error annotations</summary><pre>{JSON.stringify(review.draft.errors, null, 2)}</pre></details>}
        </div> : <p className="empty-state">The assigned reviewer can submit a grade after inspecting the response.</p>}
      </section>
    </div>
    {consensus && <section className="surface dashboard-panel">
      <SectionTitle title="Review consensus" note="Submitted grades and adjudication history." />
      <ConsensusView value={consensus} />
      {profile?.role === "admin" && consensus.status === "disputed" &&
        <Adjudicator response={review.response_id} rubric={review.rubric.id} reviews={consensus.reviews} changed={setConsensus} />}
    </section>}
  </>;
}

function ConsensusView({ value }: { value: Consensus }) {
  return <div className="research-result">
    <div className="result-provenance"><span className="pill">{friendly(value.status)}</span>
      <span className="pill">Submitted {value.submitted} / {value.assigned}</span>
      <span className="pill">Majority {value.majority ?? "—"}</span><span className="pill">Final verdict {value.final_verdict ?? "—"}</span>
      <span className="pill">Mean {display(value.mean_score)} · Range {display(value.score_range)}</span></div>
    {value.submitted > 0 && <div className="science-votes" role="group" aria-label="Reviewer disagreement">
      {(["correct", "incorrect", "uncertain"] as const).map((label) => <div key={label}>
        <span>{label}</span><progress value={value.votes[label] ?? 0} max={value.submitted} /><strong>{value.votes[label] ?? 0}</strong>
      </div>)}
    </div>}
    {value.decision && <p className="research-note">Adjudicated as {value.decision.verdict}. {value.decision.justification}</p>}
    {value.reviews.map((item) => <div className="research-note" key={item.id}>
      <strong>Review {item.id} · {item.verdict} · {display(item.score)}</strong>{item.comment}
    </div>)}
  </div>;
}

function Adjudicator({ response, rubric, reviews, changed }: { response: number; rubric: number; reviews: Consensus["reviews"]; changed: (value: Consensus) => void }) {
  const [verdict, setVerdict] = useState<Verdict>("uncertain");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true); setError("");
    try { changed(await science.adjudicate({ response_id: response, rubric_id: rubric, verdict, justification: text,
      review_ids: reviews.map((row) => row.id) })); }
    catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }
  return <form className="research-form science-adjudication" onSubmit={apply}>
    <Problem error={error} />
    <label>Adjudicated verdict<select aria-label="Adjudicated verdict" value={verdict} onChange={(event) => setVerdict(event.target.value as Verdict)}>
      <option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="uncertain">Uncertain</option>
    </select></label>
    <label>Adjudication justification<textarea rows={3} required maxLength={1800} value={text} onChange={(event) => setText(event.target.value)} /></label>
    <Button type="submit" disabled={working}>Resolve disagreement</Button>
  </form>;
}

export function DisputeQueue({ profile, rubrics }: { profile?: Profile; rubrics: Rubric[] }) {
  const [rows, setRows] = useState<Dispute[]>();
  const [chosen, setChosen] = useState<Dispute>();
  const [page, setPage] = useState(1);
  const [rubric, setRubric] = useState<number>();
  const [population, setPopulation] = useState<StudyFilters["population"]>("live");
  const [loaded, setLoaded] = useState<{ rubric: number; value: Awaited<ReturnType<typeof science.agreement>> }>();
  const [error, setError] = useState("");
  const id = rubric ?? rubrics.find((row) => row.name === "Standard linguistic rubric")?.id;
  const agreement = loaded?.rubric === id && loaded?.value.population === population ? loaded.value : undefined;
  useEffect(() => {
    let live = true;
    science.disputes(page).then((value) => { if (live) setRows(value); }, (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [page]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    science.agreement(id, population).then((value) => { if (live) setLoaded({ rubric: id, value }); },
      (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [id, population]);

  return <div className="studio-grid">
    <section className="surface dashboard-panel">
      <SectionTitle title="Reviewer agreement" note="Decisive reviews of current responses under one rubric version and data source." />
      <ScienceNotice busy={!agreement && !!id && !error} error={error} />
      <div className="research-form">
        <RubricSelect rubrics={rubrics} value={rubric} change={setRubric} />
        <label>Agreement data source<select value={population} onChange={(event) => setPopulation(event.target.value as StudyFilters["population"])}>
          <option value="live">Live responses</option><option value="demo">Curated demonstrations</option>
        </select></label>
      </div>
      {agreement && <><div className="result-provenance"><Population kind={agreement.population} /></div><div className="science-small-metrics">
        <ScoreCard label="Pair agreement" value={agreement.percent_agreement} suffix="%" note={`${agreement.pairs} decisive ${agreement.pairs === 1 ? "pair" : "pairs"}`} />
        <ScoreCard label={agreement.method ?? "Kappa"} value={agreement.coefficient} note={`${agreement.responses} responses`} />
      </div></>}
      {agreement?.message && <p className="research-note">{agreement.message}</p>}
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Disputed and adjudicated responses" note="Open a response to inspect conflicting judgments." />
      {rows?.length ? <div className="research-list">{rows.map((row) => <button type="button" key={`${row.response_id}-${row.rubric_id}`}
        aria-pressed={chosen?.response_id === row.response_id && chosen.rubric_id === row.rubric_id} onClick={() => setChosen(row)}>
        <strong>Response {row.response_id} · Rubric {row.rubric_id}</strong><small>{friendly(row.consensus.status)}</small>
      </button>)}</div> : rows ? <div className="empty-state">No disagreements require review.</div> : <Busy text="Loading disagreements…" />}
      {rows && <PageControls page={page} size={40} hasNext={rows.length === 40}
        change={(next) => { setRows(undefined); setChosen(undefined); setPage(next); }} />}
      {chosen && <><ConsensusView value={chosen.consensus} />
        {profile?.role === "admin" && chosen.consensus.status === "disputed" &&
          <Adjudicator response={chosen.response_id} rubric={chosen.rubric_id} reviews={chosen.consensus.reviews} changed={(value) => {
            setChosen({ ...chosen, consensus: value });
            setRows((entries) => entries?.map((row) => row.response_id === chosen.response_id && row.rubric_id === chosen.rubric_id
              ? { ...row, consensus: value } : row));
          }} />}</>}
    </section>
  </div>;
}
