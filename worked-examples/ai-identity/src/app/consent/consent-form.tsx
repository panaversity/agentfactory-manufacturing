"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Human-readable label per scope. This is only a *display* lookup keyed by the
// scopes that appear in the signed request — it never adds to the set. An
// unknown scope falls back to showing its raw name, so the screen can never
// show fewer or different scopes than the request actually carries (AC-9).
const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm your identity",
  profile: "See your basic profile (name, picture)",
  email: "See your email address",
  offline_access: "Stay connected when you are away",
  "notes.read": "Read your notes",
  "notes.write": "Create and change your notes",
};

// The authorize endpoint redirects here with the SIGNED request as the WHOLE
// query string (scope, client_id, …, sig). We display only what the query
// carries and POST the entire query string back verbatim as `oauth_query`; the
// consent endpoint validates the signature server-side, so a tampered query is
// rejected and the screen can never grant more than it showed.
export function ConsentForm() {
  const params = useSearchParams();
  const clientId = params.get("client_id") ?? undefined;
  const scope = params.get("scope") ?? undefined;
  // Presence of a signed request: the authorize redirect always carries `sig`.
  const hasRequest = !!params.get("sig");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      // The signed blob is the exact query string we were given — read it raw
      // (not reserialized) so the signature stays intact.
      const oauthQuery = window.location.search.replace(/^\?/, "");
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      // Same-origin fetch carries Sec-Fetch-Mode: cors, so the endpoint replies
      // with { redirect, url } JSON instead of a raw 302.
      const data = await res.json().catch(() => null);
      const url = data?.url ?? data?.redirect;
      if (url) {
        window.location.href = url;
        return;
      }
      setError("The authorization server did not return a redirect.");
    } catch {
      setError("Could not reach the authorization server.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasRequest) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nothing to authorize</CardTitle>
          <CardDescription>
            This page is reached as part of an app sign-in. Start from the
            application you are trying to connect.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const scopes = (scope ?? "").split(/\s+/).filter(Boolean);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Authorize access</CardTitle>
        <CardDescription>
          {clientId ? (
            <>
              <span className="font-medium">{clientId}</span> wants to access
              your AuthCo account.
            </>
          ) : (
            <>An application wants to access your AuthCo account.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {scopes.length > 0 && (
          <div>
            <p className="text-sm text-muted-foreground">It is requesting permission to:</p>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {scopes.map((s) => (
                <li key={s} className="flex flex-col">
                  <span>{SCOPE_LABELS[s] ?? s}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-4 flex gap-3">
        <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
          {busy ? "Working…" : "Approve"}
        </Button>
        <Button
          onClick={() => decide(false)}
          disabled={busy}
          variant="outline"
          className="flex-1"
        >
          Deny
        </Button>
      </CardFooter>
    </Card>
  );
}
