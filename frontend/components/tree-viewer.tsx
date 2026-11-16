"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Expand, Focus, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme";
import { downloadBlob, type MovementLink, type TreeNode } from "@/lib/research-api";
import { Problem, message } from "@/components/research-controls";

type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Positioned = { node: TreeNode; at: Point; parent?: string; collapsed: boolean };
const initialView = { x: 0, y: 0, zoom: 1 };
const unitX = 116;
const unitY = 80;

function positionTree(root: TreeNode, closed: ReadonlySet<string>, maximumDepth: number) {
  const seen = new Set<string>();
  const nodes: Positioned[] = [];
  let leaf = 0;
  let depth = 0;

  function walk(node: TreeNode, level: number, parent?: string): number {
    if (!node || typeof node.id !== "string" || typeof node.label !== "string" ||
        (node.children !== undefined && !Array.isArray(node.children)) ||
        seen.has(node.id) || seen.size >= 180 || level > 24) throw new Error("Tree is outside the rendering limits.");
    seen.add(node.id);
    const children = node.children ?? [];
    const collapsed = children.length > 0 && (closed.has(node.id) || (maximumDepth > 0 && level >= maximumDepth));
    const positions = collapsed ? [] : children.map((item) => walk(item, level + 1, node.id));
    const x = positions.length ? (positions[0] + positions.at(-1)!) / 2 : 62 + leaf++ * unitX;
    depth = Math.max(depth, level);
    nodes.push({ node, at: { x, y: 37 + (level - 1) * unitY }, parent, collapsed });
    return x;
  }
  walk(root, 1);
  return { nodes, width: Math.max(240, leaf * unitX + 8), height: Math.max(138, depth * unitY + 12) };
}

