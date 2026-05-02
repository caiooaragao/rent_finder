"use client";

import Box from "@mui/material/Box";

export type HomeSpreadLogoProps = {
  /** Largura/altura do ícone em px */
  size?: number;
};

/**
 * Marca HomeSpread — cor primária do tema; silhueta da casa via `--rf-logo-house-fill` (claro/escuro).
 */
export function HomeSpreadLogo({ size = 32 }: HomeSpreadLogoProps) {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      sx={{
        flexShrink: 0,
        display: "block",
        filter:
          "drop-shadow(0 1px 1px rgba(15, 23, 42, 0.06)) drop-shadow(0 2px 6px rgba(13, 116, 110, 0.22))",
      }}
    >
      <rect
        width={32}
        height={32}
        rx={9}
        fill="var(--rf-primary-main)"
      />
      {/* Contorno sutil para separar do fundo da sidebar */}
      <rect
        width={32}
        height={32}
        rx={9}
        fill="none"
        stroke="rgba(255, 255, 255, 0.22)"
        strokeWidth={0.75}
      />
      <path
        fill="var(--rf-logo-house-fill)"
        d="M16 8.5 23 14.2V24h-4.5v-5.8h-5V24H9V14.2L16 8.5z"
      />
    </Box>
  );
}

export default HomeSpreadLogo;
