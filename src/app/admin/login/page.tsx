import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { StaffLoginForm } from "@/components/AdminForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

export default async function AdminLogin() {
  if (await getStaff()) redirect("/admin");
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <p className="font-display text-2xl">THREAD <span className="text-stitch">&amp;</span> FORM <span className="text-base text-graphite/70">Operations</span></p>
      <StaffLoginForm />
    </main>
  );
}
