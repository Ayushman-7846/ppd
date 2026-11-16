import type { ReactNode } from "react";
import { SectionTitle } from "@/components/science-controls";
import { display, type Stats } from "@/lib/evaluation-api";

export function ChartPanel({ title, note, empty, children }: { title: string; note?: string; empty?: boolean; children: ReactNode }) {
  return <section className="surface dashboard-panel science-chart-panel">
    <SectionTitle title={title} note={note} />
    {empty ? <p className="empty-state">No eligible observations.</p> : <div className="science-chart" role="group" aria-label={title}>{children}</div>}
  </section>;
}

export function StatisticsCard({ value, title = "Score summary" }: { value: Stats; title?: string }) {
  return <section className="surface dashboard-panel">
    <SectionTitle title={title} note="Available independent stimulus scores" />
    <dl className="audit-grid science-stats">
      <dt>Sample size</dt><dd>{value.n}</dd><dt>Mean</dt><dd>{display(value.mean)}</dd><dt>Median</dt><dd>{display(value.median)}</dd>
      <dt>Sample standard deviation</dt><dd>{display(value.sample_sd)}</dd><dt>Sample variance</dt><dd>{display(value.sample_variance)}</dd>
      <dt>95% bootstrap confidence interval</dt><dd>{value.confidence_interval?.map((bound) => display(bound)).join(" to ") ?? "Unavailable"}</dd>
    </dl>
    {!value.confidence_interval && <p className="research-hint">Insufficient data for reliable statistical analysis.</p>}
  </section>;
}
