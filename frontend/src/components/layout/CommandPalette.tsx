"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, FolderKanban, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { useGetProjectsQuery } from "@/store/api";
import { useAppDispatch, useAppSelector } from "@/store";
import { setPalette } from "@/store/uiSlice";

import { NAV } from "./nav";

type Entry = { id: string; label: string; hint: string; href: string; icon: React.ReactNode };

/** Ctrl/Cmd+K quick navigation: pages and projects, fully keyboard driven. */
export function CommandPalette() {
  const open = useAppSelector((state) => state.ui.paletteOpen);
  const isStaff = useAppSelector((state) => state.auth.user?.is_staff);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { data: projects } = useGetProjectsQuery({ page_size: 100 }, { skip: !open });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch(setPalette(!open));
      }
      if (event.key === "Escape" && open) dispatch(setPalette(false));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const pages = NAV.flatMap((group) => group.items.filter((item) => !item.adminOnly || isStaff).map((item) => ({ id: item.href, label: item.label, hint: "Page", href: item.href, icon: <item.icon className="size-4" /> })));
    const projectEntries = (projects?.results ?? []).map((p) => ({ id: p.id, label: p.name, hint: "Project", href: `/projects/${p.id}`, icon: <FolderKanban className="size-4" /> }));
    const needle = query.trim().toLowerCase();
    return [...pages, ...projectEntries].filter((entry) => !needle || entry.label.toLowerCase().includes(needle)).slice(0, 12);
  }, [projects, query, isStaff]);

  const go = (entry?: Entry) => {
    if (!entry) return;
    dispatch(setPalette(false));
    router.push(entry.href);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => dispatch(setPalette(false))} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Quick navigation"
            initial={{ opacity: 0, scale: 0.9, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 24 }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-subtle" aria-hidden />
              <input
                ref={input}
                value={query}
                onChange={(event) => (setQuery(event.target.value), setIndex(0))}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") (event.preventDefault(), setIndex((i) => Math.min(i + 1, entries.length - 1)));
                  if (event.key === "ArrowUp") (event.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
                  if (event.key === "Enter") go(entries[index]);
                }}
                placeholder="Jump to a page or project…"
                aria-label="Search pages and projects"
                className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
              />
              <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-subtle">ESC</kbd>
            </div>
            <ul role="listbox" className="max-h-80 overflow-y-auto p-2">
              {entries.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No matches.</li>}
              {entries.map((entry, i) => (
                <li key={entry.id} role="option" aria-selected={i === index}>
                  <button
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => go(entry)}
                    className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", i === index ? "bg-primary-soft text-primary" : "text-foreground")}
                  >
                    {entry.icon}
                    <span className="flex-1 truncate">{entry.label}</span>
                    <span className="text-xs text-subtle">{entry.hint}</span>
                    {i === index && <CornerDownLeft className="size-3.5" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
