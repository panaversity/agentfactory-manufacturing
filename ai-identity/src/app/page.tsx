import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AuthCo — your identity service</CardTitle>
          <CardDescription>
            The canvas is primed. Nothing is wired yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This app boots empty on purpose. You build sign-in, the issuer, and
            agent identity yourself by pasting the prompts in{" "}
            <code className="font-mono">prompts/PROMPTS.md</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
