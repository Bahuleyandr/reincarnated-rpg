import type { Metadata } from "next";

export const metadata: Metadata = { title: "log in" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
