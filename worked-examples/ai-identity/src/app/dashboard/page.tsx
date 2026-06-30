"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/sign-in");
    }
  }, [isPending, session, router]);

  async function handleSignOut() {
    await signOut();
    router.replace("/sign-in");
  }

  if (isPending || !session) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome, {session.user.name || "there"}</CardTitle>
          <CardDescription>You are signed in to AuthCo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{session.user.name}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{session.user.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">User ID</span>
            <span className="font-mono text-xs">{session.user.id}</span>
          </div>
        </CardContent>
        <CardFooter className="mt-6">
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
