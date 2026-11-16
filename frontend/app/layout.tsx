import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import "./research.css";
import "./science.css";
import { ThemeProvider } from "@/components/theme";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "LinguaLens • Metalinguistic Research", template: "%s • LinguaLens" },
  description: "An intelligent research workspace for evaluating how large language models analyze syntax and phonology.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <a className="skip-link" href="#main">Skip to content</a>
    <ThemeProvider><ToastProvider>{children}</ToastProvider></ThemeProvider>
  </body></html>;
}
