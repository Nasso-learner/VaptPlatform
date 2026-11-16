"use client";

import { LogOut, Menu as MenuIcon, Search, Settings, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Misc";
import { initials } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { setMobileNav, setPalette } from "@/store/uiSlice";

import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useSignOut } from "./useSignOut";

export function Topbar() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const signOut = useSignOut();

  return (
    <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6">
      <IconButton label="Open navigation" className="lg:hidden" onClick={() => dispatch(setMobileNav(true))}>
        <MenuIcon className="size-5" />
      </IconButton>
      <Link href="/" className="lg:hidden" aria-label="VAPT Platform home">
        <LogoMark className="size-8" />
      </Link>

      <button
        onClick={() => dispatch(setPalette(true))}
        className="ml-1 hidden h-10 w-full max-w-sm cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-3.5 text-sm text-subtle transition-colors hover:border-primary/50 hover:text-muted sm:flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <IconButton label="Search" className="sm:hidden" onClick={() => dispatch(setPalette(true))}>
          <Search className="size-[18px]" />
        </IconButton>
        <ThemeToggle />
        <Menu
          label="Account menu"
          trigger={
            <span className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-surface-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-fg">{initials(user?.full_name, user?.email)}</span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-36 truncate text-sm font-medium">{user?.full_name || user?.email}</span>
                <span className="block text-[11px] text-subtle">{user?.is_staff ? "Administrator" : "Member"}</span>
              </span>
            </span>
          }
          items={[
            { label: "Settings", icon: <Settings className="size-4" />, onSelect: () => router.push("/settings") },
            { label: "User management", icon: <UserCog className="size-4" />, onSelect: () => router.push("/users"), hidden: !user?.is_staff },
            { label: "Sign out", icon: <LogOut className="size-4" />, onSelect: signOut, danger: true },
          ]}
        />
        {user?.is_staff && <Badge tone="primary" className="hidden xl:inline-flex">Admin</Badge>}
      </div>
    </header>
  );
}
