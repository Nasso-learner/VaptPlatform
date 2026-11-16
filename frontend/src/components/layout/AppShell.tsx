"use client";

import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useGetMeQuery } from "@/store/api";
import { useAppDispatch, useAppSelector } from "@/store";
import { signedIn } from "@/store/authSlice";

import { CommandPalette } from "./CommandPalette";
import { LogoMark } from "./Logo";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
        <LogoMark className="size-16" />
      </motion.div>
    </div>
  );
}

/** Loads the signed-in user once, guards every dashboard page, and renders the sidebar + topbar frame. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const status = useAppSelector((state) => state.auth.status);
  const { data: me } = useGetMeQuery();

  useEffect(() => {
    if (me) dispatch(signedIn(me));
  }, [me, dispatch]);

  useEffect(() => {
    if (status !== "anonymous") return;
    // Make sure the (possibly stale) cookies are gone, otherwise middleware would bounce /login back to /.
    fetch("/api/auth/logout", { method: "POST" }).finally(() => router.replace("/login"));
  }, [status, router]);

  if (status !== "authenticated") return <Splash />;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
            {children}
          </motion.div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
