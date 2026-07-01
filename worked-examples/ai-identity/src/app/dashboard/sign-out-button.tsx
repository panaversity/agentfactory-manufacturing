"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    await signOut();
    // Full navigation so the now-invalid session is re-evaluated server-side.
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={loading}>
      {loading ? "Signing out…" : "Sign out"}
    </Button>
  );
}
