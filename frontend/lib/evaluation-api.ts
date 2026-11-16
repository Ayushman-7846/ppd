import { request } from "@/lib/api";
import type { Page, Result, Selection, Stimulus } from "@/lib/research-api";
import type { Dimension } from "@/lib/research";

export const criteria = {
  correctness: "Correctness", analysis_quality: "Linguistic analysis quality",
  explanation_quality: "Explanation quality", structural_validity: "Structural validity", completeness: "Completeness",
} as const;
export type Criterion = keyof typeof criteria;
export type Scores = Partial<Record<Criterion, number | null>>;
export type Rubric = { id: number; name: string; version: number; weights: Record<Criterion, number>; criteria: Record<Criterion, string> };
export type Method = "deterministic" | "judge" | "human" | "consensus";
export const methods = { deterministic: "Deterministic", judge: "AI-assisted judge", human: "Human reviews", consensus: "Consensus verdict" } as const;
export type Verdict = "correct" | "incorrect" | "uncertain";
export type EvalState = "pending" | "processing" | "completed" | "failed" | "needs_human_review" | "reviewed";
export type EvaluationResult = {
  scores?: Scores; verdict?: Verdict; justification?: string; assessment?: string; confidence?: string; error?: string;
  checks?: { field: string; expected: unknown; observed: unknown; matches: boolean }[];
  criteria?: Partial<Record<Criterion, { score: number | null; evidence: string }>>;
  errors?: Annotation[]; validation?: Record<string, unknown>;
};
export type Attempt = { id: number; number: number; state: EvalState; raw_output: string | null; judge_prompt: string | null; result: EvaluationResult; score: number | null };
export type Assessment = {
  id: number; response_id: number; rubric: Rubric; method: Method; state: EvalState; attempt: number;
  score: number | null; result: EvaluationResult; created_at: string;
  judge: { provider: string; model: string; prompt_version: string } | null; attempts?: Attempt[];
};
export type Annotation = { category: string; severity: "minor" | "major" | "critical"; evidence: string };
export type ErrorRecord = Annotation & {
  id: number; state: "suggested" | "confirmed" | "dismissed"; source: Method; response_id: number;
  dimension: Dimension; provider: string; model: string; created_at: string;
};
export type ReviewMaterial = { stimulus: Stimulus; dataset_name: string; dataset_version: number; raw_output: string | null;
  parsed_output: Result["parsed_output"]; reference: Record<string, unknown> };
export type ReviewDraft = { scores: Scores; verdict?: Verdict; comment: string; errors: Annotation[] };
export type Assignment = {
  id: number; response_id: number; rubric: Rubric; dimension: Dimension; item_key: string; state: "pending" | "draft" | "submitted";
  blind: boolean; revision: number; created_at: string; submitted_at: string | null; score: number | null; verdict: Verdict | null;
  can_edit: boolean; reviewer: string; model?: { provider: string; identifier: string }; draft?: ReviewDraft;
  item?: ReviewMaterial;
};
export type Consensus = {
  assigned: number; submitted: number; decisive: number; votes: Partial<Record<Verdict, number>>;
  majority: Verdict | null; final_verdict: Verdict | null; mean_score: number | null; score_range: number | null;
  pair_agreement: number | null; status: "disputed" | "adjudicated" | "awaiting_reviews" | "reviewed";
  reviews: { id: number; reviewer_id: number; verdict: Verdict; score: number | null; comment: string }[];
  decision: { id: number; verdict: Verdict; justification: string } | null;
};
export type Dispute = { response_id: number; rubric_id: number; consensus: Consensus };
export type Agreement = { responses: number; excluded_responses: number; pairs: number; percent_agreement: number | null;
  coefficient: number | null; method: string | null; message: string | null };
export type StudyFilters = {
  model_ids?: number[]; experiment_ids?: number[]; dataset_ids?: number[]; dimension?: Dimension; provider?: string;
  rubric_id?: number; method: Method; date_from?: string; date_to?: string; population: "live" | "demo"; minimum_items?: number;
  item_id?: number; prompt_id?: number; temperature?: number; repetitions?: number; save?: boolean;
  semantic?: boolean;
};
export type Options = { models: { id: number; name: string; provider: string }[];
  datasets: { id: number; name: string; version: number; dimension: Dimension }[];
  experiments: { id: number; name: string; state: string; repetitions: number }[]; semantic_model: string | null };
