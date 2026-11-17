export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
