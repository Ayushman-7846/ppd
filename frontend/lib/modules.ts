import { AlertCircle, AudioLines, BarChart3, ClipboardCheck, Code2, Database, FileText, FlaskConical, GitBranch, GitFork, GraduationCap, LayoutDashboard, MoveUpRight, Repeat2, Settings2, Split, Trophy } from "lucide-react";

export const modules = [
  { group: "Workspace", items: [
    { route: "", label: "Dashboard", icon: LayoutDashboard },
    { route: "showcase", label: "Research Showcase", icon: GraduationCap },
    { route: "experiments", label: "Experiment Laboratory", icon: FlaskConical },
    { route: "comparison", label: "Model Comparison", icon: Split },
    { route: "consistency", label: "Consistency Laboratory", icon: Repeat2 },
  ]},
  { group: "Linguistic analyses", items: [
    { route: "ambiguity", label: "Ambiguity Analysis", icon: GitFork },
    { route: "recursion", label: "Recursion Analysis", icon: GitBranch },
    { route: "movement", label: "Syntactic Movement", icon: MoveUpRight },
    { route: "phonology", label: "Phonological Analysis", icon: AudioLines },
  ]},
  { group: "Research tools", items: [
    { route: "datasets", label: "Dataset Studio", icon: Database },
    { route: "prompts", label: "Prompt Studio", icon: Code2 },
    { route: "evaluation", label: "Evaluation Center", icon: ClipboardCheck },
    { route: "errors", label: "Error Explorer", icon: AlertCircle },
    { route: "analytics", label: "Research Analytics", icon: BarChart3 },
    { route: "leaderboard", label: "Model Leaderboard", icon: Trophy },
    { route: "reports", label: "Reports", icon: FileText },
    { route: "settings", label: "Settings", icon: Settings2 },
  ]},
] as const;

