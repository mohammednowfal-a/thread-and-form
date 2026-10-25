"use client";
import { useState } from "react";

const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 720"><rect width="600" height="720" fill="#E9E9E4"/><text x="300" y="365" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#2B2D33">Image unavailable</text></svg>');

/** <img> that degrades gracefully when a (possibly external) image fails to load. */
export function SafeImg({ src, alt, className, priority }: { src: string | null; alt: string; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState(!src);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={failed ? FALLBACK : (src as string)} alt={alt} width={600} height={720} loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} className={className} />;
}
