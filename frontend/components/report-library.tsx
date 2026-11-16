"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Download, FileText } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { message } from "@/components/research-controls";
import { PageControls, Population, ScienceNotice, ScoreCard, SectionTitle, standardFilters, StudyControls, useScienceOptions } from "@/components/science-controls";
import { StatisticsCard } from "@/components/science-metrics";
import { display, methods, reportDownload, reportTypes, science, type Report, type ReportRecord, type ReportType, type StudyFilters } from "@/lib/evaluation-api";
import { useToast } from "@/components/toast";

export function ReportLibrary() {
  return <ResearchAccess><Library /></ResearchAccess>;
}

function Library() {
  const { options, rubrics, error: optionError } = useScienceOptions();
  const [filters, setFilters] = useState<StudyFilters>(standardFilters);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReportType>("experiment");
  const [report, setReport] = useState<Report>();
  const [library, setLibrary] = useState<ReportRecord[]>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    let active = true;
    science.reports(page).then((value) => { if (active) setLibrary(value); }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [page, revision]);
  useEffect(() => {
    let active = true;
    const identifier = Number(new URLSearchParams(window.location.search).get("report"));
    if (identifier) science.report(identifier).then((value) => { if (active) setReport(value); },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);

  async function run(work: () => Promise<Report>, created: boolean) {
    setError(""); setWorking(true);
    try {
      const value = await work();
      setReport(value);
      if (created) { setRevision((count) => count + 1); setPage(1); toast("Research report generated"); }
    } catch (reason) { setError(message(reason)); }
    finally { setWorking(false); }
  }

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filters.experiment_ids?.length) { setError("Select at least one settled experiment in cohort filters."); return; }
    void run(() => science.generateReport({ title, type, filters }), true);
  }

  return <div className="science-page">
    <div className="lab-title"><div><span className="eyebrow"><FileText size={15} /> SCIENTIFIC REPORTING</span><h1>Research Reports</h1>
      <p>Freeze experimental results and export the evidence in three formats.</p></div></div>
    <div className="studio-grid">
      <section className="surface dashboard-panel">
        <SectionTitle title="Report library" note="Saved reports retain the source statistics and cohort filters." />
        {library?.length ? <div className="research-list">
          {library.map((entry) => <button key={entry.id} type="button" disabled={working} aria-pressed={entry.id === report?.id}
            onClick={() => run(() => science.report(entry.id), false)}><strong>{entry.title}</strong>
            <small>LL-{entry.id} · {reportTypes[entry.type]} · {entry.population}</small></button>)}
        </div> : library && <p className="empty-state">No reports on this page.</p>}
        {library && <PageControls page={page} hasNext={library.length === 20} size={20} change={setPage} />}
      </section>
      <section className="surface dashboard-panel">
        <SectionTitle title="Generate a report" note="Select settled experiments and an explicit evaluation method." />
        <form className="research-form" onSubmit={generate}>
          <label>Report title<input required value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Report type<select aria-label="Report type" value={type} onChange={(event) => setType(event.target.value as ReportType)}>
            {Object.entries(reportTypes).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select></label>
          <StudyControls value={filters} change={setFilters} options={options} rubrics={rubrics} report />
          <Button type="submit" disabled={working || !options}><FileText size={16} /> Generate report</Button>
        </form>
        <ScienceNotice busy={working} error={error || optionError} text="Preparing report…" />
      </section>
    </div>
    {report && <section className="surface dashboard-panel science-report">
      <SectionTitle title={report.title} note={`LL-${report.id} · ${report.researcher} · ${new Date(report.generated_at).toLocaleString()}`} />
      <div className="result-provenance"><Population kind={report.population} /><span className="pill">{reportTypes[report.type]}</span>
        <span className="pill">{methods[report.method]}</span><span className="pill">{report.rubric.name} · v{report.rubric.version}</span></div>
      <div className="research-actions">
        {(["pdf", "csv", "json"] as const).map((format) => <Button key={format} asChild variant={format === "pdf" ? "primary" : "outline"} size="small">
          <a href={reportDownload(report.id, format)}><Download size={15} /> Download {format.toUpperCase()}</a></Button>)}
      </div>
      <div className="metric-grid">
        <ScoreCard label="Recorded trials" value={report.analytics.metrics.responses} />
        <ScoreCard label="Weighted scores" value={report.analytics.metrics.weighted_scores} />
        <ScoreCard label="Decisive correctness" value={report.analytics.metrics.correctness_rate} suffix="%" />
        <ScoreCard label="Structural agreement" value={report.consistency.summary.structure} suffix="%" />
      </div>
      <div className="science-chart-grid">
        <StatisticsCard value={report.analytics.metrics.score} title="Report statistics" />
        <section className="surface dashboard-panel"><SectionTitle title="Source experiments" />
          <div className="research-list">{report.experiments.map((run) => <div key={run.id}><strong>{run.name}</strong>
            <small>{run.state} · {run.repetitions} repetitions</small></div>)}</div>
          {report.analytics.comparison.models.map((row) => <p key={row.id} className="research-note">{row.model} · mean {display(row.metrics.score.mean)} · {row.metrics.score.n} stimuli</p>)}
        </section>
      </div>
    </section>}
  </div>;
}
