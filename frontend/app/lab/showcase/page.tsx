import type { Metadata } from "next";
import { ResearchShowcase } from "@/components/research-showcase";

export const metadata: Metadata = { title: "Research Showcase" };

export default function ShowcasePage() {
  return <ResearchShowcase />;
}
