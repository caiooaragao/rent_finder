"use client";

import * as React from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme, type AppColorMode } from "@/theme/muiTheme";
import { getRootFontCssVars } from "@/theme/designTokens";

function resolveMuiMode(resolvedTheme: string | undefined): AppColorMode {
  return resolvedTheme === "dark" ? "dark" : "light";
}

/** Migra `localStorage` antigo com valor `system` para o tema por defeito (claro). */
function ThemeStorageMigration() {
  const { theme, setTheme } = useNextTheme();
  React.useEffect(() => {
    if (theme === "system") setTheme("light");
  }, [theme, setTheme]);
  return null;
}

function MuiThemeBridge({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useNextTheme();
  /** Até montar, alinhamos ao `defaultTheme` (claro); depois segue `resolvedTheme` / localStorage. */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const mode = React.useMemo<AppColorMode>(() => {
    if (!mounted) return "light";
    return resolveMuiMode(resolvedTheme);
  }, [mounted, resolvedTheme]);

  const muiTheme = React.useMemo(() => createAppTheme(mode), [mode]);

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = getRootFontCssVars();
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    return () => {
      for (const key of Object.keys(vars)) {
        root.style.removeProperty(key);
      }
    };
  }, []);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export default function AppThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRouterCacheProvider>
      <NextThemesProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        storageKey="rent-finder-theme"
      >
        <ThemeStorageMigration />
        <MuiThemeBridge>{children}</MuiThemeBridge>
      </NextThemesProvider>
    </AppRouterCacheProvider>
  );
}
