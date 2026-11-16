import Link from "next/link";
import { ArrowRight, ArrowUpRight, BarChart3, BookOpen, Braces, ClipboardCheck, FlaskConical, GraduationCap, Layers3, PanelsTopLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { SyntaxTree } from "@/components/syntax-tree";
import { DimensionExplorer } from "@/components/dimension-explorer";
import { ModelChart } from "@/components/model-chart";
import { Button } from "@/components/ui/button";
import { demoFixture } from "@/lib/api";
import { paperUrl, studyUrl } from "@/lib/research";

const workflow = [
  { icon: Layers3, title: "Prepare test items", text: "Group sentences and sound patterns by task. Record the dataset version and the expected outputs." },
  { icon: Braces, title: "Standardize prompts", text: "Use the same prompt template for every model in a task. Record model snapshots and repeat settings." },
  { icon: ClipboardCheck, title: "Grade the responses", text: "Check structured outputs and apply a task-specific rubric. Keep expert judgments and grading evidence." },
  { icon: BarChart3, title: "Compare outcomes", text: "Inspect accuracy by subtask and compare agreement across repeated trials." },
];

export function Landing() {
  return <>
    <header className="landing-nav">
      <div className="container nav-inner">
        <Brand />
        <nav aria-label="Research overview"><a href="#dimensions">Dimensions</a><a href="#method">Methodology</a><a href="#research">Research</a></nav>
        <div className="nav-actions"><ThemeToggle /><Button asChild size="small" variant="outline"><Link href="/lab">Open workspace <ArrowUpRight size={14} /></Link></Button></div>
      </div>
    </header>
    <main id="main" tabIndex={-1}>
      <section className="hero">
        <div className="hero-grid" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="hero-label"><span className="dot cyan-dot" /> A METALINGUISTIC EVALUATION PLATFORM</span>
            <h1>Beyond language generation. Into <span>linguistic understanding.</span></h1>
            <p>Evaluate how large language models analyze syntax and phonology through structured experiments.</p>
            <div className="hero-actions">
              <Button asChild><Link href="/lab">Explore the workspace <ArrowRight size={17} /></Link></Button>
              <Button asChild variant="outline"><Link href="/lab/showcase">Research Showcase <ArrowUpRight size={15} /></Link></Button>
            </div>
          </div>
          <div className="hero-visual"><SyntaxTree /></div>
        </div>
      </section>
      <div className="research-strip">
        <div className="container research-strip-inner">
          <div className="strip-source"><span className="strip-icon"><BookOpen size={18} /></span><div><span className="eyebrow">SCIENTIFIC BASIS</span><a href={paperUrl} target="_blank" rel="noreferrer">IEEE Transactions on Artificial Intelligence <ArrowUpRight size={13} /></a></div></div>
          <div className="strip-stat"><strong>4</strong><span>linguistic dimensions</span></div>
          <div className="strip-stat"><strong>10</strong><span>graded subtasks in the study</span></div>
          <div className="strip-stat"><strong>120</strong><span>test items in the study</span></div>
        </div>
      </div>
      <section className="container section" id="dimensions">
        <div className="section-heading"><span className="eyebrow"><Layers3 size={15} /> LINGUISTIC DIMENSIONS</span><h2>Four ways to test how models analyze language</h2><p>Explore one example from each task and see what a complete response should contain.</p></div>
        <DimensionExplorer />
      </section>
      <section className="section method-section" id="method">
        <div className="container">
          <div className="section-heading"><span className="eyebrow"><FlaskConical size={15} /> EXPERIMENT DESIGN</span><h2>From a test item to a scored response</h2><p>The research workflow adapts the study’s standardized prompts and human grading for reproducible multi-model experiments.</p></div>
          <div className="workflow">{workflow.map(({ icon: Icon, title, text }) => <article className="workflow-step" key={title}><span className="dimension-icon"><Icon size={21} /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
        </div>
      </section>
      <section className="container section preview-section" id="preview">
        <div className="section-heading"><span className="eyebrow"><PanelsTopLeft size={15} /> RESEARCH WORKSPACE</span><h2>Inspect results by linguistic dimension</h2><p>Open the demo dashboard to explore experiment history, model comparisons, and annotated examples.</p>
          <Button asChild variant="outline"><Link href="/lab">Open the demo dashboard <ArrowRight size={16} /></Link></Button>
        </div>
        <div className="preview-frame">
          <div className="preview-bar"><span><span className="dot cyan-dot" /> Model performance</span><span className="pill pill-demo">Synthetic data</span></div>
          <div className="preview-body"><ModelChart demo={demoFixture} compact /></div>
        </div>
      </section>
      <section className="section research-section" id="research">
        <div className="container research-columns">
          <div className="section-heading"><span className="eyebrow"><BookOpen size={15} /> RESEARCH REFERENCE</span><h2>Large Linguistic Models</h2>
            <p>Beguš, Dąbkowski, and Rhodes examined how four LLMs performed on syntax and phonology tasks. Their published study provides LinguaLens with the task design and grading protocol.</p>
            <div className="reference-links"><a className="text-link" href={paperUrl} target="_blank" rel="noreferrer">Read the IEEE paper <ArrowUpRight size={15} /></a><a className="text-link" href={studyUrl} target="_blank" rel="noreferrer">View study materials <ArrowUpRight size={15} /></a></div>
          </div>
          <div className="applications">
            <article><GraduationCap size={22} /><div><h3>Linguistics education</h3><p>Compare parses and discuss where a model’s analysis breaks down.</p></div></article>
            <article><FlaskConical size={22} /><div><h3>Language research</h3><p>Design controlled tasks with held-out sentences and artificial grammars.</p></div></article>
            <article><BarChart3 size={22} /><div><h3>Model evaluation</h3><p>Compare models on the linguistic structures that matter to an NLP workflow.</p></div></article>
          </div>
        </div>
      </section>
    </main>
    <footer className="landing-footer"><div className="container footer-inner"><Brand /><span>Final-year engineering project · Product Development II</span><Link href="/lab" className="text-link">Workspace <ArrowUpRight size={14} /></Link></div></footer>
  </>;
}

