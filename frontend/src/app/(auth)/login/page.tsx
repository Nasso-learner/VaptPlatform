"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useAnimationControls } from "framer-motion";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { LogoMark } from "@/components/layout/Logo";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { riseIn, stagger } from "@/lib/motion";
import { api, useGetAuthConfigQuery } from "@/store/api";
import { useAppDispatch } from "@/store";

const schema = z.object({ email: z.string().min(1, "Enter your email").email("That doesn't look like an email address"), password: z.string().min(1, "Enter your password") });
type Values = z.infer<typeof schema>;

/** Only same-site relative paths are allowed as a post-login target (prevents open redirects). */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginForm() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const params = useSearchParams();
  const controls = useAnimationControls();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");
  const { data: config } = useGetAuthConfigQuery();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    setServerError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "Sign in failed.");
      }
      dispatch(api.util.resetApiState()); // never show a previous user's cached data
      router.replace(safeNext(params.get("next")));
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Sign in failed.");
      controls.start({ x: [0, -12, 12, -9, 9, -4, 0], transition: { duration: 0.5 } });
    }
  };

  return (
    <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="w-full max-w-sm">
      <motion.div variants={riseIn} className="mb-8 flex items-center gap-3 lg:hidden">
        <LogoMark className="size-10" />
        <span className="text-lg font-semibold">VAPT Platform</span>
      </motion.div>
      <motion.div variants={riseIn}>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted">Sign in to continue to your security dashboard.</p>
      </motion.div>

      <motion.form variants={riseIn} animate={controls} onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
        {serverError && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} role="alert" className="flex items-start gap-2.5 rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {serverError}
          </motion.div>
        )}
        <Input label="Email" type="email" autoComplete="email" placeholder="you@company.com" icon={<Mail className="size-4" />} error={errors.email?.message} {...register("email")} />
        <Input
          label="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Your password"
          icon={<Lock className="size-4" />}
          error={errors.password?.message}
          trailing={
            <IconButton label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
          }
          {...register("password")}
        />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </motion.form>

      {config?.registration_open && (
        <motion.p variants={riseIn} className="mt-8 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </motion.p>
      )}
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
