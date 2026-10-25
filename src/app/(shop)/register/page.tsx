import type { Metadata } from "next";
import { RegisterForm } from "@/components/AuthForms";
export const metadata: Metadata = { title: "Create account", robots: { index: false } };
export default function Page() { return <div className="container-x py-12"><h1 className="text-3xl">Create your account</h1><div className="mt-6"><RegisterForm /></div></div>; }
