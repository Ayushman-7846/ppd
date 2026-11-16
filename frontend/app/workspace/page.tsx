import type { Metadata } from "next";
import { LabShell } from "@/components/lab-shell";
import { PrivateWorkspace } from "@/components/private-workspace";

export const metadata: Metadata = { title: "My Workspace" };
export default function WorkspacePage() {
  return <LabShell><PrivateWorkspace /></LabShell>;
}
