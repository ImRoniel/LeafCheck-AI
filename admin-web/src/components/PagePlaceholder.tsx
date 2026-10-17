interface PagePlaceholderProps {
  title: string
  description: string
  audience?: string
}

export function PagePlaceholder({ title, description, audience }: PagePlaceholderProps) {
  return (
    <section aria-labelledby="page-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="page-heading" className="text-2xl font-semibold tracking-tight">{title}</h1>
        {audience && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
            {audience}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <p className="font-medium text-slate-700">Coming soon</p>
        <p className="mt-2 text-sm text-slate-500">This section is ready for the next phase.</p>
      </div>
    </section>
  )
}
