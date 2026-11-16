"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { BarChart3, Clock, FileChartColumn, GitCompareArrows, Repeat2, Save, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Comparison as DemoComparison } from "@/components/dashboard";
import { ResearchAccess } from "@/components/research-access";
import { Busy, Problem, message } from "@/components/research-controls";
import { PageControls, Population, ScienceNotice, ScoreCard, SectionTitle, standardFilters, StudyControls, useScienceOptions } from "@/components/science-controls";
import { ChartPanel, StatisticsCard } from "@/components/science-metrics";
import { ResultAudit, ResultVisualization } from "@/components/research-result";
import { useToast } from "@/components/toast";
import { display, friendly, methods, science, type Analytics, type Comparison, type Consistency, type ConsistencyMetric, type RepeatGroup, type Snapshot, type StudyFilters } from "@/lib/evaluation-api";
import { research, showStimulus, type Result } from "@/lib/research-api";

const PerformanceCharts = dynamic(() => import("@/components/science-charts").then((module) => module.PerformanceCharts),
  { loading: () => <Busy text="Loading performance charts…" /> });
const Histogram = dynamic(() => import("@/components/science-charts").then((module) => module.Histogram));
const Trend = dynamic(() => import("@/components/science-charts").then((module) => module.Trend));

const config = {
  comparison: { title: "Model Comparison", description: "Compare recorded outputs and evaluate protocol alignment before ranking.", icon: GitCompareArrows },
  consistency: { title: "Consistency Laboratory", description: "Measure reliability across matched repetitions of the same stimulus.", icon: Repeat2 },
  analytics: { title: "Research Analytics", description: "Explore performance, uncertainty, and reviewer agreement from saved experiments.", icon: BarChart3 },
  leaderboard: { title: "Model Leaderboard", description: "Rank models within a matched cohort using a consistent rubric and scoring method.", icon: Trophy },
} as const;
type Mode = keyof typeof config;
type StudyResult = Comparison | Consistency | Analytics;

export function StudyWorkspace({ mode }: { mode: Mode }) {
  return <ResearchAccess demo={mode === "comparison" ? <DemoComparison /> : undefined}>
    <StudyPage mode={mode} />
  </ResearchAccess>;
}

