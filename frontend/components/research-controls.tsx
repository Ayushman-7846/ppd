"use client";

import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { research, type ModelOption, type Parameters, type Prompt, type Selection, type Status } from "@/lib/research-api";
import type { Dimension } from "@/lib/research";

export const DEMO: Selection = { provider: "demo", model: "lingualens-reference" };
export const DEMO_BASELINE: Selection = { provider: "demo", model: "lingualens-baseline" };
export const MODEL_NAMES = { demo: "Demo", openai: "OpenAI", gemini: "Google Gemini", anthropic: "Anthropic Claude", openrouter: "OpenRouter", ollama: "Ollama" };

export function message(error: unknown) {
  return error instanceof Error && error.message !== "Failed to fetch" ? error.message : "The research API could not be reached.";
}

export function Busy({ text }: { text: string }) {
  return <span role="status" className="inline-status"><LoaderCircle size={16} className="spinner" /> {text}</span>;
}

export function Problem({ error }: { error: string }) {
  return error ? <p className="research-error" role="alert"><AlertCircle size={17} /> {error}</p> : null;
}

export function StatusBadge({ state }: { state: Status | "draft" }) {
  return <span className={`pill status-${state}`}>{state}</span>;
}

export function ModelParameters({ value, onChange, provider, disabled = false }:
  { value: Parameters; onChange: (value: Parameters) => void; provider: Selection["provider"]; disabled?: boolean }) {
  const inputs = [
    { key: "temperature", label: "Temperature", min: 0, max: provider === "anthropic" ? 1 : 2, step: .05 },
    { key: "top_p", label: "Top-p", min: .01, max: 1, step: .01 },
    { key: "max_output_tokens", label: "Output tokens", min: 128, max: 8192, step: 1 },
    { key: "timeout", label: "Timeout (seconds)", min: 2, max: 90, step: 1 },
  ] as const;
  return <div className="parameter-grid">{inputs.map(({ key, label, min, max, step }) =>
    <label key={key}>{label}<input type="number" min={min} max={max} step={step} value={value[key] ?? ""} placeholder="Default"
      disabled={disabled || provider === "demo"}
      onChange={(event) => onChange({ ...value, [key]: event.target.value === "" ? undefined : event.target.valueAsNumber })} /></label>
  )}</div>;
}

export function ModelSelector({ models, value, onChange, label = "AI model" }:
  { models: ModelOption[]; value: Selection; onChange: (value: Selection) => void; label?: string }) {
  const key = (option: { provider: string; model?: string }) => `${option.provider}|${option.model ?? ""}`;
  const [custom, setCustom] = useState(false);
  const predefined = models.some((item) => item.provider === value.provider && item.model === value.model && item.model);
  const editing = value.provider !== "demo" && (custom || !predefined);
  return <><label>{label}<select aria-label={label} value={editing ? key({ provider: value.provider }) : key(value)} onChange={(event) => {
    const option = models.find((item) => key(item) === event.target.value);
    if (option) {
      setCustom(!option.model);
      onChange({ provider: option.provider, model: option.model || undefined });
    }
  }}>
    {models.map((item) => <option key={key(item)} value={key(item)}>{item.label}</option>)}
  </select></label>
  {editing && <label>Model identifier<input required maxLength={200} value={value.model ?? ""}
    onChange={(event) => onChange({ ...value, model: event.target.value })} /></label>}</>;
}

export function useModels() {
  const [models, setModels] = useState<ModelOption[]>([
    { provider: "demo", model: DEMO.model!, label: "LinguaLens reference · Demo" },
    { provider: "demo", model: DEMO_BASELINE.model!, label: "LinguaLens simplified baseline · Demo" },
  ]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    research.models().then((items) => { if (active) setModels(items); }, (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);
  return { models, error };
}

export function PromptSelector({ prompts, dimension, value, onChange }:
  { prompts: Prompt[]; dimension: Dimension; value?: number; onChange: (id: number | undefined) => void }) {
  return <label>Prompt version<select aria-label="Prompt version" value={value ?? ""} onChange={(event) => onChange(Number(event.target.value) || undefined)}>
    <option value="">Standard template · v1</option>
    {prompts.filter((prompt) => prompt.dimension === dimension).map((prompt) => <option value={prompt.id} key={prompt.id}>
      {prompt.name.startsWith("@default:") ? "Standard template" : prompt.name} · v{prompt.version}
    </option>)}
  </select></label>;
}
