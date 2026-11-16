"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Busy, Problem, message } from "@/components/research-controls";
import { Button } from "@/components/ui/button";
import { dimensions, type Dimension } from "@/lib/research";
import { display, methods, science, type Options, type Rubric, type StudyFilters } from "@/lib/evaluation-api";

export const standardFilters: StudyFilters = { population: "live", method: "deterministic", minimum_items: 5 };

export function useScienceOptions() {
  const [options, setOptions] = useState<Options>();
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([science.options(), science.rubrics()]).then(([data, versions]) => {
      if (live) { setOptions(data); setRubrics(versions); }
    }, (reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, []);
  return { options, rubrics, error };
}

export function SectionTitle({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>;
}

export function ScoreCard({ label, value, suffix, note }: { label: string; value: number | null | undefined; suffix?: string; note?: string }) {
  return <article className="surface metric-card science-metric"><div><span>{label}</span></div><strong>{display(value, suffix)}</strong>{note && <small>{note}</small>}</article>;
}

export function PageControls({ page, total, size, hasNext, change }: { page: number; total?: number; size: number;
  hasNext?: boolean; change: (page: number) => void }) {
  const next = total == null ? hasNext : page * size < total;
  if (page === 1 && !next) return null;
  return <div className="research-actions pagination">
    <Button variant="outline" size="small" disabled={page <= 1} onClick={() => change(page - 1)}><ChevronLeft size={14} /> Previous</Button>
    <span>Page {page}{total == null ? "" : ` · ${total} records`}</span>
    <Button variant="outline" size="small" disabled={!next} onClick={() => change(page + 1)}>Next <ChevronRight size={14} /></Button>
  </div>;
}

export function Population({ kind }: { kind: StudyFilters["population"] }) {
  return <span className={kind === "demo" ? "pill pill-demo" : "pill status-running"}>
    {kind === "demo" ? "Curated demonstration data" : "Recorded live responses"}
  </span>;
}

export function RubricSelect({ rubrics, value, change, allowDefault = true }:
  { rubrics: Rubric[]; value?: number; change: (value: number | undefined) => void; allowDefault?: boolean }) {
  return <label>Rubric version<select aria-label="Rubric version" value={value ?? ""} onChange={(event) => change(Number(event.target.value) || undefined)}>
    <option value="" disabled={!allowDefault}>{allowDefault ? "Standard linguistic rubric" : "Select rubric"}</option>
    {rubrics.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · v{entry.version}</option>)}
  </select></label>;
}

export function StudyControls({ value, change, options, rubrics, report, repeat }:
  { value: StudyFilters; change: (value: StudyFilters) => void; options?: Options; rubrics: Rubric[]; report?: boolean; repeat?: boolean }) {
  const update = (field: keyof StudyFilters, next: unknown) => change({ ...value, [field]: next });
  const choose = (entries: { id: number; name: string }[], field: "model_ids" | "dataset_ids" | "experiment_ids", title: string) =>
    <label>{title}<select multiple aria-label={title} size={Math.min(4, Math.max(2, entries.length))} value={(value[field] ?? []).map(String)}
      onChange={(event) => update(field, Array.from(event.currentTarget.selectedOptions, (option) => Number(option.value)))}>
      {entries.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
    </select><small className="research-hint">Empty selection includes all available records.</small></label>;
  return <>
    <div className="science-filters research-form">
      <label>Data source<select aria-label="Data source" value={value.population} onChange={(event) =>
        change({ ...value, population: event.target.value as StudyFilters["population"], model_ids: [], provider: undefined })}>
        <option value="live">Live responses</option><option value="demo">Curated demonstrations</option>
      </select></label>
      <label>Evaluation method<select aria-label="Evaluation method" value={value.method} onChange={(event) => update("method", event.target.value)}>
        {Object.entries(methods).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <RubricSelect rubrics={rubrics} value={value.rubric_id} change={(id) => update("rubric_id", id)} />
      <label>Linguistic task<select aria-label="Linguistic task" value={value.dimension ?? ""} onChange={(event) => update("dimension", event.target.value || undefined)}>
        <option value="">All dimensions</option>
        {dimensions.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
      </select></label>
    </div>
    <details className="surface cohort-details" open={report || undefined}>
      <summary><SlidersHorizontal size={15} /> Cohort filters</summary>
      {options && <div className="science-filters research-form">
        {choose(options.models.filter((row) => value.population === "demo" ? row.provider === "demo" : row.provider !== "demo")
          .map((row) => ({ ...row, name: `${row.name} · ${row.provider}` })), "model_ids", "Models")}
        {choose(options.experiments.filter((row) => !report || ["completed", "failed", "cancelled"].includes(row.state)), "experiment_ids", "Experiments")}
        {choose(options.datasets.map((row) => ({ ...row, name: `${row.name} · v${row.version}` })), "dataset_ids", "Dataset versions")}
        <div className="science-subfilter">
          <label>From<input type="date" value={value.date_from ?? ""} onChange={(event) => update("date_from", event.target.value || undefined)} /></label>
          <label>Through<input type="date" value={value.date_to ?? ""} onChange={(event) => update("date_to", event.target.value || undefined)} /></label>
        </div>
        <label>Provider<select aria-label="Provider" value={value.provider ?? ""} onChange={(event) => update("provider", event.target.value || undefined)}>
          <option value="">Any provider</option>
          {[...new Set(options.models.map((row) => row.provider))].map((provider) => <option value={provider} key={provider}>{provider}</option>)}
        </select></label>
        <label>Ranking minimum matched items<input type="number" min={3} max={100} value={value.minimum_items ?? ""} onChange={(event) =>
          update("minimum_items", event.target.valueAsNumber || undefined)} /></label>
        {repeat && <>
          <label>Recorded prompt ID<input type="number" min={1} value={value.prompt_id ?? ""} onChange={(event) => update("prompt_id", event.target.valueAsNumber || undefined)} /></label>
          <label>Temperature<input type="number" min={0} max={2} step=".01" value={value.temperature ?? ""} onChange={(event) =>
            update("temperature", event.target.value === "" ? undefined : event.target.valueAsNumber)} /></label>
          <label>Recorded repetition count<input type="number" min={2} max={5} value={value.repetitions ?? ""} onChange={(event) => update("repetitions", event.target.valueAsNumber || undefined)} /></label>
          <label>Stored dataset item ID<input type="number" min={1} value={value.item_id ?? ""} onChange={(event) => update("item_id", event.target.valueAsNumber || undefined)} /></label>
        </>}
      </div>}
    </details>
  </>;
}

export function ScienceNotice({ busy, error, text = "Loading research records…" }: { busy: boolean; error: string; text?: string }) {
  return <><Problem error={error} />{busy && <Busy text={text} />}</>;
}
