import type { Metadata } from "next";
import { ResetForm } from "@/components/AuthForms";
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <div className="container-x py-12"><p>This link is missing its token. Request a new reset link.</p></div>;
  return <div className="container-x py-12"><h1 className="mb-6 text-3xl">Choose a new password</h1><ResetForm token={token} /></div>;
}
