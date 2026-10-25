export function Policy({ title, updated = "1 January 2026", children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <article className="container-x max-w-3xl py-12">
      <h1 className="text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-1 text-sm text-graphite/70">Last updated {updated}</p>
      <div className="mt-6 space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_ul]:list-disc [&_ul]:pl-6">{children}</div>
      <p className="mt-10 rounded-sm bg-indigo-soft p-3 text-sm">This page is a starting template written for the demo store. Have it reviewed by a qualified professional and replace the placeholder business details before you launch.</p>
    </article>
  );
}
