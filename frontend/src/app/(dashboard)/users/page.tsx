"use client";

import { Pencil, Search, ShieldAlert, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, Select, Switch } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Pagination } from "@/components/ui/Misc";
import { useDebounced } from "@/lib/hooks";
import { apiError, initials, timeAgo } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useCreateUserMutation, useGetUsersQuery, useUpdateUserMutation } from "@/store/api";
import type { AdminUser } from "@/types/api";

const PAGE_SIZE = 20;

function UserModal({ user, onClose }: { user: AdminUser | "new"; onClose: () => void }) {
  const creating = user === "new";
  const [create, { isLoading: creatingNow }] = useCreateUserMutation();
  const [update, { isLoading: updating }] = useUpdateUserMutation();
  const [email, setEmail] = useState(creating ? "" : user.email);
  const [fullName, setFullName] = useState(creating ? "" : user.full_name);
  const [password, setPassword] = useState("");
  const [isStaff, setIsStaff] = useState(creating ? false : user.is_staff);
  const [isActive, setIsActive] = useState(creating ? true : user.is_active);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    const result = creating
      ? await create({ email: email.trim(), full_name: fullName.trim(), password, is_staff: isStaff })
      : await update({ id: user.id, body: { full_name: fullName.trim(), is_staff: isStaff, is_active: isActive, ...(password ? { password } : {}) } });
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      return setErrors(Object.keys(fields).length ? fields : { form: message });
    }
    toast.success(creating ? "User created" : "User updated");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? "New user" : "Edit user"}
      description={creating ? undefined : user.email}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={creatingNow || updating}>{creating ? "Create user" : "Save changes"}</Button></>}
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        {creating && <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />}
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.full_name} />
        <Input label={creating ? "Password" : "New password"} type="password" autoComplete="new-password" required={creating} value={password} onChange={(e) => setPassword(e.target.value)} hint={creating ? "At least 12 characters; not common." : "Leave blank to keep the current password."} error={errors.password} />
        <Switch checked={isStaff} onChange={setIsStaff} label="Platform administrator" description="Can see every project and manage all users." />
        {!creating && <Switch checked={isActive} onChange={setIsActive} label="Active" description="Deactivated users cannot sign in. Their history is kept." />}
        {(errors.form || errors.is_staff || errors.is_active || errors.detail) && <p role="alert" className="rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm text-critical">{errors.form ?? errors.is_staff ?? errors.is_active ?? errors.detail}</p>}
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const me = useAppSelector((state) => state.auth.user);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [ordering, setOrdering] = useState("email");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);
  const debounced = useDebounced(search);
  const back = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  const { data, isLoading, error, refetch } = useGetUsersQuery({ search: debounced, is_active: status, is_staff: role, ordering, page, page_size: PAGE_SIZE }, { skip: !me?.is_staff });

  if (me && !me.is_staff) {
    return <Card><EmptyState icon={<ShieldAlert className="size-7" />} title="Administrators only" description="Ask a platform administrator if you need user management access." /></Card>;
  }

  const columns: Column<AdminUser>[] = [
    {
      key: "user", header: "User", sortKey: "email",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(u.full_name || u.email)}</span>
          <div className="min-w-0"><p className="truncate font-medium">{u.full_name || u.email}{u.id === me?.id && <span className="ml-2 text-xs text-subtle">(you)</span>}</p><p className="truncate text-xs text-muted">{u.email}</p></div>
        </div>
      ),
    },
    { key: "role", header: "Role", cell: (u) => (u.is_staff ? <Badge tone="primary">Admin</Badge> : <Badge>User</Badge>) },
    { key: "status", header: "Status", cell: (u) => (u.is_active ? <Badge tone="primary" dot>Active</Badge> : <Badge tone="critical" dot>Deactivated</Badge>) },
    { key: "projects", header: "Projects", sortKey: "project_count", hideBelow: "md", cell: (u) => <span className="tabular-nums">{u.project_count}</span> },
    { key: "login", header: "Last sign-in", sortKey: "last_login", hideBelow: "lg", cell: (u) => <span className="text-muted">{u.last_login ? timeAgo(u.last_login) : "Never"}</span> },
    { key: "edit", header: "", cell: (u) => <IconButton label={`Edit ${u.email}`} variant="ghost" onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton> },
  ];

  return (
    <>
      <PageHeader title="Users" description="Manage who can sign in. Project access is managed on each project's Members tab." actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setEditing("new")}>New user</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-56 flex-1"><Input aria-label="Search users" icon={<Search className="size-4" />} placeholder="Search by name or email…" value={search} onChange={(e) => back(setSearch)(e.target.value)} /></div>
          <div className="w-40"><Select aria-label="Role" value={role} onChange={(e) => back(setRole)(e.target.value)}><option value="">All roles</option><option value="true">Admins</option><option value="false">Users</option></Select></div>
          <div className="w-40"><Select aria-label="Status" value={status} onChange={(e) => back(setStatus)(e.target.value)}><option value="">Any status</option><option value="true">Active</option><option value="false">Deactivated</option></Select></div>
        </div>
        {error ? (
          <div className="p-4"><ErrorState message="Could not load users." onRetry={refetch} /></div>
        ) : (
          <>
            <DataTable columns={columns} rows={data?.results} rowKey={(u) => u.id} loading={isLoading} ordering={ordering} onOrderingChange={back(setOrdering)} empty={<EmptyState icon={<Users className="size-7" />} title="No users match" />} />
            <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </Card>
      {editing && <UserModal key={editing === "new" ? "new" : editing.id} user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
