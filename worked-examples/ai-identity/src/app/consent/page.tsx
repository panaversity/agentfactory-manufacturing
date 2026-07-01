import { Suspense } from "react";
import { ConsentForm } from "./consent-form";

export default function ConsentPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <Suspense fallback={null}>
        <ConsentForm />
      </Suspense>
    </main>
  );
}
