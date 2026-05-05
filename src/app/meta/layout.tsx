import type { Metadata } from "next";

export const metadata: Metadata = { title: "the long wyrm" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
