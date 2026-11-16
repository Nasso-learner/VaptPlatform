"use client";

import { FolderKanban, FolderPlus, Search } from "lucide-react";
import { useState } from "react";

import { ProjectCard } from "@/components/projects/ProjectCard";
import { ButtonLink } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { Input, Select, Switch } from "@/components/ui/Field";
import { EmptyState, ErrorState, Pagination, Skeleton, Stagger, Rise } from "@/components/ui/Misc";
import { useDebounced } from "@/lib/hooks";
import { useGetProjectsQuery } from "@/store/api";

const PAGE_SIZE = 12;

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("-last_scanned_at");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const { data, isLoading, error, refetch } = useGetProjectsQuery({ search: debounced, ordering, is_archived: archived, page, page_size: PAGE_SIZE });
  const filtered = !!debounced || archived;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project ties a repository and/or a running application to its scans, findings and team."
        actions={<ButtonLink href="/projects/new" icon={<FolderPlus className="size-4" />}>New project</ButtonLink>}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input aria-label="Search projects" placeholder="Search projects…" icon={<Search className="size-4" />} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <div className="w-48">
          <Select aria-label="Sort by" value={ordering} onChange={(e) => setOrdering(e.target.value)}>
            <option value="-last_scanned_at">Recently scanned</option>
            <option value="-open_findings_count">Most open findings</option>
            <option value="-latest_risk_score">Highest risk</option>
            <option value="name">Name</option>
            <option value="-created_at">Newest</option>
          </Select>
        </div>
        <Switch label="Archived" checked={archived} onChange={(v) => (setArchived(v), setPage(1))} />
      </div>

      {error ? (
        <ErrorState message="Could not load projects." onRetry={refetch} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : data && data.results.length > 0 ? (
        <>
          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.results.map((project) => (
              <Rise key={project.id}>
                <ProjectCard project={project} />
              </Rise>
            ))}
          </Stagger>
          <Pagination page={page} count={data.count} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-7" />}
            title={filtered ? "No projects match" : "No projects yet"}
            description={filtered ? "Try a different search, or include archived projects." : "Create a project to start scanning."}
            action={!filtered ? <ButtonLink href="/projects/new" icon={<FolderPlus className="size-4" />}>New project</ButtonLink> : undefined}
          />
        </Card>
      )}
    </>
  );
}
