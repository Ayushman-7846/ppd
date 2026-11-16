import type { Metadata } from "next";
import { ResearchDashboard } from "@/components/research-dashboard";

export const metadata: Metadata = { title: "Research Dashboard" };
export default function LabPage() { return <ResearchDashboard />; }
