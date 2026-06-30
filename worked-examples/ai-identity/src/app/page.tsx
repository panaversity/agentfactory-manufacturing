import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AuthCo</CardTitle>
          <CardDescription>
            Our own identity service. Sign in once here, and other apps can sign
            you in without ever seeing your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Email and password sign-in, server-side sessions, and a full OAuth 2.1
          / OIDC issuer (discovery, JWKS, authorization-code flow with consent).
        </CardContent>
        <CardFooter className="mt-6 flex gap-3">
          <Link
            href="/sign-up"
            className={buttonVariants({ className: "flex-1" })}
          >
            Create account
          </Link>
          <Link
            href="/sign-in"
            className={buttonVariants({
              variant: "outline",
              className: "flex-1",
            })}
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
