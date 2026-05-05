import type { Metadata } from "next";

export const metadata: Metadata = { title: "letters" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
