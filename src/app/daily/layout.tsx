import type { Metadata } from "next";

export const metadata: Metadata = { title: "today's daily" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
