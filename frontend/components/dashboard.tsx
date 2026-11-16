"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BarChart3, Box, ClipboardCheck, Database, Download, FlaskConical, Layers3 } from "lucide-react";
import { ModelChart } from "@/components/model-chart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { api, demoFixture, type Activity } from "@/lib/api";
import { getDemoHistory } from "@/lib/demo-history";
import { demoCsv } from "@/lib/csv.mjs";
import { dimensions } from "@/lib/research";

export function useDemo() {
  const [demo, setDemo] = useState(demoFixture);
  const [source, setSource] = useState<"loading" | "api" | "bundled">("loading");
  useEffect(() => {
    let active = true;
    api.demo().then((result) => {
      if (active) {
        setDemo(result.data);
        setSource(result.source);
      }
    });
    return () => { active = false; };
  }, []);
  return { demo, source };
}

export function DemoBadge() {
  return <span className="pill pill-demo"><span className="dot cyan-dot" /> Demo mode · Synthetic data</span>;
}

export function DemoSource({ source }: { source: ReturnType<typeof useDemo>["source"] }) {
  return <span className="data-source" role="status"><span className={`dot ${source === "api" ? "mint-dot" : ""}`} />{source === "api" ? "Demo API connected" : source === "loading" ? "Connecting to demo API" : "Bundled demo data"}</span>;
}

export function Dashboard() {
  const { demo, source } = useDemo();
  const [visited, setVisited] = useState<Activity[]>([]);
  useEffect(() => setVisited(getDemoHistory()), []);
  const stats = [
    { label: "Illustrative experiments", value: demo.activity.length, icon: FlaskConical, color: "cyan", note: "Synthetic experiment history" },
    { label: "Model profiles", value: demo.models.length, icon: Box, color: "violet", note: "Fictional model identities" },
    { label: "Linguistic dimensions", value: dimensions.length, icon: Layers3, color: "blue", note: "Syntax and phonology" },
    { label: "Dataset examples", value: demo.examples.length, icon: Database, color: "mint", note: "One annotated item per dimension" },
  ];

  return <>
    <div className="lab-title"><div><DemoBadge /><h1>Research Dashboard</h1><p>Explore linguistic experiments, model comparisons, and example responses.</p></div>
      <Button asChild><Link href="/lab/experiments"><FlaskConical size={17} /> Open experiment lab <ArrowRight size={15} /></Link></Button>
    </div>
    <div className="metric-grid">{stats.map(({ label, value, note, color, icon: Icon }) => <article className={`surface metric-card accent-${color}`} key={label}>
      <div><span>{label}</span><span className="dimension-icon"><Icon size={18} /></span></div><strong>{value.toString().padStart(2, "0")}</strong><small>{note}</small>
    </article>)}</div>
    <div className="dashboard-grid">
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Model performance</h2><p>Illustrative scores by linguistic dimension</p></div><Link className="icon-link" href="/lab/comparison" aria-label="Open model comparison"><ArrowUpRight size={17} /></Link></div>
        <ModelChart demo={demo} />
      </section>
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Linguistic dimensions</h2><p>Annotated task examples</p></div><Layers3 size={19} className="muted" /></div>
        <div className="dimension-list">{dimensions.map(({ id, label, color, icon: Icon }) => <Link key={id} href={`/lab/${id}`} className={`accent-${color}`}>
          <span className="dimension-icon"><Icon size={18} /></span><span>{label}</span><ArrowUpRight size={15} />
        </Link>)}</div>
      </section>
    </div>
    <div className="dashboard-grid">
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Experiment history</h2><p>Sample records and your recent demo views</p></div><DemoSource source={source} /></div>
        <div className="table-scroll"><table className="activity-table">
          <thead><tr><th scope="col">Experiment</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead>
          <tbody>{[...visited, ...demo.activity].slice(0, 8).map((item) => <tr key={item.id}><th scope="row"><Link href={`/lab/${item.dimension}`}>{item.name}</Link></th><td><span className="pill">{item.status}</span></td><td><time dateTime={item.date}>{item.date}</time></td></tr>)}</tbody>
        </table></div>
      </section>
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>Recent evaluations</h2><p>Reference annotations in the fixture</p></div><ClipboardCheck size={19} className="muted" /></div>
        <div className="evaluation-list">{demo.examples.slice(0, 3).map((example) => <Link href={`/lab/${example.dimension}`} key={example.dimension}><span>{example.title}</span><ArrowUpRight size={14} /></Link>)}</div>
        <div className="quick-actions"><Link className="text-link" href="/lab/datasets"><Database size={15} /> Explore datasets <ArrowRight size={14} /></Link><Link className="text-link" href="/workspace">Open private workspace <ArrowRight size={14} /></Link></div>
      </section>
    </div>
  </>;
}

export function Comparison() {
  const { demo, source } = useDemo();
  const toast = useToast();
  function download() {
    const url = URL.createObjectURL(new Blob([demoCsv(demo)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lingualens-demo-scores.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Synthetic scores exported");
  }
  return <>
    <div className="lab-title"><div><DemoBadge /><h1>Model Comparison</h1><p>Compare three fictional model profiles across the four tasks.</p></div><Button onClick={download}><Download size={16} /> Download demo CSV</Button></div>
    <section className="surface dashboard-panel comparison-panel">
      <div className="panel-heading"><div><h2>Scores by task</h2><p>Select a model in the legend to toggle its series.</p></div><BarChart3 size={20} className="muted" /></div>
      <ModelChart demo={demo} /><DemoSource source={source} />
    </section>
  </>;
}
