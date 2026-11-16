import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DemoBadge } from "@/components/dashboard";
import { Button } from "@/components/ui/button";
import { demoFixture } from "@/lib/api";
import { dimensions, studyUrl } from "@/lib/research";

export function ExperimentLab() {
  return <>
    <div className="lab-title"><div><DemoBadge /><h1>Experiment Laboratory</h1><p>Choose a task and walk through an annotated example. Sign in to execute and save experiments.</p></div></div>
    <div className="lab-tile-grid">{dimensions.map(({ id, label, icon: Icon, color, question, output }) => <Link className={`surface lab-tile accent-${color}`} href={`/lab/${id}`} key={id}>
      <span className="dimension-icon"><Icon size={23} /></span><h2>{label}</h2><p>{question}</p><span>{output}</span><ArrowUpRight size={18} />
    </Link>)}</div>
  </>;
}

export function Datasets() {
  return <>
    <div className="lab-title"><div><DemoBadge /><h1>Dataset Studio</h1><p>Browse the original examples bundled for the demo.</p></div>
    <Button asChild variant="outline"><a href={studyUrl} target="_blank" rel="noreferrer">Open the study dataset <ArrowUpRight size={15} /></a></Button></div>
    <section className="surface dashboard-panel">
      <div className="panel-heading"><div><h2>LinguaLens demo dataset</h2><p>Version 1 · {demoFixture.examples.length} practice examples</p></div></div>
      <div className="evaluation-list">{demoFixture.examples.map((item) => <Link href={`/lab/${item.dimension}`} key={item.dimension}><span>{item.title}</span><ArrowUpRight size={16} /></Link>)}</div>
    </section>
  </>;
}

