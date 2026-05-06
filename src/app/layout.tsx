import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Reincarnated in Another World as…",
    template: "%s · Reincarnated",
  },
  description:
    "A persistent text RPG where every reincarnation form — slime, cursed book, dungeon core — plays as a fundamentally different game. The world remembers what you did.",
};

// Mobile UX (POLISH_PLAN Day 67). Tells iOS/Safari + Android Chrome
// to render at device-native width with the user-visible viewport
// matching the layout's grid breakpoints. Without this, mobile
// browsers default to a 980-px-wide assumed viewport and the page
// renders "zoomed out". Safari home-screen-PWA mode also needs
// `viewport-fit=cover` for the safe-area-inset to apply.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // allow user pinch-zoom (a11y)
  viewportFit: "cover",
  themeColor: "#0c0a09", // matches stone-950 / our base bg
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
