const Skeleton = ({ className = '' }) => <div aria-hidden="true" className={`app-skeleton ${className}`} />;

export function ListSkeleton({ rows = 6, compact = false }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="status" aria-live="polite">
      <span className="sr-only">Veriler yükleniyor</span>
      <div className="hidden h-14 items-center gap-8 border-b border-slate-100 bg-slate-50/70 px-5 md:flex">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-3 w-44 rounded" />
        <Skeleton className="ml-auto h-3 w-28 rounded" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`flex items-center gap-3 px-4 ${compact ? 'h-16' : 'h-[76px]'} md:px-5`}>
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={`h-3.5 rounded ${index % 2 ? 'w-36' : 'w-48'} max-w-full`} />
              <Skeleton className="h-2.5 w-28 max-w-full rounded" />
            </div>
            <Skeleton className="hidden h-7 w-20 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-slate-50" role="status" aria-live="polite">
      <span className="sr-only">Sistem verileri yükleniyor</span>
      <aside className="hidden w-64 shrink-0 bg-[#0066b1] p-4 md:block">
        <Skeleton className="app-skeleton-on-dark h-20 w-full rounded-xl" />
        <Skeleton className="app-skeleton-on-dark mt-6 h-16 w-full rounded-xl" />
        <div className="mt-8 space-y-3">
          <Skeleton className="app-skeleton-on-dark h-11 w-full rounded-lg" />
          <Skeleton className="app-skeleton-on-dark h-11 w-full rounded-lg" />
          <Skeleton className="app-skeleton-on-dark h-11 w-full rounded-lg" />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="flex h-[70px] items-center gap-3 bg-[#0066b1] px-4 md:hidden">
          <Skeleton className="app-skeleton-on-dark h-10 w-14 rounded-xl" />
          <Skeleton className="app-skeleton-on-dark ml-auto h-9 w-9 rounded-full" />
          <Skeleton className="app-skeleton-on-dark h-9 w-9 rounded-lg" />
        </div>
        <div className="mx-auto w-full max-w-[1400px] space-y-4 p-3 md:p-8">
          <div className="flex gap-2">
            <Skeleton className="h-11 flex-1 rounded-xl" />
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="hidden h-11 w-36 rounded-xl sm:block" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
          <ListSkeleton rows={7} />
        </div>
      </main>
    </div>
  );
}
