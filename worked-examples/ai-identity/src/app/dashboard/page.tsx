import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  // Server-side enforcement: no valid session → bounce to /sign-in.
  // This is the real protection; the client never decides access.
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  const { user } = session;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>You are signed in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{user.email}</dd>
            <dt className="text-muted-foreground">User ID</dt>
            <dd className="font-mono text-xs break-all">{user.id}</dd>
          </dl>
          <div>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
