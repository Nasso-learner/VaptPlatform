"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { api } from "@/store/api";
import { useAppDispatch } from "@/store";
import { signedOut } from "@/store/authSlice";

/** Clears the httpOnly session cookies server-side, wipes cached API data, and returns to /login. */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  return useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    dispatch(signedOut());
    dispatch(api.util.resetApiState());
    router.replace("/login");
  }, [dispatch, router]);
}
