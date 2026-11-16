"use client";

import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { ErrorState, TabLoader } from "@/components/ui/Misc";
import { ROLES } from "@/lib/constants";
import { tabQuery, useMountFetch } from "@/lib/hooks";
import { apiError, initials } from "@/lib/utils";
import { useAddMemberMutation, useGetMembersQuery, useRemoveMemberMutation, useUpdateMemberMutation } from "@/store/api";
import type { Membership, ProjectRole } from "@/types/api";

export function MembersPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data: members, isFetching, isUninitialized, isError, refetch } = useGetMembersQuery(projectId, tabQuery);
  const pending = useMountFetch(isFetching, isUninitialized);
  const [add, { isLoading: adding }] = useAddMemberMutation();
  const [update] = useUpdateMemberMutation();
  const [remove, { isLoading: removing }] = useRemoveMemberMutation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("analyst");
  const [error, setError] = useState("");
  const [toRemove, setToRemove] = useState<Membership | null>(null);

  const onAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const result = await add({ projectId, email: email.trim(), role });
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      setError(fields.email ?? message);
      return;
    }
    setEmail("");
    toast.success("Member added");
  };

  const onRole = async (member: Membership, next: ProjectRole) => {
    const result = await update({ projectId, memberId: member.id, role: next });
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success(`${member.user.email} is now ${next}`);
  };

  const onRemove = async () => {
    if (!toRemove) return;
    const result = await remove({ projectId, memberId: toRemove.id });
    setToRemove(null);
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success("Member removed");
  };

  if (pending) return <TabLoader label="Loading members" />;
  if (isError) return <ErrorState message="Could not load members." onRetry={refetch} />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card padded={false} className="lg:col-span-2">
        <div className="p-5 pb-0"><CardHeader title={`Team (${members?.length ?? 0})`} description="People with access to this project." /></div>
        <ul className="divide-y divide-border">
            {members?.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(member.user.full_name || member.user.email)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.user.full_name || member.user.email}</p>
                  <p className="truncate text-xs text-muted">{member.user.email}</p>
                </div>
                {canManage ? (
                  <>
                    <div className="w-36">
                      <Select aria-label={`Role for ${member.user.email}`} value={member.role} onChange={(e) => onRole(member, e.target.value as ProjectRole)}>
                        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </div>
                    <IconButton label={`Remove ${member.user.email}`} variant="ghost" onClick={() => setToRemove(member)}><X className="size-4" /></IconButton>
                  </>
                ) : (
                  <RoleBadge role={member.role} />
                )}
              </li>
            ))}
        </ul>
      </Card>

      <div className="space-y-6">
        {canManage && (
          <Card>
            <CardHeader title="Add a member" description="They must already have an account." />
            <form onSubmit={onAdd} className="space-y-3">
              <Input label="Email" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
              <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
              <Button type="submit" className="w-full" icon={<UserPlus className="size-4" />} loading={adding}>Add member</Button>
            </form>
          </Card>
        )}
        <Card>
          <CardHeader title="Roles" />
          <dl className="space-y-3 text-sm">
            {ROLES.map((r) => (
              <div key={r.value}>
                <dt className="font-medium">{r.label}</dt>
                <dd className="text-xs text-muted">{r.description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <ConfirmDialog open={!!toRemove} onClose={() => setToRemove(null)} onConfirm={onRemove} loading={removing} title="Remove this member?" description={`${toRemove?.user.email ?? ""} will lose access to this project immediately.`} confirmLabel="Remove" />
    </div>
  );
}
