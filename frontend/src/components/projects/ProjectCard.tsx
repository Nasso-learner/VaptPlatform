"use client";

import { Code2, Globe, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Badge, RoleBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { RiskRing } from "@/components/ui/Charts";
import { timeAgo } from "@/lib/utils";
import type { Project } from "@/types/api";

export function ProjectCard({ project }: { project: Project }) {
  const hostname = (() => {
    try {
      return project.target_url ? new URL(project.target_url).host : "";
    } catch {
      return project.target_url;
    }
  })();

  return (
    <Link href={`/projects/${project.id}`} className="block rounded-2xl focus-visible:outline-offset-4">
      <Card interactive className="h-full">
        <div className="flex items-start gap-4">
          <RiskRing score={project.latest_risk_score} grade={project.latest_risk_grade} size={60} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{project.name}</h3>
              {project.is_archived && <Badge>Archived</Badge>}
            </div>
            <p className="mt-0.5 line-clamp-2 min-h-8 text-xs text-muted">{project.description || "No description"}</p>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 text-xs text-muted">
          {project.allow_sast && (
            <p className="flex items-center gap-2">
              <Code2 className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{project.repository_url ? project.repository_url.replace(/^https?:\/\//, "") : "Repository not set"}</span>
              {project.is_repository_verified && <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-label="Repository verified" />}
            </p>
          )}
          {project.allow_dast && (
            <p className="flex items-center gap-2">
              <Globe className="size-3.5 shrink-0 text-low" aria-hidden />
              <span className="truncate">{hostname || "Target not set"}</span>
              {project.is_target_verified ? <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-label="Target verified" /> : project.target_url ? <ShieldAlert className="size-3.5 shrink-0 text-medium" aria-label="Target not verified" /> : null}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className={project.open_findings_count ? "font-medium text-high" : "text-muted"}>{project.open_findings_count} open finding{project.open_findings_count === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-2 text-subtle">
            {project.last_scanned_at ? `Scanned ${timeAgo(project.last_scanned_at)}` : "Never scanned"}
            <RoleBadge role={project.my_role} />
          </span>
        </div>
      </Card>
    </Link>
  );
}
