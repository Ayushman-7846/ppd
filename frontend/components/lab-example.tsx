"use client";

import { useState } from "react";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { api, demoFixture, type Example } from "@/lib/api";
import { type Dimension, dimensions } from "@/lib/research";
import { Button } from "@/components/ui/button";
import { SyntaxTree } from "@/components/syntax-tree";
import { DemoBadge } from "@/components/dashboard";
import { recordDemoView } from "@/lib/demo-history";
import { useToast } from "@/components/toast";

export function LabExample({ dimension }: { dimension: Dimension }) {
  const [result, setResult] = useState<{ data: Example; source: "api" | "bundled" }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const example = demoFixture.examples.find((item) => item.dimension === dimension)!;
  const task = dimensions.find((entry) => entry.id === dimension)!;
  const toast = useToast();

  async function reveal() {
    setLoading(true);
    setError("");
    try {
      const preview = await api.example(dimension);
      setResult(preview);
      recordDemoView({ id: crypto.randomUUID(), name: preview.data.title, dimension, status: "Viewed", date: new Date().toLocaleDateString("sv-SE") });
      toast("Demo annotation loaded");
    } catch {
      setError("The demo annotation could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <div className="lab-title"><div><DemoBadge /><h1>{task.label}</h1><p>{task.question}</p></div></div>
    <div className="example-layout">
      <section className="surface dashboard-panel">
        <div className="panel-heading"><div><h2>{example.title}</h2><p>Annotated practice item</p></div><span className={`dimension-icon accent-${task.color}`}><task.icon size={18} /></span></div>
        <span className="eyebrow">STIMULUS</span><pre className="stimulus-block">{example.stimulus}</pre>
        <span className="eyebrow">TASK</span><p className="task-copy">{example.task}</p>
        <Button onClick={reveal} disabled={loading || !!result}>{loading ? <LoaderCircle size={17} className="spinner" /> : <FlaskConical size={17} />}{result ? "Annotation loaded" : loading ? "Loading annotation" : "Reveal demo annotation"}</Button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <section className="surface dashboard-panel" aria-live="polite">
        <div className="panel-heading"><div><h2>Reference analysis</h2><p>Expected output for this practice item</p></div></div>
        {result ? <><pre className="stimulus-block">{result.data.output}</pre><p className="task-copy">{result.data.observation}</p><small className="muted">{result.source === "api" ? "Loaded from the demo API" : "Loaded from the bundled demo dataset"}</small></> : <div className="empty-state">Reveal the annotation to compare your analysis with the example response.</div>}
      </section>
    </div>
    {dimension === "ambiguity" && <div className="lab-tree"><SyntaxTree /></div>}
  </>;
}
