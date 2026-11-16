"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Lock, Mail, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { riseIn, stagger } from "@/lib/motion";
import { apiError, cn } from "@/lib/utils";
import { useGetAuthConfigQuery, useRegisterMutation } from "@/store/api";

const schema = z
  .object({
    full_name: z.string().min(2, "Enter your name"),
    email: z.string().min(1, "Enter your email").email("That doesn't look like an email address"),
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
type Values = z.infer<typeof schema>;

function strength(password: string) {
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}
const STRENGTH = [
  { label: "Too weak", color: "bg-critical" },
  { label: "Weak", color: "bg-high" },
  { label: "Okay", color: "bg-medium" },
  { label: "Strong", color: "bg-primary" },
  { label: "Excellent", color: "bg-primary" },
];

export default function RegisterPage() {
  const router = useRouter();
  const { data: config, isLoading } = useGetAuthConfigQuery();
  const [registerUser] = useRegisterMutation();
  const [serverError, setServerError] = useState("");
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });
  const score = strength(watch("password") ?? "");

  const onSubmit = async ({ confirm: _confirm, ...values }: Values) => {
    setServerError("");
    const result = await registerUser(values);
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      for (const [name, text] of Object.entries(fields)) if (name in values) setError(name as keyof Values, { message: text });
      setServerError(Object.keys(fields).length ? "" : message);
      return;
    }
    toast.success("Account created. You can sign in now.");
    router.replace("/login");
  };

  if (!isLoading && config && !config.registration_open) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Registration is closed</h1>
        <p className="mt-2 text-sm text-muted">Ask a platform administrator to create an account for you.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <motion.div variants={stagger(0.07)} initial="hidden" animate="show" className="w-full max-w-sm">
      <motion.div variants={riseIn}>
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-muted">Start scanning your code and applications in minutes.</p>
      </motion.div>
      <motion.form variants={riseIn} onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-4">
        {serverError && <p role="alert" className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">{serverError}</p>}
        <Input label="Full name" autoComplete="name" icon={<User className="size-4" />} error={errors.full_name?.message} {...register("full_name")} />
        <Input label="Email" type="email" autoComplete="email" icon={<Mail className="size-4" />} error={errors.email?.message} {...register("email")} />
        <div>
          <Input label="Password" type="password" autoComplete="new-password" icon={<Lock className="size-4" />} error={errors.password?.message} hint="At least 10 characters; avoid common passwords." {...register("password")} />
          <div className="mt-2 flex items-center gap-3" aria-live="polite">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div className={cn("h-full rounded-full", STRENGTH[score].color)} animate={{ width: `${((score + 1) / 5) * 100}%` }} transition={{ type: "spring", stiffness: 400, damping: 18 }} />
            </div>
            <span className="w-16 text-right text-xs text-muted">{STRENGTH[score].label}</span>
          </div>
        </div>
        <Input label="Confirm password" type="password" autoComplete="new-password" icon={<Lock className="size-4" />} error={errors.confirm?.message} {...register("confirm")} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </motion.form>
      <motion.p variants={riseIn} className="mt-8 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </motion.p>
    </motion.div>
  );
}
