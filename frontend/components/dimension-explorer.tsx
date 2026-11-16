"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { dimensions } from "@/lib/research";
import { demoFixture } from "@/lib/api";

export function DimensionExplorer() {
  const [selected, setSelected] = useState(0);
  const reduced = useReducedMotion();
  const dimension = dimensions[selected];
  const example = demoFixture.examples.find((item) => item.dimension === dimension.id)!;

  return <div className="dimension-explorer">
    <div className="dimension-tabs" role="group" aria-label="Linguistic dimensions">
      {dimensions.map(({ id, label, icon: Icon, color }, index) =>
        <button key={id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`dimension-tab accent-${color}`}>
          <span className="dimension-icon"><Icon size={20} /></span>
          <span>{label}</span><ArrowUpRight size={15} className="dimension-arrow" />
        </button>
      )}
    </div>
    <motion.div key={dimension.id} className={`dimension-detail accent-${dimension.color}`} initial={reduced || selected === 0 ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>
      <div className="dimension-detail-copy">
        <span className="eyebrow">RESEARCH QUESTION</span>
        <h3>{dimension.question}</h3>
        <p>{example.task}</p>
        <Link href={`/lab/${dimension.id}`} className="text-link">Open the demo example <ArrowUpRight size={14} /></Link>
      </div>
      <div className="dimension-stimulus">
        <span className="eyebrow">EXAMPLE INPUT</span>
        <pre>{example.stimulus}</pre>
        <span className="example-output">{dimension.output}</span>
      </div>
    </motion.div>
  </div>;
}