export type Stats = { n: number; mean: number | null; median: number | null; sample_variance: number | null;
  sample_sd: number | null; confidence_interval: [number, number] | null; confidence_level: number | null };
export type Metrics = { responses: number; evaluated: number; weighted_scores: number; settled: number; failed: number; score: Stats;
  correctness_rate: number | null; decisive: number; criteria: Scores; failure_rate: number | null; annotated_error_rate: number | null;
  latency_ms: number | null; latency_n: number; input_tokens: number | null; output_tokens: number | null; input_tokens_n: number; output_tokens_n: number;
  errors: Record<string, number>; distribution: number[]; missing_scores: number };
export type Finding = { task: Dimension; model: string; score: number; label: string };
export type Comparison = { models: { id: number; model: string; provider: string; metrics: Metrics; tasks: Record<Dimension, Metrics>;
    consistency: number | null; rank: number | null }[];
  comparable: boolean; warning: string | null; paired: { first: number; second: number; difference: Stats; message: string | null }[];
  minimum_items: number; explorer: { item_id: number; key: string; dimension: Dimension;
    responses: { id: number; model: string; provider: string; trial: number; score: number | null; verdict: Verdict | null;
      output_hash?: string; errors: Annotation[]; reviews: Consensus["reviews"] }[] }[];
  findings: Finding[]; rubric: Rubric; method: Method; population: StudyFilters["population"]; metric_version: string; snapshot_id?: number };
export type ConsistencyMetric = "classification" | "structure" | "verdict" | "exact";
export type RepeatGroup = { experiment_id: number; experiment: string; model_id: number; model: string; provider: string; item_id: number;
  item_key: string; dimension: Dimension; dataset_version: number; prompt_id: number; parameters: Record<string, unknown>;
  metrics: Record<ConsistencyMetric, { percent: number | null; pairs: number }> & { score: Stats; matrix: (number | null)[][] };
  trials: { id: number; trial: number; score: number | null; verdict: Verdict | null; state: string; timestamp: string }[] };
export type Consistency = { groups: RepeatGroup[]; group_count: number; summary: Record<ConsistencyMetric, number | null>;
  rubric: Rubric; method: Method; population: StudyFilters["population"]; metric_version: string; snapshot_id?: number; message: string | null;
  semantic?: { method: string; model: string; reported_model?: string | null; dimensions?: number; n: number; matrix: (number | null)[][] } };
export type Analytics = { metrics: Metrics; experiments: number; model_count: number; review_count: number; reviews_submitted: number;
  review_agreement: Agreement; repeat_summary: Consistency["summary"]; repeat_group_count: number; comparison: Comparison;
  trends: { date: string; correctness: number | null; mean: number | null }[]; consistency_trend: { date: string; structure: number | null }[];
  datasets: { id: number; name: string; version: number; metrics: Metrics }[]; definitions: Record<string, string>;
  metric_version: string; rubric: Rubric; method: Method; population: StudyFilters["population"] };
export type Snapshot<T = Comparison | Consistency> = { id: number; kind: "comparison" | "consistency"; created_at: string; filters: StudyFilters; result?: T };
export const reportTypes = { experiment: "Individual experiment", comparison: "Multi-model comparison", task: "Linguistic task analysis",
  consistency: "Consistency analysis", evaluation: "Evaluation summary" } as const;
export type ReportType = keyof typeof reportTypes;
export type ReportRecord = { id: number; title: string; type: ReportType; generated_at: string; population: StudyFilters["population"] };
export type Report = ReportRecord & { researcher: string; rubric: Rubric; method: Method; analytics: Analytics;
  consistency: Consistency; experiments: { id: number; name: string; state: string; repetitions: number }[] };
export type ResearchOverview = { experiments: number; model_count: number; evaluated: number; pending_reviews: number; correctness_rate: number | null;
  warning?: string | null;
  score: number | null; best: Finding[]; repeats: Consistency["summary"]; recent: Pick<Assessment, "id" | "response_id" | "method" | "state">[];
  snapshots: Snapshot[]; reports: Pick<ReportRecord, "id" | "title" | "population">[]; method: Method; rubric: Rubric };

