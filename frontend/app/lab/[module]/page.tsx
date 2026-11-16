import { notFound } from "next/navigation";
import { ResearchAnalyzer } from "@/components/research-analyzer";
import { LabSettings } from "@/components/lab-settings";
import { EvaluationCenter } from "@/components/evaluation-center";
import { ErrorExplorer } from "@/components/error-explorer";
import { ReportLibrary } from "@/components/report-library";
import { StudyWorkspace } from "@/components/study-workspace";
import { DatasetStudio } from "@/components/dataset-studio";
import { ExperimentWorkspace } from "@/components/experiment-workspace";
import { PromptStudio } from "@/components/prompt-studio";
import { dimensions } from "@/lib/research";
import { modules } from "@/lib/modules";

const items = modules.flatMap((group) => [...group.items]).filter((item) => item.route && item.route !== "showcase");
export const dynamicParams = false;
export const generateStaticParams = () => items.map((item) => ({ module: item.route }));

type PageProps = { params: Promise<{ module: string }> };
export async function generateMetadata({ params }: PageProps) {
  const { module } = await params;
  return { title: items.find((item) => item.route === module)?.label };
}

export default async function ModulePage({ params }: PageProps) {
  const { module } = await params;
  const dimension = dimensions.find((item) => item.id === module);
  if (dimension) return <ResearchAnalyzer dimension={dimension.id} />;
  if (module === "comparison" || module === "consistency" || module === "analytics" || module === "leaderboard") return <StudyWorkspace mode={module} />;
  if (module === "evaluation") return <EvaluationCenter />;
  if (module === "errors") return <ErrorExplorer />;
  if (module === "reports") return <ReportLibrary />;
  if (module === "experiments") return <ExperimentWorkspace />;
  if (module === "datasets") return <DatasetStudio />;
  if (module === "prompts") return <PromptStudio />;
  if (module === "settings") return <LabSettings />;
  notFound();
}
