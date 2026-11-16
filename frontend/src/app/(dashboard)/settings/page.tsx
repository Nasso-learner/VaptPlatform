"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Misc";
import { apiError, formatDate, initials } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useChangePasswordMutation, useUpdateMeMutation } from "@/store/api";

const passwordSchema = z
  .object({ current_password: z.string().min(1, "Enter your current password"), new_password: z.string().min(12, "Use at least 12 characters"), confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Choose a different password" });
type PasswordValues = z.infer<typeof passwordSchema>;

function ProfileCard() {
  const user = useAppSelector((state) => state.auth.user);
  const [update, { isLoading }] = useUpdateMeMutation();
  const [name, setName] = useState(user?.full_name ?? "");
  useEffect(() => setName(user?.full_name ?? ""), [user?.full_name]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await update({ full_name: name.trim() });
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success("Profile updated");
  };

  return (
    <Card>
      <CardHeader title="Profile" />
      <div className="mb-5 flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary">{initials(user?.full_name || user?.email || "")}</span>
        <div>
          <p className="font-medium">{user?.email}</p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">{user?.is_staff ? "Platform administrator" : "Member"} · joined {formatDate(user?.date_joined, false)}</p>
        </div>
      </div>
      <form onSubmit={save} className="space-y-4">
        <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={isLoading} disabled={name.trim() === (user?.full_name ?? "")}>Save profile</Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [change, { isLoading }] = useChangePasswordMutation();
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = handleSubmit(async ({ current_password, new_password }) => {
    const result = await change({ current_password, new_password });
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      const hit = (["current_password", "new_password"] as const).filter((f) => fields[f]);
      hit.forEach((f) => setError(f, { message: fields[f] }));
      if (!hit.length) toast.error(message);
      return;
    }
    toast.success("Password changed");
    reset();
  });

  return (
    <Card>
      <CardHeader title="Change password" description="You stay signed in on this device." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Input label="Current password" type="password" autoComplete="current-password" error={errors.current_password?.message} {...register("current_password")} />
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 12 characters; avoid common passwords." error={errors.new_password?.message} {...register("new_password")} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
        <Button type="submit" loading={isLoading}>Update password</Button>
      </form>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Card>
      <CardHeader title="Appearance" />
      {mounted && (
        <Segmented
          label="Theme"
          value={(theme ?? "dark") as "light" | "dark" | "system"}
          onChange={setTheme}
          items={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]}
        />
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Sun className="size-3.5" aria-hidden /><Moon className="size-3.5" aria-hidden /><Monitor className="size-3.5" aria-hidden />Follows your choice on every device you use this browser on.</p>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your account and preferences." />
      <div className="mx-auto grid max-w-3xl gap-6">
        <ProfileCard />
        <PasswordCard />
        <AppearanceCard />
      </div>
    </>
  );
}
