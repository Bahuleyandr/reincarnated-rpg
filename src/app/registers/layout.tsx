import type { Metadata } from "next";

export const metadata: Metadata = { title: "the registers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
