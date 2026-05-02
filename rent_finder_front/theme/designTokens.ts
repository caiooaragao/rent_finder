/**
 * Design system — valores centrais. Cores: `theme/colors.css`. Tipografia: `scale` / `sizeRem`.
 */
export const design = {
  font: {
    /** Multiplicador global (ex.: 1.1 aumenta ~10% todos os tamanhos) */
    scale: 1,
    family: {
      sans: 'var(--font-geist-sans), system-ui, -apple-system, sans-serif',
      mono: 'var(--font-geist-mono), ui-monospace, monospace',
    },
    /**
     * Escala em rem (antes de `scale`). Chaves semânticas para mapear ao MUI.
     */
    sizeRem: {
      xs: 0.6875, // 11px @ 16px root
      sm: 0.75, // 12px — caption / labels compactos
      md: 0.875, // 14px — body2, inputs
      base: 1, // 16px — body1
      lg: 1.125, // 18px — subtítulos
      xl: 1.25, // 20px
    },
  },
  shape: {
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
  },
  elevation: {
    /** Sincronizado com --rf-shadow-dropdown em theme/colors.css */
    searchPaper: "var(--rf-shadow-dropdown)",
  },
} as const;

export type FontSizeToken = keyof typeof design.font.sizeRem;

/** Tamanho em rem com `scale` aplicado (para MUI `fontSize` / `sx`). */
export function rem(token: FontSizeToken): string {
  const v = design.font.sizeRem[token] * design.font.scale;
  return `${v}rem`;
}

/** Injeta --rf-font-* no elemento raiz para CSS legado (Leaflet, etc.). */
export function getRootFontCssVars(): Record<string, string> {
  const { sizeRem, scale } = design.font;
  const s = (n: number) => `${n * scale}rem`;
  return {
    "--rf-font-xs": s(sizeRem.xs),
    "--rf-font-sm": s(sizeRem.sm),
    "--rf-font-md": s(sizeRem.md),
    "--rf-font-base": s(sizeRem.base),
    "--rf-font-lg": s(sizeRem.lg),
    "--rf-font-xl": s(sizeRem.xl),
    "--rf-font-scale": String(scale),
  };
}
