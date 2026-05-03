"use client";

import Image from "next/image";
import Box from "@mui/material/Box";

export type HomeSpreadLogoProps = {
  /** Largura/altura do ícone em px (sidebar: 30 recolhido, 34 expandido) */
  size?: number;
};

/**
 * Marca HomeSpread — logo quadrada (fundo #0d9488, ícone casa + lupa).
 */
export function HomeSpreadLogo({ size = 32 }: HomeSpreadLogoProps) {
  const radius = Math.round(size * (96 / 512));
  return (
    <Box
      sx={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${radius}px`,
        overflow: "hidden",
        boxShadow:
          "0 1px 1px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(13, 148, 136, 0.22)",
      }}
    >
      <Image
        src="/homespread-logo.svg"
        alt="HomeSpread"
        width={size}
        height={size}
        sizes={`${size}px`}
        priority
        style={{
          width: size,
          height: size,
          display: "block",
        }}
      />
    </Box>
  );
}

export default HomeSpreadLogo;
