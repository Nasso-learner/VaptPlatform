import { BookOpen, CalendarClock, FileText, FolderKanban, LayoutDashboard, ScanSearch, ScrollText, Settings, ShieldAlert, Users, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };
export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Assess",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/scans", label: "Scans", icon: ScanSearch },
      { href: "/findings", label: "Findings", icon: ShieldAlert },
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/schedules", label: "Schedules", icon: CalendarClock },
    ],
  },
  { title: "Learn", items: [{ href: "/knowledge", label: "Knowledge base", icon: BookOpen }] },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "User management", icon: Users, adminOnly: true },
      { href: "/audit", label: "Audit log", icon: ScrollText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const isActivePath = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
