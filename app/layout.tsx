import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ColorSchemeScript } from "@mantine/core";
import "@mantine/core/styles.css";
import "./globals.css";
import "./ui/studio/workspace-chrome.css";
import OfflineBootstrap from "./offline-bootstrap";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Writer Studio · 结构化长篇写作";
  const description = "为长篇文章与故事创作者设计的结构化写作工作台。";

  return {
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/favicon.svg",
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Writer Studio", statusBarStyle: "default" },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Writer Studio 结构化写作工作台" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><ColorSchemeScript defaultColorScheme="auto" /></head>
      <body>
        <OfflineBootstrap />
        {children}
      </body>
    </html>
  );
}