export function TreeViewer({ tree, label, maximumDepth = 0, highlights = [], links = [], selectedLink }:
  { tree: TreeNode; label: string; maximumDepth?: number; highlights?: string[]; links?: MovementLink[]; selectedLink?: number }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<string>();
  const [view, setView] = useState(initialView);
  const [error, setError] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ screen: Point; origin: View } | null>(null);
  const marker = "trace-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const { theme } = useTheme();

  const layout = useMemo(() => {
    try { return positionTree(tree, closed, maximumDepth); }
    catch { return undefined; }
  }, [tree, closed, maximumDepth]);
  const index = useMemo(() => new Map(layout?.nodes.map((entry) => [entry.node.id, entry])), [layout]);
  if (!layout) {
    return <div className="empty-state">The tree is outside the visualization limits. Inspect the raw response in the audit panel.</div>;
  }
  const { nodes, width, height } = layout;
  const selected = selection ? index.get(selection) : undefined;
  const branch = new Set<string>();
  for (let entry = selected; entry; entry = entry.parent ? index.get(entry.parent) : undefined) branch.add(entry.node.id);
  const light = theme === "light";
  const colors = light
    ? { bg: "#f7faff", line: "#6980ab", plate: "#e9efff", text: "#182f58", border: "#879dc9", accent: "#096f87", hot: "#ddf6fa", purple: "#6e43b8" }
    : { bg: "#0b1528", line: "#648bc4", plate: "#192d4a", text: "#edf5ff", border: "#5579b1", accent: "#62d7ea", hot: "#10384b", purple: "#b2a3ff" };
  const viewW = width / view.zoom;
  const viewH = height / view.zoom;
  const bounds = `${(width - viewW) / 2 + view.x} ${(height - viewH) / 2 + view.y} ${viewW} ${viewH}`;

  function changeZoom(delta: number) {
    setView((old) => ({ ...old, zoom: Math.min(4, Math.max(.45, old.zoom + delta)) }));
  }

  function toggle(id: string) {
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const scale = Math.max(viewW / event.currentTarget.clientWidth, viewH / event.currentTarget.clientHeight);
    const { screen, origin } = drag.current;
    setView({ ...origin, x: origin.x + (screen.x - event.clientX) * scale, y: origin.y + (screen.y - event.clientY) * scale });
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const steps: Record<string, Point> = { ArrowLeft: { x: -30, y: 0 }, ArrowRight: { x: 30, y: 0 }, ArrowUp: { x: 0, y: -30 }, ArrowDown: { x: 0, y: 30 } };
    const direction = steps[event.key];
    if (!direction) return;
    event.preventDefault();
    setView((old) => ({ ...old, x: old.x + direction.x / old.zoom, y: old.y + direction.y / old.zoom }));
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else throw new Error("Fullscreen is unavailable in this browser.");
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function exportTree(format: "svg" | "png") {
    if (!svg.current) return;
    setError("");
    const clone = svg.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    if (format === "svg") {
      downloadBlob(blob, "lingualens-tree.svg");
      return;
    }
    const object = URL.createObjectURL(blob);
    try {
      const bitmap = new Image();
      bitmap.src = object;
      await bitmap.decode();
      const canvas = document.createElement("canvas");
      const scale = Math.min(2, 4096 / width, 4096 / height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG export is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("The PNG could not be created.");
      downloadBlob(png, "lingualens-tree.png");
    } catch (reason) {
      setError(message(reason));
    } finally {
      URL.revokeObjectURL(object);
    }
  }

  return <div ref={container} className="interactive-tree">
    <div className="interactive-tree-tools">
      <strong>{label}</strong>
      <div role="group" aria-label="Tree navigation">
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => changeZoom(.25)}><Plus size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => changeZoom(-.25)}><Minus size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="Fit tree to screen" onClick={() => setView(initialView)}><Focus size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="Fullscreen tree" onClick={fullscreen}><Maximize size={16} /></Button>
      </div>
    </div>
    <svg ref={svg} viewBox={bounds} aria-label={`${label}. Use the arrow keys to pan.`} tabIndex={0} onKeyDown={keyboard}
      className="interactive-tree-svg" style={{ background: colors.bg }}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("[data-tree-node]") || event.button !== 0) return;
        drag.current = { screen: { x: event.clientX, y: event.clientY }, origin: view };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <rect width={width} height={height} fill={colors.bg} />
      <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 10 5 0 10Z" fill={colors.purple} />
      </marker></defs>
      {nodes.map(({ at, node, parent }) => {
        const above = parent && index.get(parent);
        return above && <line key={node.id} x1={above.at.x} y1={above.at.y + 14} x2={at.x} y2={at.y - 14}
          stroke={branch.has(node.id) ? colors.accent : colors.line} strokeWidth={branch.has(node.id) ? 2.5 : 1.4} />;
      })}
      {links.map((link) => {
        const from = index.get(link.source_id)?.at, to = index.get(link.destination_id)?.at;
        if (!from || !to) return null;
        const curve = Math.max(from.x, to.x) + 52;
        return <path key={`${link.source_id}-${link.destination_id}`}
          d={`M${from.x + 26} ${from.y} C${curve} ${from.y - 28} ${curve} ${to.y} ${to.x + 28} ${to.y}`}
          stroke={colors.purple} strokeDasharray="5 3" strokeWidth={selectedLink === link.index ? 3.5 : 1.6}
          opacity={selectedLink === undefined || selectedLink === link.index ? 1 : .36} fill="none" markerEnd={`url(#${marker})`} />;
      })}
      {nodes.map(({ node, at, collapsed }) => {
        const accent = highlights.includes(node.id) || branch.has(node.id);
        const lexical = node.lexical || "";
        const caption = lexical.length > 17 ? lexical.slice(0, 16) + "…" : lexical;
        return <g key={node.id} data-tree-node="" role="button" tabIndex={0}
          aria-label={`${node.label}${lexical ? " " + lexical : ""}${node.trace_index ? " index " + node.trace_index : ""}${collapsed ? " collapsed" : ""}`}
          aria-pressed={selection === node.id}
          onClick={() => setSelection(node.id)} onDoubleClick={() => toggle(node.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection(node.id); }
          }}>
          <rect x={at.x - 27} y={at.y - 14} width="54" height="28" rx="7"
            fill={accent ? colors.hot : colors.plate} stroke={accent ? colors.accent : colors.border} />
          <text x={at.x} y={at.y + 4} textAnchor="middle" fontFamily="monospace" fontSize="11" fill={colors.text}>
            {`${node.label.slice(0, 7)}${node.trace_index ? "·" + node.trace_index : ""}${collapsed ? " +" : ""}`}
          </text>
          {caption && <text x={at.x} y={at.y + 29} textAnchor="middle" fontFamily="monospace" fontSize="10" fill={colors.text}>{caption}</text>}
        </g>;
      })}
    </svg>
    <div className="interactive-tree-footer">
      {selected ? <div><strong>{selected.node.label}</strong> {selected.node.lexical || (selected.node.trace_index ? "Index " + selected.node.trace_index : "")}
        {selected.node.span && <small> · Span {selected.node.span.join("–")}</small>}
        {selected.node.features && Object.entries(selected.node.features).map(([key, value]) => <small key={key}> · {key} {value}</small>)}</div> :
        <small>Select a node to highlight its branch. Drag the canvas to pan.</small>}
      <div className="research-actions">
        {selected && !!selected.node.children?.length && <Button variant="outline" size="small" onClick={() => toggle(selected.node.id)}>
          <Expand size={13} /> {closed.has(selected.node.id) ? "Expand branch" : "Collapse branch"}
        </Button>}
        <Button variant="outline" size="small" onClick={() => exportTree("svg")}>Export SVG</Button>
        <Button variant="outline" size="small" onClick={() => exportTree("png")}>Export PNG</Button>
      </div>
    </div>
    <Problem error={error} />
  </div>;
}
