import type { Report } from "@/types/api";

/** Reports are permission-checked downloads, so they go through the authenticated proxy and are saved from a Blob. */
export async function downloadReport(report: Pick<Report, "id" | "filename">): Promise<void> {
  const response = await fetch(`/api/proxy/reports/${report.id}/download`);
  if (!response.ok) throw new Error(response.status === 404 ? "This report is not ready yet." : "Download failed.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = report.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function fetchReportHtml(id: string): Promise<string> {
  const response = await fetch(`/api/proxy/reports/${id}/download?inline=1`);
  if (!response.ok) throw new Error("Could not load the report preview.");
  return response.text();
}
