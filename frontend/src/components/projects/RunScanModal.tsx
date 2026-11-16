"use client";

import { Code2, Globe, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Switch } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Misc";
import { apiError, hasRole } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useCreateScanMutation } from "@/store/api";
import type { Project, ScanProfile, ScanType } from "@/types/api";

export function RunScanModal({ project, open, onClose, initialType }: { project: Project; open: boolean; onClose: () => void; initialType?: ScanType }) {
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const [createScan, { isLoading }] = useCreateScanMutation();

  const sastReady = project.allow_sast && project.is_repository_verified;
  const dastReady = project.allow_dast && project.is_target_verified;
  const canActive = project.allow_active_dast && hasRole(project.my_role, "maintainer", user?.is_staff);

  // Prefer a type that is ready, then one that is merely enabled, so the blocker message matches what the user expects.
  const defaultType: ScanType = initialType ?? (sastReady ? "sast" : dastReady ? "dast" : project.allow_sast || !project.allow_dast ? "sast" : "dast");

  const [type, setType] = useState<ScanType>(defaultType);
  const [profile, setProfile] = useState<ScanProfile>("standard");
  const [active, setActive] = useState(false);
  const [openapi, setOpenapi] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setType(defaultType);
      setError("");
    }
  }, [open, defaultType]);

  const blocker =
    type === "sast"
      ? !project.allow_sast ? "Static analysis is disabled for this project." : !project.is_repository_verified ? "Validate the repository first (Overview tab)." : ""
      : !project.allow_dast ? "Dynamic testing is disabled for this project." : !project.is_target_verified ? "Verify ownership of the target URL first (Overview tab)." : "";

  const submit = async () => {
    setError("");
    const body = type === "sast" ? { scan_type: type, profile } : { scan_type: type, profile, active: active && canActive, ...(openapi ? { openapi_url: openapi } : {}), ...(authHeader ? { auth_header: authHeader } : {}) };
    const result = await createScan({ projectId: project.id, body });
    if ("error" in result) {
      setError(apiError(result.error).message);
      return;
    }
    toast.success("Scan queued");
    onClose();
    router.push(`/scans/${result.data.id}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run a scan"
      description={project.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={<Rocket className="size-4" />} loading={isLoading} disabled={!!blocker} onClick={submit}>Start scan</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium">Scan type</p>
          <div className="grid grid-cols-2 gap-3">
            {([["sast", "Static analysis", "Code, secrets, dependencies", Code2, sastReady], ["dast", "Dynamic testing", "Running application", Globe, dastReady]] as const).map(([value, label, hint, Icon, ready]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                aria-pressed={type === value}
                className={`rounded-2xl border p-4 text-left transition-all active:scale-95 ${type === value ? "border-primary bg-primary-soft" : "border-border hover:border-primary/40"}`}
              >
                <Icon className="mb-2 size-5 text-primary" aria-hidden />
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted">{ready ? hint : "Not ready"}</p>
              </button>
            ))}
          </div>
          {blocker && <p role="alert" className="mt-2 text-sm text-medium">{blocker}</p>}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Profile</p>
          <Segmented label="Scan profile" value={profile} onChange={setProfile} items={[{ value: "quick", label: "Quick" }, { value: "standard", label: "Standard" }]} />
          <p className="mt-2 text-xs text-muted">{profile === "quick" ? "Faster, fewer engines. Good for pull-request checks." : "All enabled engines. Recommended."}</p>
        </div>

        {type === "dast" && (
          <div className="space-y-4">
            <Switch checked={active && canActive} disabled={!canActive} onChange={setActive} label="Active scan" description={canActive ? "Sends attack payloads to the target. Use only on systems you can safely test." : "Needs maintainer role and “Allow active scans” enabled on the project."} />
            <Input label="OpenAPI / Swagger URL" placeholder="https://staging.acme.com/openapi.json" hint="Optional. Helps the scanner discover API endpoints." value={openapi} onChange={(e) => setOpenapi(e.target.value)} />
            <Input label="Authorization header" type="password" autoComplete="off" placeholder="Bearer eyJ…" hint="Optional. Lets the scan reach authenticated pages. Not stored after the scan." value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} />
          </div>
        )}

        {error && <p role="alert" className="rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
