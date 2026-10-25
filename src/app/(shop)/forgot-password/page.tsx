import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForms";
export const metadata: Metadata = { title: "Reset password", robots: { index: false } };
export default function Page() { return <div className="container-x py-12"><h1 className="text-3xl">Reset your password</h1><p className="mb-6 mt-2 text-graphite/80">Enter your email and we will send a link that works for one hour.</p><ForgotForm /></div>; }
