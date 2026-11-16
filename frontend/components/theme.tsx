"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; change: (theme: Theme) => void }>({ theme: "dark", change: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    if (localStorage.getItem("lingualens.theme") === "light") {
      setTheme("light");
      document.documentElement.dataset.theme = "light";
    }
  }, []);
  function change(value: Theme) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    localStorage.setItem("lingualens.theme", value);
  }
  return <ThemeContext.Provider value={{ theme, change }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle() {
  const { theme, change } = useTheme();
  return <Button size="icon" variant="ghost" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => change(theme === "dark" ? "light" : "dark")}>
    {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
  </Button>;
}
