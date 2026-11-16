import { LabShell } from "@/components/lab-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LabShell>{children}</LabShell>;
}
