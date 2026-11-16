"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const Context = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(Context);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (message) {
      const timeout = setTimeout(() => setMessage(""), 4500);
      return () => clearTimeout(timeout);
    }
  }, [message]);
  return <Context.Provider value={setMessage}>
    {children}
    <div className="toast-region" aria-live="polite">
      {message && <div className="toast"><CheckCircle2 size={18} /><span>{message}</span><Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setMessage("")}><X size={15} /></Button></div>}
    </div>
  </Context.Provider>;
}
