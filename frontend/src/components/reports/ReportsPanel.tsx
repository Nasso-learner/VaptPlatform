"use client";

import { Download, Eye, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Misc";
import { REPORT_FORMAT_INFO } from "@/lib/constants";
import { downloadReport, fetchReportHtml } from "@/lib/download";
import { apiError, formatBytes, timeAgo } from "@/lib/utils";
import { useRegenerateReportsMutation } from "@/store/api";
import type { Report } from "@/types/api";

const STATUS_TONE = { ready: "primary", failed: "critical", pending: "neutral", generating: "low" } as const;

export function ReportActions({ report }: { report: Report }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const ready = report.status === "ready";

  const download = async () => {
    setBusy(true);
    try {
      await downloadReport(report);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };
  const openPreview = async () => {
    setLoadingPreview(true);
    try {
      setPreview(await fetchReportHtml(report.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {ready && report.report_format === "html" && (
          <Button size="sm" variant="secondary" icon={<Eye className="size-4" />} loading={loadingPreview} onClick={openPreview}>
            Preview
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} loading={busy} disabled={!ready} onClick={download}>
          Download
        </Button>
      </div>
      <Modal open={preview !== null} onClose={() => setPreview(null)} title={report.filename} size="xl">
        {/* Empty sandbox: the report is generated from scan data, so never let it run scripts in our origin. */}
        <iframe title={`Preview of ${report.filename}`} sandbox="" srcDoc={preview ?? ""} className="h-[70vh] w-full rounded-xl border border-border bg-white" />
      </Modal>
    </>
  );
}

export function ReportsPanel({ reports, scanId, canRegenerate }: { reports: Report[] | undefined; scanId: string; canRegenerate: boolean }) {
  const [regenerate, { isLoading }] = useRegenerateReportsMutation();
  if (!reports) return <Skeleton className="h-40" />;

  const onRegenerate = async () => {
    const result = await regenerate({ scan: scanId });
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success("Reports regenerated");
  };

  return (
    <div>
      {canRegenerate && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={isLoading} onClick={onRegenerate}>
            Regenerate all
          </Button>
        </div>
      )}
      {reports.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Reports appear once the scan completes.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {reports.map((report) => {
            const info = REPORT_FORMAT_INFO[report.report_format];
            return (
              <li key={report.id} className="flex flex-wrap items-center gap-4 p-4">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <FileText className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{info?.label ?? report.report_format.toUpperCase()}</p>
                  <p className="text-xs text-muted">
                    {report.status === "failed" ? report.error_message || "Generation failed" : `${info?.hint ?? ""}${report.file_size_bytes ? ` · ${formatBytes(report.file_size_bytes)}` : ""}${report.generated_at ? ` · ${timeAgo(report.generated_at)}` : ""}`}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[report.status]}>{report.status}</Badge>
                <ReportActions report={report} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