function StudyPage({ mode }: { mode: Mode }) {
  const { options, rubrics, error: optionError } = useScienceOptions();
  const [filters, setFilters] = useState<StudyFilters>(standardFilters);
  const [result, setResult] = useState<StudyResult>();
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const page = config[mode];
  const Icon = page.icon;
  const canSave = mode === "comparison" || mode === "consistency";
  const toast = useToast();

  useEffect(() => {
    if (!canSave) return;
    let live = true;
    science.snapshots(mode as Snapshot["kind"], historyPage).then((value) => { if (live) setHistory(value); },
      (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [canSave, mode, saved, historyPage]);

  useEffect(() => {
    if (!canSave) return;
    const identifier = Number(new URLSearchParams(window.location.search).get("snapshot"));
    if (!identifier) return;
    let live = true;
    science.snapshot<StudyResult>(mode as Snapshot["kind"], identifier).then((row) => {
      if (live && row.kind === mode && row.result) { setResult(row.result); setFilters(row.filters); }
    }, (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [canSave, mode]);

  async function calculate(save: boolean) {
    setWorking(true); setError("");
    try {
      const value = await science[mode === "comparison" ? "compare" : mode]({ ...filters, save, semantic: false });
      setResult(value);
      if (save) { setSaved((value) => value + 1); toast("Research snapshot saved"); }
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  async function open(entry: Snapshot) {
    setWorking(true); setError("");
    try {
      const row = await science.snapshot<StudyResult>(entry.kind, entry.id);
      if (row.result) { setResult(row.result); setFilters(row.filters); }
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  async function semantic(group: RepeatGroup) {
    setWorking(true); setError("");
    try {
      const exact = { ...filters, experiment_ids: [group.experiment_id], model_ids: [group.model_id], item_id: group.item_id,
        prompt_id: group.prompt_id, population: group.provider === "demo" ? "demo" as const : "live" as const, semantic: true, save: true };
      setResult(await science.consistency(exact)); setFilters(exact); setSaved((value) => value + 1);
      toast("Semantic similarity snapshot saved");
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void calculate(false);
  }

  return <div className="science-page">
    <div className="lab-title"><div><span className="eyebrow"><Icon size={15} /> EXPERIMENT EVIDENCE</span><h1>{page.title}</h1><p>{page.description}</p></div>
      {mode === "consistency" && <Button asChild variant="outline"><Link href="/lab/experiments">Configure repetitions</Link></Button>}
      {mode === "comparison" && <Button asChild variant="outline"><Link href="/lab/leaderboard">Open leaderboard</Link></Button>}
    </div>
    <section className="surface dashboard-panel science-filter-panel">
      <SectionTitle title="Research cohort" note="Choose a source, evaluation method, and rubric before calculating." />
      <form className="research-form" onSubmit={submit}>
        <StudyControls value={filters} change={setFilters} options={options} rubrics={rubrics} repeat={mode === "consistency"} />
        <div className="research-actions">
          <Button type="submit" disabled={working || !options}><Icon size={16} /> {mode === "comparison" ? "Compare models" : mode === "consistency" ? "Analyze repetitions" : mode === "leaderboard" ? "Calculate leaderboard" : "Calculate analytics"}</Button>
          {canSave && <Button variant="outline" disabled={working || !options} onClick={() => calculate(true)}><Save size={15} /> Save cohort snapshot</Button>}
        </div>
      </form>
      <ScienceNotice busy={working} error={error || optionError} text="Calculating from stored observations…" />
    </section>
    {result && <div className="result-provenance">
      <Population kind={result.population} /><span className="pill">{methods[result.method]}</span>
      <span className="pill">{result.rubric.name} · v{result.rubric.version}</span>
      <span className="pill">{result.metric_version}</span>
    </div>}
    {result && "models" in result && <ComparisonResults value={result} rankOnly={mode === "leaderboard"} />}
    {result && "groups" in result && <ConsistencyResults value={result} semanticModel={options?.semantic_model}
      working={working} calculateSemantic={semantic} />}
    {result && "metrics" in result && <AnalyticsResults value={result} />}
    {!result && !working && <div className="empty-state">Calculate a cohort to view saved experimental measurements.</div>}
    {canSave && <section className="surface dashboard-panel">
      <SectionTitle title="Saved cohort snapshots" note="Open the exact results captured when a cohort was saved." />
      {history.length ? <div className="research-list">{history.map((entry) => <button type="button" key={entry.id} disabled={working} onClick={() => open(entry)}>
        <strong>{friendly(entry.kind)} {entry.id}</strong><small>{new Date(entry.created_at).toLocaleString()} · {methods[entry.filters.method]} · {entry.filters.population}</small>
      </button>)}</div> : <p className="empty-state">No saved snapshots on this page.</p>}
      <PageControls page={historyPage} hasNext={history.length === 20} size={20} change={setHistoryPage} />
    </section>}
    {mode === "comparison" && <details className="surface prior-demo"><summary>Open Phase 1 synthetic comparison</summary><DemoComparison /></details>}
  </div>;
}

function ComparisonResults({ value, rankOnly = false }: { value: Comparison; rankOnly?: boolean }) {
  return <>
    {value.warning && <div role="status" className="research-note science-caution">{value.warning}</div>}
    <section className="surface dashboard-panel">
      <SectionTitle title={rankOnly ? "Comparable rankings" : "Comparison detail"} note="Weighted means use independent stimuli. Verdict rates exclude absent and uncertain verdicts." />
      {value.models.length ? <div className="table-scroll"><table>
        <thead><tr><th>Rank</th><th>Model / provider</th><th>Mean score</th><th>Scored trials</th><th>Correctness</th><th>Explanation</th>
          <th>Structure</th><th>Repeat agreement</th><th>Latency</th><th>Tokens in / out</th><th>Failures</th><th>Evaluated with errors</th></tr></thead>
        <tbody>{value.models.map((row) => <tr key={row.id}><td>{row.rank ?? "—"}</td>
          <th scope="row">{row.model}<small className="science-block muted">{row.provider}</small></th>
          <td>{display(row.metrics.score.mean)}</td><td>{row.metrics.weighted_scores} / {row.metrics.responses}<small className="science-block muted">n = {row.metrics.score.n} stimuli</small></td>
          <td>{display(row.metrics.correctness_rate, "%")}<small className="science-block muted">n = {row.metrics.decisive} verdicts</small></td>
          <td>{display(row.metrics.criteria.explanation_quality)}</td><td>{display(row.metrics.criteria.structural_validity)}</td>
          <td>{display(row.consistency, "%")}</td><td>{display(row.metrics.latency_ms, " ms")}</td>
          <td>{display(row.metrics.input_tokens)} / {display(row.metrics.output_tokens)}</td>
          <td>{display(row.metrics.failure_rate, "%")}</td><td>{display(row.metrics.annotated_error_rate, "%")}</td></tr>)}</tbody>
      </table></div> : <p className="empty-state">No model responses match this cohort.</p>}
    </section>
    {value.findings.length > 0 && <section className="surface dashboard-panel">
      <SectionTitle title="Calculated observations" note="Descriptive findings from matched tasks." />
      <div className="science-findings">{value.findings.map((finding) => <p className="research-note" key={finding.task}>
        <strong>{finding.task}</strong>{finding.model} had the highest observed mean ({display(finding.score)}).
      </p>)}</div>
    </section>}
    {value.models.length > 0 && <PerformanceCharts value={value} condensed={rankOnly} />}
    {!rankOnly && !!value.paired.length && <section className="surface dashboard-panel">
      <SectionTitle title="Paired model comparisons" note="Matched protocols only. Repeat differences are aggregated within stimulus." />
      <div className="table-scroll"><table>
        <thead><tr><th>Model pair</th><th>Matched stimuli</th><th>Mean difference</th><th>95% bootstrap interval</th></tr></thead>
        <tbody>{value.paired.map((row) => <tr key={`${row.first}-${row.second}`}>
          <th scope="row">{value.models.find(({ id }) => id === row.first)?.model} / {value.models.find(({ id }) => id === row.second)?.model}</th>
          <td>{row.difference.n}</td><td>{display(row.difference.mean)}</td>
          <td className="science-wrap">{row.difference.confidence_interval?.map((bound) => display(bound)).join(" to ") ?? row.message}</td></tr>)}</tbody>
      </table></div>
    </section>}
    {!rankOnly && <ResponseExplorer value={value} />}
  </>;
}

function ResponseExplorer({ value }: { value: Comparison }) {
  const [itemId, setItemId] = useState<number>();
  const [ordinal, setOrdinal] = useState<number>();
  const [sync, setSync] = useState(false);
  const [page, setPage] = useState(1);
  const item = value.explorer.find((row) => row.item_id === itemId);
  const keys = [...new Set(item?.responses.map((row) => row.trial) ?? [])];
  const selected = item?.responses.filter((entry) => entry.trial === (ordinal ?? keys[0])) ?? [];
  const references = selected.slice((page - 1) * 12, page * 12);
  return <section className="surface dashboard-panel">
    <SectionTitle title="Side-by-side response explorer" note="Open one stored item and inspect outputs, scores, and annotations." />
    {value.explorer.length > 0 ? <div className="research-form science-filters">
      <label>Test item<select aria-label="Test item" value={itemId ?? ""} onChange={(event) => { setItemId(Number(event.target.value) || undefined); setOrdinal(undefined); setPage(1); }}>
        <option value="">Choose a shared item</option>{value.explorer.map((row) => <option value={row.item_id} key={row.item_id}>{row.key} · {row.dimension}</option>)}
      </select></label>
      {!!keys.length && <label>Trial<select aria-label="Trial" value={ordinal ?? keys[0]} onChange={(event) => { setOrdinal(Number(event.target.value)); setPage(1); }}>
        {keys.map((trial) => <option key={trial}>{trial}</option>)}</select></label>}
      <label className="check-field"><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} /> Synchronize panes</label>
    </div> : <p className="empty-state">Two models must have responses for the same item to open the explorer.</p>}
    {selected.length > 12 && <PageControls page={page} total={selected.length} size={12} change={setPage} />}
    {!!references.length && <StoredResponses ids={references.map((row) => row.id)} synchronized={sync} extras={references} />}
  </section>;
}

export function StoredResponses({ ids, synchronized = false, extras = [] }: { ids: number[]; synchronized?: boolean;
  extras?: Comparison["explorer"][number]["responses"] }) {
  const [loaded, setLoaded] = useState<{ key: string; results: Result[]; error: string }>();
  const key = ids.map((id) => `${id}:${extras.find((entry) => entry.id === id)?.output_hash ?? ""}`).join(",");
  const results = loaded?.key === key ? loaded.results : undefined;
  const error = loaded?.key === key ? loaded.error : "";
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const requests = key.split(",").filter(Boolean).map((entry) => entry.split(":"));
    Promise.allSettled(requests.map(([id, hash]) => research.result(Number(id), controller.signal, hash || undefined)))
      .then((values) => {
        if (!live) return;
        const results = values.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
        const failures = values.flatMap((entry, index) => entry.status === "rejected" ?
          [`Response ${requests[index][0]}. ${message(entry.reason)}`] : []);
        setLoaded({ key, results, error: failures.join(" ") });
      });
    return () => { live = false; controller.abort(); };
  }, [key]);
  return <>
    <ScienceNotice busy={!results && !error} error={error} />
    {results?.length ? <>
      <blockquote className="research-quote science-stimulus">{showStimulus(results[0].stimulus)}</blockquote>
      <div className="science-response-grid">{results.map((row) => {
        const reference = extras.find((model) => model.id === row.id);
        const entry = reference?.output_hash ? reference : undefined;
        return <div className="science-response-pane surface dashboard-panel" key={row.id} onScroll={(event) => {
          if (!synchronized) return;
          const exact = event.currentTarget.scrollTop;
          event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".science-response-pane").forEach((target) => {
            if (target !== event.currentTarget && target.scrollTop !== exact && exact <= target.scrollHeight - target.clientHeight) target.scrollTop = exact;
          });
        }}>
          <SectionTitle title={row.model} note={`Experiment ${row.experiment_id} · Trial ${row.trial} · ${row.provider}`} />
          {reference && !entry && <p className="research-note">This older snapshot lacks a response version. Current output is shown without its archived grade.</p>}
          {entry && <p className="research-note">Score {display(entry.score)} · Verdict {entry.verdict ?? "—"}</p>}
          <ResultVisualization result={row} />
          {!!entry?.errors.length && <ul className="science-annotations">
            {entry.errors.map((item, index) => <li key={index}>{friendly(item.category)} · {item.severity} · {item.evidence}</li>)}
          </ul>}
          {!!entry?.reviews.length && entry.reviews.map((review) => <p className="research-note" key={review.id}>{review.comment}</p>)}
          <details className="result-audit"><summary>Response audit</summary><ResultAudit result={row} /></details>
        </div>;
      })}</div>
    </> : null}
  </>;
}

const agreements: Record<ConsistencyMetric, string> = { classification: "Classification agreement", structure: "Structural agreement",
  verdict: "Decisive verdict agreement", exact: "Exact response agreement" };

function ConsistencyResults({ value, semanticModel, working, calculateSemantic }: {
  value: Consistency; semanticModel?: string | null; working: boolean; calculateSemantic: (group: RepeatGroup) => void;
}) {
  const [chosen, setChosen] = useState(0);
  const [explore, setExplore] = useState(false);
  const group = value.groups[chosen] ?? value.groups[0];
  if (!group) return <div className="empty-state">{value.message}</div>;
  return <>
    <div className="metric-grid">{Object.entries(agreements).map(([key, label]) =>
      <ScoreCard key={key} label={label} value={value.summary[key as ConsistencyMetric]} suffix="%" note={`Mean over up to ${value.group_count} matched groups`} />)}</div>
    <section className="surface dashboard-panel">
      <SectionTitle title="Repeated-run timeline" note="Choose one matched set. The matrix shows structural equality on eligible pairs." action={<Clock size={19} />} />
      <div className="research-form">
        <label>Repeated-run group<select aria-label="Repeated-run group" value={value.groups.indexOf(group)} onChange={(event) => {
          setChosen(Number(event.target.value)); setExplore(false);
        }}>{value.groups.map((row, index) => <option key={index} value={index}>
          {row.experiment} · {row.model} · {row.item_key} · {row.trials.length} trials
        </option>)}</select></label>
      </div>
    </section>
    <RepeatDetail group={group} />
    <section className="surface dashboard-panel">
      <SectionTitle title="Semantic similarity" note={semanticModel
        ? `Cosine similarity for one matched group using ${semanticModel}. The result is descriptive.`
        : "Configure a server-side Ollama embedding model to compute cosine similarity."}
        action={semanticModel && <Button variant="outline" size="small" disabled={working}
          onClick={() => calculateSemantic(group)}>Calculate and save similarity</Button>} />
      {value.semantic && <div className="table-scroll"><table className="science-heatmap">
        <caption>{value.semantic.model} · {value.semantic.method} · {value.semantic.n} embedded outputs
          {value.semantic.dimensions && ` · ${value.semantic.dimensions} dimensions`}
          {value.semantic.reported_model && value.semantic.reported_model !== value.semantic.model && ` · reported as ${value.semantic.reported_model}`}</caption>
        <thead><tr><th>Trial</th>{group.trials.map((trial) => <th scope="col" key={trial.id}>{trial.trial}</th>)}</tr></thead>
        <tbody>{value.semantic.matrix.map((row, index) => <tr key={index}><th scope="row">{group.trials[index]?.trial}</th>
          {row.map((entry, column) => <td key={column}>{display(entry)}</td>)}</tr>)}</tbody>
      </table></div>}
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Variability heatmap" note="Sample standard deviation of weighted trial scores by matched group." />
      <div className="table-scroll science-tall-table"><table><thead><tr><th>Item</th><th>Model</th><th>Trials</th><th>Mean</th><th>Sample SD</th></tr></thead>
        <tbody>{value.groups.map((row, index) => <tr key={index}><th scope="row">{row.item_key}</th><td>{row.model}</td><td>{row.trials.length}</td>
          <td>{display(row.metrics.score.mean)}</td><td style={row.metrics.score.sample_sd == null ? {} :
            { background: `color-mix(in srgb, var(--violet) ${Math.min(48, row.metrics.score.sample_sd)}%, var(--panel))` }}>{display(row.metrics.score.sample_sd)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Run-by-run comparison" note="Inspect the underlying responses for the selected item and model." />
      <Button size="small" variant="outline" onClick={() => setExplore(!explore)}>{explore ? "Hide trials" : "Open repeated responses"}</Button>
      {explore && <StoredResponses ids={group.trials.map((row) => row.id)} />}
    </section>
  </>;
}

function RepeatDetail({ group }: { group: RepeatGroup }) {
  const stats = group.metrics.score;
  const distribution = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]].map(([low, high]) =>
    group.trials.filter((row) => row.score != null && row.score >= low && row.score < high).length);
  return <div className="science-chart-grid">
    <ChartPanel title="Trial score timeline" note={`Prompt ${group.prompt_id} · dataset v${group.dataset_version}`} empty={!stats.n}>
      <Trend data={group.trials.map((row) => ({ date: `Trial ${row.trial}`, score: row.score }))} keys={["score"]} labels={["Weighted score"]} domain={[0, 100]} />
    </ChartPanel>
    <ChartPanel title="Trial score distribution" note={`${stats.n} weighted scores · sample SD ${display(stats.sample_sd)} · variance ${display(stats.sample_variance)}`} empty={!stats.n}>
      <Histogram bins={distribution} />
    </ChartPanel>
    <section className="surface dashboard-panel">
      <SectionTitle title="Pairwise structural matrix" note="1 = same canonical structure · 0 = different · — = unavailable" />
      <div className="table-scroll"><table className="science-heatmap">
        <thead><tr><th>Trial</th>{group.trials.map((row) => <th scope="col" key={row.id}>{row.trial}</th>)}</tr></thead>
        <tbody>{group.metrics.matrix.map((row, index) => <tr key={group.trials[index].id}><th scope="row">{group.trials[index].trial}</th>
          {row.map((value, second) => <td key={group.trials[second].id} className={value === 1 ? "matrix-match" : value === 0 ? "matrix-differ" : ""}>{value ?? "—"}</td>)}</tr>)}</tbody>
      </table></div>
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Agreement denominators" note="Each metric uses only pairs with both values available." />
      <dl className="audit-grid science-stats">{Object.entries(agreements).map(([name, label]) => <div className="audit-pair" key={name}>
        <dt>{label}</dt><dd>{display(group.metrics[name as ConsistencyMetric].percent, "%")} · {group.metrics[name as ConsistencyMetric].pairs} pairs</dd>
      </div>)}</dl>
      <p className="research-hint">These measurements compare fields or canonical structures.</p>
    </section>
  </div>;
}

export function AnalyticsResults({ value }: { value: Analytics }) {
  const metrics = value.metrics;
  const completion = value.review_count ? 100 * value.reviews_submitted / value.review_count : null;
  return <>
    <div className="metric-grid science-overview">
      <ScoreCard label="Experiments" value={value.experiments} /><ScoreCard label="Tested models" value={value.model_count} />
      <ScoreCard label="Evaluated responses" value={metrics.evaluated} note={`${metrics.responses} eligible records`} />
      <ScoreCard label="Decisive correctness" value={metrics.correctness_rate} suffix="%" note={`n = ${metrics.decisive} verdicts`} />
      <ScoreCard label="Average rubric score" value={metrics.score.mean} note={`n = ${metrics.score.n} independent stimuli`} />
      <ScoreCard label="Structural repeat agreement" value={value.repeat_summary.structure} suffix="%" note={`${value.repeat_group_count} matched groups`} />
      <ScoreCard label="Average latency" value={metrics.latency_ms} suffix=" ms" note={`n = ${metrics.latency_n} known timings`} />
      <ScoreCard label="Review completion" value={completion} suffix="%" note={`${value.reviews_submitted} / ${value.review_count} assignments`} />
    </div>
    <div className="science-chart-grid">
      <ChartPanel title="Correctness trend" note="Decisive verdict rate by recorded date" empty={!value.trends.some((row) => row.correctness != null)}>
        <Trend data={value.trends} keys={["correctness"]} labels={["Correctness %"]} domain={[0, 100]} />
      </ChartPanel>
      <ChartPanel title="Consistency trend" note="Mean structural agreement across eligible repeated groups" empty={!value.consistency_trend.some((row) => row.structure != null)}>
        <Trend data={value.consistency_trend} keys={["structure"]} labels={["Structural agreement %"]} domain={[0, 100]} />
      </ChartPanel>
      <ChartPanel title="Evaluation score distribution" note="Count of weighted trial scores by band" empty={!metrics.weighted_scores}><Histogram bins={metrics.distribution} /></ChartPanel>
      <StatisticsCard value={metrics.score} />
      <section className="surface dashboard-panel">
        <SectionTitle title="Reviewer agreement" note="Pair agreement and eligible kappa analysis" />
        <div className="science-small-metrics">
          <ScoreCard label="Percent agreement" value={value.review_agreement.percent_agreement} suffix="%" note={`${value.review_agreement.pairs} pairs`} />
          <ScoreCard label={value.review_agreement.method ?? "Kappa"} value={value.review_agreement.coefficient} note={`${value.review_agreement.responses} responses`} />
        </div>
        {value.review_agreement.message && <p className="research-hint">{value.review_agreement.message}</p>}
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Model rankings" note="Ranks appear only for comparable cohorts." action={<Trophy size={16} />} />
        {value.comparison.comparable ? <div className="science-votes">{value.comparison.models.map((row) => <div key={row.id}>
          <span>{row.rank}. {row.model}</span><progress value={row.metrics.score.mean ?? 0} max={100} /><strong>{display(row.metrics.score.mean)}</strong>
        </div>)}</div> : <p className="research-note">{value.comparison.warning}</p>}
      </section>
    </div>
    {value.comparison.models.length > 0 && <PerformanceCharts value={value.comparison} condensed />}
    <section className="surface dashboard-panel">
      <SectionTitle title="Dataset difficulty" note="Observed decisive verdicts and score coverage per dataset version." />
      {value.datasets.length ? <div className="table-scroll"><table><thead><tr><th>Dataset version</th><th>Responses</th><th>Decisive verdicts</th>
        <th>Correctness</th><th>Score coverage</th></tr></thead><tbody>{value.datasets.map((row) =>
        <tr key={row.id}><th scope="row">{row.name} v{row.version}</th><td>{row.metrics.responses}</td><td>{row.metrics.decisive}</td>
          <td>{display(row.metrics.correctness_rate, "%")}</td><td>{row.metrics.weighted_scores} weighted trials</td></tr>)}</tbody></table></div> :
        <p className="empty-state">No dataset records match this cohort.</p>}
    </section>
    <section className="surface dashboard-panel">
      <SectionTitle title="Statistical definitions" note="Assumptions, missing observations, and interpretation." action={<FileChartColumn size={18} />} />
      <dl className="science-definitions">{Object.entries(value.definitions).map(([key, definition]) => <div key={key}><dt>{friendly(key)}</dt><dd>{definition}</dd></div>)}</dl>
    </section>
  </>;
}
