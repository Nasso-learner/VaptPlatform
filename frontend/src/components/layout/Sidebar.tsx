"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ChevronsLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { IconButton } from "@/components/ui/Button";
import { bounce } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { setMobileNav, toggleSidebar } from "@/store/uiSlice";

import { Logo } from "./Logo";
import { NAV, isActivePath } from "./nav";

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isStaff = useAppSelector((state) => state.auth.user?.is_staff);
  return (
    <LayoutGroup id={collapsed ? "nav-collapsed" : "nav-expanded"}>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || isStaff);
          if (!items.length) return null;
          return (
            <div key={group.title}>
              {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle">{group.title}</p>}
              <ul className="space-y-1">
                {items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={cn("group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", collapsed && "justify-center", active ? "text-primary" : "text-muted hover:text-foreground")}
                      >
                        {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-primary-soft ring-1 ring-primary/25" transition={{ type: "spring", stiffness: 480, damping: 26 }} />}
                        <motion.span className="relative" whileHover={{ scale: 1.2, rotate: -6 }} whileTap={{ scale: 0.85 }} transition={bounce}>
                          <item.icon className="size-[18px]" aria-hidden />
                        </motion.span>
                        {!collapsed && <span className="relative truncate">{item.label}</span>}
                        {collapsed && <span className="sr-only">{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

export function Sidebar() {
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const mobileOpen = useAppSelector((state) => state.ui.mobileNavOpen);
  const dispatch = useAppDispatch();
  const pathname = usePathname();

  useEffect(() => {
    dispatch(setMobileNav(false));
  }, [pathname, dispatch]);

  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 80 : 264 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="glass sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border lg:flex"
      >
        <div className={cn("flex h-16 items-center border-b border-border px-4", collapsed ? "justify-center" : "justify-between")}>
          <Link href="/" aria-label="VAPT Platform home">
            <Logo collapsed={collapsed} />
          </Link>
          {!collapsed && (
            <IconButton label="Collapse sidebar" onClick={() => dispatch(toggleSidebar())}>
              <ChevronsLeft className="size-4" />
            </IconButton>
          )}
        </div>
        <NavList collapsed={collapsed} />
        {collapsed && (
          <div className="flex justify-center border-t border-border p-3">
            <IconButton label="Expand sidebar" onClick={() => dispatch(toggleSidebar())}>
              <ChevronsLeft className="size-4 rotate-180" />
            </IconButton>
          </div>
        )}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => dispatch(setMobileNav(false))} aria-hidden />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative flex h-full w-72 flex-col border-r border-border bg-surface"
            >
              <div className="flex h-16 items-center border-b border-border px-5">
                <Logo />
              </div>
              <NavList collapsed={false} onNavigate={() => dispatch(setMobileNav(false))} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
