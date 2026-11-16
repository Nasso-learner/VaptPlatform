import { createScan, listScans, validateInput } from "@/lib/scans";
import { counts } from "@/lib/report";

// GET /api/scans — list scans (summary only)
export async function GET() {
  const scans = await listScans();
  return Response.json(scans.map(({ findings, ...s }) => ({ ...s, counts: counts({ ...s, findings }) })));
}

// POST /api/scans — start a scan
// SAST: { type:"sast", repo:"https://github.com/org/repo" | "C:\\path", token?, authorized:true }
// DAST: { type:"dast", url:"https://app", authHeader?:"Authorization: Bearer x", openapiUrl?, active?, authorized:true }
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const input = validateInput(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  return Response.json(await createScan(input), { status: 201 });
}
