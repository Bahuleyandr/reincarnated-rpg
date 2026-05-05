import type { Metadata } from "next";

export const metadata: Metadata = { title: "author a form" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
