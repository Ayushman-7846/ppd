"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Demo } from "@/lib/api";

const colors = ["#6291ff", "#9b82f7", "#40cbd4"];

export function ModelChart({ demo, compact = false }: { demo: Demo; compact?: boolean }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = demo.models.filter((model) => !hidden.includes(model));
  return <div className={compact ? "model-chart compact-chart" : "model-chart"}>
    <div className="chart-legend" role="group" aria-label="Visible synthetic model series">
      {demo.models.map((model, index) => <button type="button" key={model} aria-pressed={!hidden.includes(model)}
        disabled={visible.length === 1 && visible[0] === model}
        onClick={() => setHidden((current) => current.includes(model) ? current.filter((item) => item !== model) : [...current, model])}>
        <span style={{ background: colors[index % colors.length] }} />{model}
      </button>)}
    </div>
    <div className="chart-area" role="group" aria-label="Synthetic model scores by linguistic dimension">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 450, height: compact ? 185 : 272 }}>
        <BarChart data={demo.scores} margin={{ top: 7, right: 2, left: -16, bottom: 3 }} barCategoryGap="24%" maxBarSize={24}>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="dimension" axisLine={false} tickLine={false} tickMargin={10} tick={{ fill: "var(--muted)", fontSize: compact ? 10 : 11 }} interval={0} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />
          <Tooltip cursor={{ fill: "var(--panel-hover)" }} contentStyle={{ background: "var(--panel)", borderColor: "var(--line)", borderRadius: 10, color: "var(--text)" }} labelStyle={{ color: "var(--text)" }} formatter={(value) => `${value}%`} />
          {demo.models.map((model, index) => <Bar key={model} dataKey={model} hide={hidden.includes(model)} fill={colors[index % colors.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details className="chart-values">
      <summary>View score values</summary>
      <div className="table-scroll"><table>
        <caption className="sr-only">Synthetic model scores as percentages</caption>
        <thead><tr><th scope="col">Dimension</th>{visible.map((model) => <th scope="col" key={model}>{model}</th>)}</tr></thead>
        <tbody>{demo.scores.map((row) => <tr key={row.dimension}><th scope="row">{row.dimension}</th>{visible.map((model) => <td key={model}>{row[model]}%</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </div>;
}
