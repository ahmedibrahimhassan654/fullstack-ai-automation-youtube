import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg text-center">
        <CardHeader>
          <CardTitle>AI YouTube Automation & Educational Hub</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Transcribe, analyze, and publish educational videos with AI.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants())}>
              Sign in
            </Link>
            <Link href="/register" className={cn(buttonVariants({ variant: 'outline' }))}>
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
