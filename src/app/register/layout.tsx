import type { Metadata } from "next";

export const metadata: Metadata = { title: "register" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
