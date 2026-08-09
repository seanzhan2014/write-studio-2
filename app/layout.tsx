import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./globals.css";

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
    },
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
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><ColorSchemeScript defaultColorScheme="auto" /></head>
      <body>
        <MantineProvider
          defaultColorScheme="auto"
          theme={{
            colors: {
              studio: [
                "#faf8f5",
                "#f4eee7",
                "#e8dccc",
                "#d6c1a5",
                "#b99a73",
                "#95734d",
                "#755835",
                "#5f462a",
                "#49351f",
                "#322416",
              ],
            },
            primaryColor: "studio",
            primaryShade: { light: 6, dark: 5 },
            defaultRadius: "md",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          }}
        >
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
