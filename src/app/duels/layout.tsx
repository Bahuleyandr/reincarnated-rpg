import type { Metadata } from "next";

export const metadata: Metadata = { title: "duels" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
