"use client";

import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { Toaster } from "sonner";

import { makeStore, type AppStore } from "@/store";
import { setSidebarCollapsed } from "@/store/uiSlice";

const SIDEBAR_KEY = "vapt:sidebar-collapsed";

export function Providers({ children }: { children: React.ReactNode }) {
  // One store per browser session; created lazily so it is never shared between server requests.
  const [store] = useState<AppStore>(() => makeStore());

  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_KEY) === "1") store.dispatch(setSidebarCollapsed(true));
    let previous = store.getState().ui.sidebarCollapsed;
    return store.subscribe(() => {
      const current = store.getState().ui.sidebarCollapsed;
      if (current !== previous) {
        previous = current;
        localStorage.setItem(SIDEBAR_KEY, current ? "1" : "0");
      }
    });
  }, [store]);

  return (
    <Provider store={store}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster
            position="top-right"
            toastOptions={{ classNames: { toast: "!bg-surface !text-foreground !border !border-border !shadow-pop !rounded-xl" } }}
          />
        </MotionConfig>
      </ThemeProvider>
    </Provider>
  );
}
