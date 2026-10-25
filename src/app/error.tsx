"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="container-x py-24 text-center"><h1 className="text-4xl">Something went wrong on our side</h1><p className="mt-3 text-graphite/75">Your cart and orders are safe. Please try again.</p><button className="btn-primary mt-6" onClick={reset}>Try again</button></main>;
}