const json = (method: string, data?: unknown): RequestInit => data === undefined ? { method } :
  { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
function query(filters: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.size ? "?" + search.toString() : "";
}
export const reportDownload = (id: number, format: "pdf" | "csv" | "json") => `/api/v1/reports/export/${id}?format=${format}`;

export const science = {
  rubrics: () => request<Rubric[]>("/evaluations/rubrics"),
  saveRubric: (data: Omit<Rubric, "id" | "version">) => request<Rubric>("/evaluations/rubrics", json("POST", data)),
  assessments: (filters: { experiment_id?: number; response_id?: number; method?: string; page?: number }) =>
    request<Page<Assessment>>("/evaluations" + query(filters)),
  runEvaluation: (data: { response_ids: number[]; rubric_id: number; method: "deterministic" | "judge"; judge?: Selection }) =>
    request<Assessment[]>("/evaluations/automated", json("POST", data)),
  assessment: (id: number) => request<Assessment>(`/evaluations/${id}`),
  retryEvaluation: (id: number) => request<Assessment>(`/evaluations/${id}/retry`, json("POST")),
  audit: (page = 1) => request<{ id: number; actor_id: number; action: string; target_id: number; created_at: string }[]>("/evaluations/audit" + query({ page })),
  assignments: (filters: { scope: "sent" | "mine"; state?: string; page?: number }) => request<Page<Assignment>>("/review-assignments" + query(filters)),
  assign: (data: { response_id: number; rubric_id: number; reviewer: string; blind: boolean }) => request<Assignment>("/review-assignments", json("POST", data)),
  review: (id: number) => request<Assignment>(`/human-reviews/${id}`),
  grade: (id: number, data: ReviewDraft & { revision: number; submit: boolean }) =>
    request<Assignment>(`/human-reviews/${id}`, json("PUT", data)),
  consensus: (response_id: number, rubric_id: number, assignment_id?: number) => request<Consensus>("/review-consensus" + query({ response_id, rubric_id, assignment_id })),
  agreement: (rubric_id: number, population: StudyFilters["population"]) =>
    request<Agreement & { population: StudyFilters["population"] }>("/review-consensus/agreement" + query({ rubric_id, population })),
  disputes: (page = 1) => request<Dispute[]>("/review-consensus/disputes" + query({ page })),
  adjudicate: (data: { response_id: number; rubric_id: number; verdict: Verdict; justification: string; review_ids: number[] }) =>
    request<Consensus>("/review-consensus/adjudicate", json("POST", data)),
  taxonomy: () => request<Record<Dimension | "general", string[]>>("/errors/categories"),
  errors: (filters: { dimension?: Dimension; category?: string; severity?: string; state?: string; page?: number }) =>
    request<Page<ErrorRecord>>("/errors" + query(filters)),
  error: (id: number) => request<ErrorRecord & { input: ReviewMaterial | null }>(`/errors/${id}`),
  resolveError: (id: number, state: "confirmed" | "dismissed") => request<ErrorRecord>(`/errors/${id}`, json("PATCH", { state })),
  options: () => request<Options>("/analytics/options"),
  compare: (filters: StudyFilters) => request<Comparison>("/model-comparisons", json("POST", filters)),
  leaderboard: (filters: StudyFilters) => request<Comparison>("/leaderboard", json("POST", filters)),
  consistency: (filters: StudyFilters) => request<Consistency>("/consistency", json("POST", filters)),
  analytics: (filters: StudyFilters) => request<Analytics>("/analytics", json("POST", filters)),
  snapshots: (kind: Snapshot["kind"], page = 1) => request<Snapshot[]>("/" + (kind === "comparison" ? "model-comparisons" : "consistency") + query({ kind, page })),
  snapshot: <T,>(kind: Snapshot["kind"], id: number) =>
    request<Snapshot<T>>("/" + (kind === "comparison" ? "model-comparisons" : "consistency") + "/" + id),
  reports: (page = 1) => request<ReportRecord[]>("/reports" + query({ page })),
  generateReport: (data: { title: string; type: ReportType; filters: StudyFilters }) => request<Report>("/reports", json("POST", data)),
  report: (id: number) => request<Report>(`/reports/${id}`),
  dashboard: () => request<ResearchOverview>("/analytics/dashboard"),
};

export const display = (value: number | null | undefined, suffix = "") => value == null ? "—" : `${Number(value.toFixed(2))}${suffix}`;
export const friendly = (name: string) => name.replaceAll("_", " ");
