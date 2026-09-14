"use client";

import { MantineProvider, type MantineColorsTuple, type CSSVariablesResolver, type MantineThemeOverride } from "@mantine/core";
import { useMemo, type ReactNode } from "react";
import { appearanceColors, fontFamily, mixColor } from "@/lib/appearance.mjs";
import { useStudio } from "../studio-state";

export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const { data: { settings } } = useStudio();
  const { accentColor, uiFont, editorFont } = settings;
  const theme = useMemo<MantineThemeOverride>(() => ({
    colors: { studio: [
      ...[0.94, 0.86, 0.72, 0.54, 0.32].map((amount) => mixColor(accentColor, "#ffffff", amount)),
      mixColor(accentColor, "#ffffff", 0.12),
      appearanceColors(accentColor, false)["--accent"],
      ...[0.15, 0.3, 0.5].map((amount) => mixColor(accentColor, "#000000", amount)),
    ] as unknown as MantineColorsTuple },
    primaryColor: "studio", primaryShade: { light: 6, dark: 5 }, autoContrast: true,
    defaultRadius: "md", fontFamily: fontFamily(uiFont), headings: { fontFamily: fontFamily(uiFont) },
  }), [accentColor, uiFont]);
  const resolver = useMemo<CSSVariablesResolver>(() => () => ({
    variables: { "--font-interface": fontFamily(uiFont), "--font-editor": fontFamily(editorFont) },
    light: appearanceColors(accentColor, false),
    dark: appearanceColors(accentColor, true),
  }), [accentColor, uiFont, editorFont]);
  return <MantineProvider defaultColorScheme="auto" theme={theme} cssVariablesResolver={resolver}>{children}</MantineProvider>;
}
