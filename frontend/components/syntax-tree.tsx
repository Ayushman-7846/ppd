"use client";

import { useId, useState } from "react";
import { GitFork, ScanLine } from "lucide-react";

type Node = { key: string; label: string; x: number; y: number; parent?: string; token?: boolean; accent?: boolean };

const syntax = (attachment: "vp" | "np"): Node[] => {
  const vp = attachment === "vp";
  return [
    { key: "s", label: "S", x: 246, y: 32 },
    { key: "subject", label: "NP", x: 92, y: 100, parent: "s" },
    { key: "subject-word", label: "I", x: 92, y: 166, parent: "subject", token: true },
    { key: "vp", label: "VP", x: 302, y: 100, parent: "s" },
    { key: "verb", label: "V", x: 174, y: 165, parent: "vp" },
    { key: "verb-word", label: "saw", x: 174, y: 228, parent: "verb", token: true },
    { key: "object", label: "NP", x: 263, y: 165, parent: "vp", accent: !vp },
    { key: "object-word", label: "the astronomer", x: 266, y: 228, parent: "object", token: true },
    { key: "pp", label: "PP", x: 378, y: 201, parent: vp ? "vp" : "object", accent: true },
    { key: "p", label: "P", x: 349, y: 262, parent: "pp" },
    { key: "p-word", label: "with", x: 349, y: 317, parent: "p", token: true },
    { key: "np", label: "NP", x: 424, y: 262, parent: "pp" },
    { key: "np-word", label: "the telescope", x: 424, y: 317, parent: "np", token: true },
  ];
};

export function SyntaxTree() {
  const [attachment, setAttachment] = useState<"vp" | "np">("vp");
  const uid = useId();
  const nodes = syntax(attachment);
  const vp = attachment === "vp";
  return <div className="tree-panel">
    <div className="tree-top"><span><GitFork size={17} /> Syntax tree</span><span className="tree-status"><span /> Interactive example</span></div>
    <div className="tree-canvas">
      <div className="tree-grid" />
      <span className="tree-coordinate"><ScanLine size={15} /> CONSTITUENCY VIEW</span>
      <svg role="img" aria-labelledby={uid} viewBox="0 0 490 345" className="tree-svg">
        <title id={uid}>{`I saw the astronomer with the telescope. The prepositional phrase modifies the ${vp ? "verb phrase" : "object noun phrase"}.`}</title>
        <defs>
          <radialGradient id={`${uid}glow`}><stop offset="0" stopColor="#486dff" stopOpacity=".21" /><stop offset="1" stopColor="#486dff" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="275" cy="160" rx="224" ry="160" fill={`url(#${uid}glow)`} />
        {nodes.filter((node) => node.parent).map((node, index) => {
          const parent = nodes.find((item) => item.key === node.parent)!;
          return <line key={`${node.key}-${node.parent}`} pathLength={1} x1={parent.x} y1={parent.y} x2={node.x} y2={node.y}
            className={node.key === "pp" ? "tree-edge tree-edge-accent" : "tree-edge"} style={{ animationDelay: `${index * 25}ms` }} />;
        })}
        {nodes.map((node, index) => {
          const width = node.token ? Math.max(30, node.label.length * 6.4 + 16) : 42;
          return <g key={node.key} className={node.accent ? "tree-node tree-node-accent" : node.token ? "tree-node tree-token" : "tree-node"} style={{ animationDelay: `${index * 25}ms` }}>
            <rect x={node.x - width / 2} y={node.y - 13} width={width} height="26" rx={node.token ? 6 : 10} />
            <text x={node.x} y={node.y + 4} textAnchor="middle">{node.label}</text>
          </g>;
        })}
      </svg>
      <div className="tree-caption"><span className="dot cyan-dot" />{vp ? "The telescope is the instrument." : "The telescope belongs to the astronomer."}</div>
    </div>
    <div className="tree-toolbar">
      <span>PP attachment</span>
      <div className="segmented" role="group" aria-label="Prepositional phrase attachment">
        <button type="button" aria-pressed={vp} onClick={() => setAttachment("vp")}>Verb phrase</button>
        <button type="button" aria-pressed={!vp} onClick={() => setAttachment("np")}>Noun phrase</button>
      </div>
    </div>
  </div>;
}
