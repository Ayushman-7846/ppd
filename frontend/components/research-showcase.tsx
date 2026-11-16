import Link from "next/link";
import { ArrowRight, ArrowUpRight, BarChart3, ClipboardCheck, FileText, FlaskConical, Repeat2, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dimensions, paperUrl } from "@/lib/research";

const workflow = [
  { title: "Evaluate stored responses", href: "/lab/evaluation", icon: ClipboardCheck,
    text: "Apply a versioned rubric, inspect reference checks, and compare independent human grades and consensus." },
  { title: "Compare matching protocols", href: "/lab/comparison", icon: Split,
    text: "Choose Curated demonstrations and the saved rubric. Compare only aligned datasets, prompts and trials." },
  { title: "Inspect repeatability", href: "/lab/consistency", icon: Repeat2,
    text: "Open a pair of repeated trials and compare exact text, linguistic structure and scored verdicts." },
  { title: "Read the measured evidence", href: "/lab/analytics", icon: BarChart3,
    text: "Inspect sample size, score coverage and uncertainty. A stable answer can still be wrong." },
  { title: "Export a research report", href: "/lab/reports", icon: FileText,
    text: "Freeze the selected cohort and download its PDF, CSV and JSON records with their provenance." },
];

export function ResearchShowcase() {
  return <div className="science-page showcase">
    <div className="lab-title"><div><h1>Research Showcase</h1><p>Follow a saved linguistic response from the original stimulus through evaluation, comparison and reporting.</p></div>
      <Button asChild variant="outline"><Link href="/workspace">Open researcher workspace <ArrowUpRight size={16} /></Link></Button></div>

    <section className="surface dashboard-panel showcase-feature" aria-labelledby="featured-experiment">
      <FlaskConical size={24} aria-hidden="true" />
      <div><span className="pill pill-demo">Curated demonstration</span><h2 id="featured-experiment">Featured experiment · Attachment reliability</h2>
        <p>Run ten PP attachment items with the reference and simplified baseline profiles, with two repetitions each. LinguaLens stores the 40 demonstration trials for evaluation.</p>
        <p>The preset uses local demonstration profiles. For a live trial, select a separately configured provider in the experiment form.</p>
        <Button asChild><Link href="/lab/experiments?showcase=1">Review the featured experiment <ArrowRight size={16} /></Link></Button>
      </div>
    </section>

    <section aria-labelledby="showcase-tasks">
      <h2 id="showcase-tasks">Four linguistic tasks</h2>
      <div className="showcase-grid">{dimensions.map(({ id, label, icon: Icon }) => <Link key={id} href={`/lab/${id}`} className="surface showcase-tile">
        <Icon size={20} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={15} aria-hidden="true" />
      </Link>)}</div>
    </section>

    <section aria-labelledby="showcase-workflow"><h2 id="showcase-workflow">From evaluation to report</h2>
      <ol className="showcase-steps">{workflow.map(({ title, href, icon: Icon, text }) => <li className="surface showcase-step" key={href}>
        <Icon size={20} aria-hidden="true" /><div><h3><Link href={href}>{title} <ArrowUpRight size={14} aria-hidden="true" /></Link></h3><p>{text}</p></div>
      </li>)}</ol>
    </section>

    <section className="surface dashboard-panel" aria-labelledby="research-limitations">
      <h2 id="research-limitations">Research conclusions and limitations</h2>
      <p>Use the recorded evidence to explain what changed across items, models and runs. The demonstration shows how the system measures performance on authored cases. Claims about deployed models require matched live trials and independently reviewed references.</p>
      <ul className="showcase-limitations">
        <li>Outputs can vary even with the same prompt. Prompt choices and provider updates affect comparability.</li>
        <li>Automated judges can be wrong. Human graders can disagree. Deterministic checks cover the recorded reference and supported formal rules.</li>
        <li>Published examples may appear in training data. Document new held-out items before collecting outputs.</li>
        <li>Provider outages affect coverage. Keep failed requests separate from decisive linguistic verdicts.</li>
        <li>Observable task performance supports behavioral claims. Human-like understanding requires separate evidence.</li>
      </ul>
      <div className="research-actions"><Link className="text-link" href="/lab/analytics">Inspect research evidence <ArrowUpRight size={14} /></Link>
        <a className="text-link" href={paperUrl}>Read the reference study <ArrowUpRight size={14} /></a></div>
    </section>
  </div>;
}
