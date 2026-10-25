import type { Metadata } from "next";
import { TrackForm } from "@/components/TrackForm";

export const metadata: Metadata = { title: "Track your order", robots: { index: false } };

export default function Track() {
  return <div className="container-x py-12"><h1 className="text-3xl">Track your order</h1><p className="mt-2 mb-6 max-w-prose text-graphite/80">Enter the order reference from your confirmation and the mobile number you ordered with.</p><TrackForm /></div>;
}
