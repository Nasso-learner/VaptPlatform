import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR, getScan } from "@/lib/scans";
import { counts } from "@/lib/report";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/scans/:id — full scan with findings
export async function GET(_: Request, { params }: Ctx) {
  const scan = await getScan((await params).id);
  if (!scan) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...scan, counts: counts(scan) });
}

// DELETE /api/scans/:id
export async function DELETE(_: Request, { params }: Ctx) {
  const scan = await getScan((await params).id);
  if (!scan) return Response.json({ error: "not found" }, { status: 404 });
  if (scan.status === "running" || scan.status === "queued") return Response.json({ error: "scan still running" }, { status: 409 });
  await fs.rm(path.join(DATA_DIR, "scans", `${scan.id}.json`));
  return new Response(null, { status: 204 });
}
