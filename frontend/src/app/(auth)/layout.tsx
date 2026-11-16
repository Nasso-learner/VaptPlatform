import { AuthVisual } from "@/components/auth/AuthVisual";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <AuthVisual />
      <main className="relative flex w-full flex-col items-center justify-center px-5 py-10 lg:w-[540px] lg:shrink-0">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        {children}
      </main>
    </div>
  );
}
