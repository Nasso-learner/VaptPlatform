import { getScan } from "@/lib/scans";
import { toHtml, toSarif } from "@/lib/report";

// GET /api/scans/:id/report?format=html|json|sarif
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scan = await getScan((await params).id);
  if (!scan) return Response.json({ error: "not found" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") ?? "html";
  const name = `vapt-${scan.type}-${scan.id.slice(0, 8)}`;
  if (format === "json")
    return Response.json(scan, { headers: { "Content-Disposition": `attachment; filename="${name}.json"` } });
  if (format === "sarif")
    return Response.json(toSarif(scan), { headers: { "Content-Disposition": `attachment; filename="${name}.sarif"` } });
  return new Response(toHtml(scan), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}
