import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Identity service · Better Auth
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          AuthCo
        </h1>
        <p className="max-w-md text-lg leading-8 text-muted-foreground">
          A production-grade identity service, manufactured one spec at a time.
          Email and password sign-in is live.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/sign-up" className={buttonVariants()}>
          Create account
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
