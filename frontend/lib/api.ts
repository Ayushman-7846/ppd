import dataset from "../../datasets/demo.json";
import type { Dimension } from "@/lib/research";

export type Profile = { id: number; name: string; email: string; role: string };
export type Example = { dimension: Dimension; title: string; stimulus: string; task: string; observation: string; output: string };
export type Activity = { id: string; name: string; dimension: Dimension; status: string; date: string };
export type Demo = {
  provenance: "synthetic";
  models: string[];
  scores: Array<{ dimension: string; [key: string]: number | string }>;
  activity: Activity[];
  examples: Example[];
};
export type Workspace = {
  provenance: "workspace"; datasets: number; experiments: number; evaluations: number;
  recent: { id: number; name: string; state: string }[];
};
export const demoFixture = dataset as Demo;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { cache: "no-store", ...options });
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(envelope?.error?.message ?? "The API is unavailable. Try again shortly.", response.status);
  }
  if (!envelope || !("data" in envelope)) throw new ApiError("The API returned an unreadable response.", 502);
  return envelope.data as T;
}

async function demoRequest<T>(path: string, fallback: T) {
  try {
    const data = await request<T>(path, { signal: AbortSignal.timeout(2500) });
    return { data, source: "api" as const };
  } catch {
    return { data: fallback, source: "bundled" as const };
  }
}

export const api = {
  demo: () => demoRequest("/demo/overview", demoFixture),
  example: (dimension: Dimension) => {
    const example = demoFixture.examples.find((item) => item.dimension === dimension);
    if (!example) throw new Error("This example is unavailable.");
    return demoRequest(`/demo/examples/${dimension}`, example);
  },
  workspace: (signal?: AbortSignal) => request<Workspace>("/workspace/overview", { signal }),
  profile: (signal?: AbortSignal) => request<Profile>("/auth/me", { signal }),
  authenticate: (mode: "register" | "login", fields: { name?: string; email: string; password: string }) =>
    request<Profile>(`/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }),
  logout: () => request("/auth/logout", { method: "POST" }),
};
