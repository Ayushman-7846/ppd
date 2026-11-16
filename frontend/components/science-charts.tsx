"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dimensions } from "@/lib/research";
import { criteria, display, friendly, type Comparison } from "@/lib/evaluation-api";
import { SectionTitle } from "@/components/science-controls";
import { ChartPanel } from "@/components/science-metrics";

const colors = ["#6d91ff", "#a591ff", "#52d0df", "#65deba", "#e7a271", "#e27bb3"];
const axis = { fill: "var(--muted)", fontSize: 10 };
const tooltip = { background: "var(--panel)", borderColor: "var(--line)", borderRadius: 8, fontSize: 12 };

export function Trend({ data, keys, labels, domain }: {
  data: Record<string, unknown>[]; keys: string[]; labels: string[]; domain?: [number, number];
}) {
  return <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 240 }}>
    <LineChart data={data} margin={{ left: -13, right: 15, top: 8 }}>
      <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" />
      <XAxis dataKey="date" tick={axis} tickLine={false} /><YAxis domain={domain} tick={axis} tickLine={false} />
      <Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 10 }} />
      {keys.map((key, index) => <Line key={key} dataKey={key} name={labels[index]} stroke={colors[index]} isAnimationActive={false}
        connectNulls={false} strokeWidth={2.5} dot={{ r: 4 }} />)}
    </LineChart>
  </ResponsiveContainer>;
}

function Bars({ data, keys, names, domain }: {
  data: Record<string, unknown>[]; keys: string[]; names?: string[]; domain?: [number, number];
}) {
  return <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 240 }}>
    <BarChart data={data} margin={{ left: -13, right: 8, top: 8 }}>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 4" />
      <XAxis dataKey="label" tick={axis} tickLine={false} /><YAxis domain={domain} tick={axis} tickLine={false} />
      <Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 10 }} />
      {keys.map((key, index) => <Bar key={key} dataKey={key} name={names?.[index] ?? friendly(key)} fill={colors[index % colors.length]}
        radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={35} />)}
    </BarChart>
  </ResponsiveContainer>;
}

export function Histogram({ bins }: { bins: number[] }) {
  const labels = ["0–19", "20–39", "40–59", "60–79", "80–100"];
  return <Bars data={bins.map((count, index) => ({ label: labels[index], count }))} keys={["count"]} names={["Trials"]} />;
}

export function PerformanceCharts({ value, condensed = false }: { value: Comparison; condensed?: boolean }) {
  const models = value.models.slice(0, 12);
  const names = models.map((model) => model.model);
  const keys = models.map((model) => String(model.id));
  const dimensionRows = dimensions.map(({ id, short }) => ({ label: short,
    ...Object.fromEntries(models.map((model) => [model.id, model.tasks[id]?.score.mean])) }));
  const correctness = dimensions.map(({ id, short }) => ({ label: short,
    ...Object.fromEntries(models.map((model) => [model.id, model.tasks[id]?.correctness_rate])) }));
  const observedScores = models.some((model) => model.metrics.weighted_scores > 0);
  // Recharts positions missing radar values at radius zero. Use fully observed axes only.
  const radarAxes = (Object.entries(criteria) as [keyof typeof criteria, string][])
    .filter(([key]) => models.every((model) => model.metrics.criteria[key] != null))
    .map(([key, label]) => ({
      label: key === "analysis_quality" ? "Analysis" : key === "explanation_quality" ? "Explanation" : key === "structural_validity" ? "Structure" : label,
      ...Object.fromEntries(models.map((model) => [model.id, model.metrics.criteria[key]])),
    }));
  const observedVerdict = models.some((model) => model.metrics.decisive > 0);
  const latency = models.map((model, index) => ({ label: `M${index + 1}`, milliseconds: model.metrics.latency_ms }));
  const errorNames = [...new Set(models.flatMap((model) => Object.keys(model.metrics.errors)))].slice(0, 8);
  const counts = errorNames.map((key) => ({ label: friendly(key),
    ...Object.fromEntries(models.map((model) => [model.id, model.metrics.evaluated ? model.metrics.errors[key] ?? 0 : null])),
  }));
  const distributions = ["0–19", "20–39", "40–59", "60–79", "80–100"].map((label, index) => ({ label,
    ...Object.fromEntries(models.map((model) => [model.id, model.metrics.distribution[index]])),
  }));

  return <>
    <div className="science-chart-grid">
      <ChartPanel title="Criterion radar" note="Requires at least three criteria measured for every displayed model. Unavailable criteria are omitted."
        empty={!models.length || radarAxes.length < 3}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 240 }}>
          <RadarChart data={radarAxes} outerRadius="67%">
            <PolarGrid stroke="var(--line)" /><PolarAngleAxis dataKey="label" tick={axis} /><PolarRadiusAxis domain={[0, 100]} tick={axis} />
            <Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 10 }} />
            {keys.map((id, index) => <Radar key={id} dataKey={id} name={names[index]} stroke={colors[index % colors.length]}
              fill={colors[index % colors.length]} fillOpacity={.17} isAnimationActive={false} connectNulls={false} />)}
          </RadarChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title="Task scores" note="Mean weighted score by linguistic task" empty={!observedScores}>
        <Bars data={dimensionRows} keys={keys} names={names} domain={[0, 100]} />
      </ChartPanel>
      <ChartPanel title="Correctness by task" note="Decisive verdicts under the selected evaluation method" empty={!observedVerdict}>
        <Bars data={correctness} keys={keys} names={names} domain={[0, 100]} />
      </ChartPanel>
      {!condensed && <>
        <ChartPanel title="Score distribution" note="Weighted trial scores in five bands" empty={!observedScores}>
          <Bars data={distributions} keys={keys} names={names} />
        </ChartPanel>
        <ChartPanel title="Latency comparison" note={models.map((model, index) => `M${index + 1} ${model.model}`).join(" · ")}
          empty={!latency.some((row) => row.milliseconds != null)}>
          <Bars data={latency} keys={["milliseconds"]} names={["Mean milliseconds"]} />
        </ChartPanel>
      </>}
      <ChartPanel title="Annotated error frequency" note="Responses with a retained category label, including reviewable suggestions" empty={!counts.length}>
        <Bars data={counts} keys={keys} names={names} />
      </ChartPanel>
    </div>
    <section className="surface dashboard-panel">
      <SectionTitle title="Performance heatmap" note="Mean score and number of weighted trials per task" />
      <div className="table-scroll"><table className="science-heatmap">
        <thead><tr><th scope="col">Model</th>{dimensions.map(({ id, short }) => <th scope="col" key={id}>{short}</th>)}</tr></thead>
        <tbody>{models.map((model) => <tr key={model.id}><th scope="row">{model.model}</th>
          {dimensions.map(({ id }) => {
            const score = model.tasks[id]?.score.mean;
            return <td key={id} style={score == null ? {} : { background: `color-mix(in srgb, var(--blue) ${Math.round(score * .36 + 4)}%, var(--surface))` }}>
              <strong>{display(score)}</strong><small>{model.tasks[id]?.weighted_scores ?? 0} scored</small></td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
