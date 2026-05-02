import { createTheme } from "@mui/material/styles";
import { design, rem } from "./designTokens";

export type AppColorMode = "light" | "dark";

const lightPalette = {
  mode: "light" as const,
  primary: { main: "#0d9488", dark: "#0f766e", light: "#14b8a6" },
  secondary: { main: "#64748b" },
  background: { default: "#fafafa", paper: "#ffffff" },
  text: { primary: "#0f172a", secondary: "#64748b" },
  divider: "rgba(15, 23, 42, 0.08)",
};

const darkPalette = {
  mode: "dark" as const,
  primary: { main: "#2dd4bf", dark: "#14b8a6", light: "#5eead4" },
  secondary: { main: "#94a3b8" },
  background: { default: "#121416", paper: "#1a1c1e" },
  text: { primary: "#e2e2e5", secondary: "#94a3b8" },
  divider: "rgba(255, 255, 255, 0.12)",
};

/**
 * O `createTheme` valida cores no SSR e não aceita `var(...)`.
 * Literais alinhados a `theme/colors.css` (:root vs html.dark).
 */
export function createAppTheme(mode: AppColorMode) {
  const palette = mode === "dark" ? darkPalette : lightPalette;

  return createTheme({
    cssVariables: true,
    palette,
    shape: { borderRadius: design.shape.radiusMd },
    typography: {
      fontFamily: design.font.family.sans,
      htmlFontSize: 16,
      caption: {
        fontSize: rem("sm"),
        fontWeight: 500,
        letterSpacing: "0.02em",
      },
      body2: { fontSize: rem("md"), lineHeight: 1.45 },
      body1: { fontSize: rem("base"), lineHeight: 1.5 },
      subtitle2: { fontSize: rem("md"), fontWeight: 600, lineHeight: 1.35 },
      subtitle1: { fontSize: rem("lg"), fontWeight: 600, lineHeight: 1.35 },
      h6: { fontSize: rem("lg"), fontWeight: 600 },
      button: { fontSize: rem("sm"), fontWeight: 600, textTransform: "none" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFamily: design.font.family.sans,
            fontSize: rem("base"),
            backgroundColor: palette.background.default,
            color: palette.text.primary,
          },
        },
      },
      MuiSwitch: {
        defaultProps: { size: "small" },
        styleOverrides: {
          track: {
            backgroundColor: "var(--rf-switch-track)",
            opacity: 1,
          },
        },
      },
      MuiFormControlLabel: {
        styleOverrides: {
          root: { marginLeft: 0, marginRight: 0 },
          label: { fontSize: rem("md") },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { fontSize: rem("md") },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { fontSize: rem("md") },
        },
      },
    },
  });
}
