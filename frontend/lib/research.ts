import { AudioLines, GitBranch, GitFork, MoveUpRight } from "lucide-react";

export const dimensions = [
  { id: "ambiguity", label: "Syntactic ambiguity", short: "Ambiguity", icon: GitFork, color: "cyan", question: "How many ways can one sentence be parsed?", output: "Distinct readings and constituency trees" },
  { id: "recursion", label: "Linguistic recursion", short: "Recursion", icon: GitBranch, color: "violet", question: "Can the model recognize and extend a nested structure?", output: "Recursion type, tree, and one new layer" },
  { id: "movement", label: "Syntactic movement", short: "Movement", icon: MoveUpRight, color: "blue", question: "Can the model locate the original position of a moved phrase?", output: "A tree with co-indexed traces" },
  { id: "phonology", label: "Phonological generalization", short: "Phonology", icon: AudioLines, color: "mint", question: "Can the model infer a sound rule from a miniature language?", output: "Rule input, output, and environment" },
] as const;

export type Dimension = (typeof dimensions)[number]["id"];
export const paperUrl = "https://doi.org/10.1109/TAI.2025.3575745";
export const studyUrl = "https://osf.io/y3bpt";
