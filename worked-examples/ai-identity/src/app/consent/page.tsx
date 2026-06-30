"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * OAuth consent screen.
 *
 * The oauth-provider plugin redirects the browser here with a SIGNED oauth
 * query string in the URL (client_id, scope, redirect_uri, ... + exp + sig).
 * This page shows the requesting client and the scopes it wants, then on a
 * decision POSTs the whole signed query back to /api/auth/oauth2/consent with
 * accept: true | false. The endpoint verifies the signature, records consent,
 * mints the authorization code, and returns the client's redirect URL — which
 * we then navigate the browser to.
 */
const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm your identity",
  profile: "See your basic profile (name)",
  email: "See your email address",
  offline_access: "Stay signed in (refresh access)",
};

export default function ConsentPage() {
  const [oauthQuery, setOauthQuery] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The exact, unmodified signed query string the server put in our URL.
    const raw = window.location.search.replace(/^\?/, "");
    if (!raw) {
      setError(
        "Missing authorization request. Start from the application you came from.",
      );
      return;
    }
    setOauthQuery(raw);
    const params = new URLSearchParams(raw);
    setClientId(params.get("client_id") ?? "an application");
    setScopes((params.get("scope") ?? "").split(" ").filter(Boolean));
  }, []);

  async function decide(accept: boolean) {
    if (!oauthQuery) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ accept, oauth_query: oauthQuery }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data?.url) {
      // Either the client callback (with ?code=) on approve, or an
      // access_denied error redirect on deny. Hand control back to the client.
      window.location.href = data.url;
      return;
    }
    setError(
      data?.error_description ||
        data?.message ||
        "Could not complete the request.",
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorize access</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{clientId}</span>{" "}
            wants to sign you in with your AuthCo account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">This will let it:</p>
          <ul className="flex flex-col gap-2">
            {scopes.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Confirm your identity
              </li>
            )}
            {scopes.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-0.5">
                  ✓
                </span>
                <span>{SCOPE_LABELS[s] ?? s}</span>
              </li>
            ))}
          </ul>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => decide(false)}
            disabled={busy || !oauthQuery}
          >
            Deny
          </Button>
          <Button
            className="flex-1"
            onClick={() => decide(true)}
            disabled={busy || !oauthQuery}
          >
            {busy ? "Working…" : "Approve"}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
