import { request } from "@/lib/api";
import type { Dimension } from "@/lib/research";

export type Provider = "openai" | "gemini" | "anthropic" | "openrouter" | "ollama";
export type Parameters = { temperature?: number; max_output_tokens?: number; top_p?: number; timeout?: number };
export type Selection = { provider: Provider | "demo"; model?: string; parameters?: Parameters };
export type ModelOption = { provider: Selection["provider"]; model: string; label: string };
export type ProviderInfo = {
  capabilities: string[];
  diagnostic: { status: "reachable" | "failed" | "blocked"; checked_at: string; last_success_at: string | null;
    latency_ms: number; model: string | null; model_count: number | null; model_listed: boolean | null;
    error_code: string | null; error_message: string | null } | null;
  provider: Provider; enabled: boolean; configured: boolean; credential_source: "account" | "environment" | "server" | "none";
  accepts_credential: boolean; credential_storage: boolean; default_model: string | null; parameters: Parameters;
};
export type ProviderUpdate = {
  enabled: boolean; credential?: string; clear_credential?: boolean; default_model?: string; parameters: Parameters;
};
export type PhoneRow = { word_id: string; underlying?: string | null; surface: string; target?: string | null; context?: string };
export type Stimulus = { sentence?: string | null; category?: string | null; rows?: PhoneRow[]; phones_of_interest?: string[] };
export type Item = { item_key: string; stimulus: Stimulus; reference: Record<string, string | boolean | number | null> };
export type Dataset = {
  id: string | number; name: string; version: number; dimension: Dimension; provenance: string;
  kind: "builtin" | "user"; item_count: number;
};
export type DatasetDetail = Dataset & { items: Item[] };
export type DatasetInput = Pick<Dataset, "name" | "dimension" | "provenance"> & { items: Item[] };
export type Prompt = { id: number; name: string; dimension: Dimension; version: number; template: string };
export type Queued = { experiment_id: number; response_id: number | null };
export type Status = "pending" | "running" | "completed" | "failed" | "cancelled";
export type ResponseSummary = {
  id: number; experiment_id: number; dimension: Dimension; stimulus: Stimulus; item_key: string;
  provider: Selection["provider"]; model: string; trial: number; state: Status; error: string | null;
  preview: string; created_at: string; finished_at: string | null;
};
export type TreeNode = { id: string; label: string; lexical?: string | null; trace_index?: number | null; span?: [number, number] | null; features?: Record<string, string>; children?: TreeNode[] };
export type MovementLink = { index: number; source_id: string; destination_id: string };
export type Substitution = { source: string; replacement: string; left?: string | null; right?: string | null };
export type AmbiguityAnswer = { detected: boolean; explanation: string; readings: { meaning: string; attachment: string; tree: TreeNode }[] };
export type RecursionAnswer = {
  detected: boolean; explanation: string; category: string | null; segment: string | null; estimated_depth: number | null;
  tree: TreeNode; expanded_sentence: string | null; expanded_tree: TreeNode | null; added_node_ids: string[];
};
export type MovementAnswer = { detected: boolean; explanation: string; category: string | null; constituent: string | null; origin: string | null; landing: string | null; tree: TreeNode; links: MovementLink[] };
export type PhonologyAnswer = {
  detected: boolean; explanation: string; input_phone: string | null; output_phone: string | null;
  environment: string | null; formal_rule: string | null; supporting_ids: string[]; exception_ids: string[];
  generalization: string | null; substitution: Substitution | null;
};
export type Validation = {
  schema: "invalid" | "valid"; structure: "invalid" | "valid" | "not_checked"; linguistic_correctness: "unreviewed"; review: "pending";
  errors: string[]; reference_checks: { field: string; matches: boolean; expected: string | number | boolean; observed: string | number | boolean | null }[];
  rule_evidence?: { status: string; rows: { word_id: string; predicted: string; matches: boolean; changed: boolean; contains_target: boolean }[] };
};
export type Result = ResponseSummary & {
  raw_output: string | null; parsed_output: AmbiguityAnswer | RecursionAnswer | MovementAnswer | PhonologyAnswer | null;
  prompt_rendered: string; reference: Item["reference"]; execution: {
    validation?: Validation; provenance?: string; parameters?: Parameters; prompt_version?: number; dataset_version?: number;
    started_at?: string; finished_at?: string; latency_ms?: number | null; attempts?: number; input_tokens?: number | null;
    output_tokens?: number | null; reported_model?: string; finish_reason?: string; previous_attempts?: unknown[];
  };
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type Counts = Partial<Record<Status, number>>;
export type Experiment = { id: number; name: string; state: Status | "draft"; kind: string; repetitions: number; created_at: string; counts: Counts };
export type Run = Experiment & { protocol: Record<string, unknown>; responses: Page<ResponseSummary>; models: { provider: string; model: string; counts: Counts }[] };
export type Analysis = { stimulus: Stimulus; dataset_id?: never; item_key?: never } | { stimulus?: never; dataset_id: Dataset["id"]; item_key: string };

const body = (method: string, data?: unknown): RequestInit => data === undefined
  ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
const params = (filters: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.size ? "?" + query.toString() : "";
};
const datasetPath = (id: Dataset["id"]) => "/datasets/" + encodeURIComponent(id);
export const datasetExport = (id: Dataset["id"], format: "json" | "csv") => "/api/v1" + datasetPath(id) + "?format=" + format;
export const running = (state: string) => state === "pending" || state === "running";

export const research = {
  providers: () => request<ProviderInfo[]>("/providers"),
  configure: (provider: Provider, data: ProviderUpdate) => request<ProviderInfo>(`/providers/${provider}`, body("PUT", data)),
  discover: (provider: Provider) => request<string[]>(`/providers/${provider}/test`, body("POST")),
  models: () => request<ModelOption[]>("/models"),
  datasets: (dimension?: Dimension, search?: string) => request<Dataset[]>("/datasets" + params({ dimension, search })),
  dataset: (id: Dataset["id"]) => request<DatasetDetail>(datasetPath(id)),
  saveDataset: (data: DatasetInput, id?: number) => id === undefined
    ? request<DatasetDetail>("/datasets", body("POST", data)) : request<DatasetDetail>(datasetPath(id), body("PUT", data)),
  duplicateDataset: (id: Dataset["id"], name: string) => request<DatasetDetail>(datasetPath(id) + "/duplicate" + params({ name }), body("POST")),
  removeDataset: (id: number) => request<boolean>(datasetPath(id), body("DELETE")),
  importDataset: (data: FormData) => request<DatasetDetail>("/datasets/import", { method: "POST", body: data }),
  previewImport: (data: FormData) => request<Item[]>("/dataset-items/preview-import", { method: "POST", body: data }),
  prompts: (dimension?: Dimension) => request<Prompt[]>("/prompts" + params({ dimension })),
  savePrompt: (data: Omit<Prompt, "id" | "version">) => request<Prompt>("/prompts", body("POST", data)),
  previewPrompt: (id: number, stimulus: Stimulus, template: string) =>
    request<{ text: string; schema: Record<string, unknown> }>(`/prompts/${id}/preview`, body("POST", { stimulus, template })),
  analyze: (dimension: Dimension, input: Analysis, selection: Selection, prompt_id?: number) =>
    request<Queued>(`/linguistic/${dimension}`, body("POST", { ...input, selection, prompt_id })),
  history: (filters: { dimension?: Dimension; page?: number; state?: Status; model?: string; analysis_only?: boolean }) =>
    request<Page<ResponseSummary>>("/history" + params(filters)),
  result: (id: number, signal?: AbortSignal, expectedOutput?: string) =>
    request<Result>(`/responses/${id}` + params({ expected_output: expectedOutput }), { signal }),
  retryResponse: (id: number) => request<Queued>(`/responses/${id}/rerun`, body("POST")),
  removeResponse: (id: number) => request<boolean>(`/responses/${id}`, body("DELETE")),
  testRule: (id: number, word: string) => request<{ underlying: string; surface: string; rule_evidence: string }>(`/responses/${id}/test-rule`, body("POST", { word })),
  experiments: (page = 1) => request<Experiment[]>("/experiments" + params({ page })),
  run: (id: number, page = 1, signal?: AbortSignal) => request<Run>(`/experiment-runs/${id}` + params({ page }), { signal }),
  start: (data: { name: string; repetitions: number; dataset_ids: Dataset["id"][]; selections: Selection[]; prompt_ids: Partial<Record<Dimension, number>> }) =>
    request<Queued>("/experiments", body("POST", data)),
  cancel: (id: number) => request<Experiment>(`/experiment-runs/${id}/cancel`, body("POST")),
  retryRun: (id: number) => request<Experiment>(`/experiment-runs/${id}/retry`, body("POST")),
};

export function downloadBlob(content: Blob, name: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function showStimulus(stimulus: Stimulus) {
  return stimulus.sentence || stimulus.rows?.map((row) => row.surface).join(" · ") || "Linguistic input";
}
