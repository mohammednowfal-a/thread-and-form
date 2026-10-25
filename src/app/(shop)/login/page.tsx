import type { Metadata } from "next";
import { LoginForm } from "@/components/AuthForms";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return <div className="container-x py-12"><h1 className="text-3xl">Sign in</h1>{reset && <p role="status" className="mt-2 text-moss">Password updated. Please sign in.</p>}<div className="mt-6"><LoginForm /></div></div>;
}
