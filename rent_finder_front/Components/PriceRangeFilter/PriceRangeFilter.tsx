"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ListingPriceBounds } from "@/lib/listingPriceRange";
import { parsePrecoToNumber } from "@/lib/parseListingPreco";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export type PriceRangeFilterProps = {
  bounds: ListingPriceBounds;
  value: [number, number];
  onChange: (next: [number, number]) => void;
};

function digitsOnlyToInt(s: string): number | null {
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : null;
}

/** Aceita só dígitos ou texto tipo "R$ 1.500" / "1500" */
function parsePriceInput(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/r\$/i.test(t) || /,/.test(t) || /\d+\.\d{3}/.test(t)) {
    return parsePrecoToNumber(t);
  }
  return digitsOnlyToInt(t);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function PriceRangeFilter({
  bounds,
  value,
  onChange,
}: PriceRangeFilterProps) {
  const lo = Math.min(value[0], value[1]);
  const hi = Math.max(value[0], value[1]);

  const [minDraft, setMinDraft] = React.useState<string | null>(null);
  const [maxDraft, setMaxDraft] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMinDraft(null);
    setMaxDraft(null);
  }, [value[0], value[1]]);

  /** Passos maiores = menos ganho por pixel ao arrastar o slider (drag menos “nervoso”). */
  const step = React.useMemo(() => {
    const span = Math.max(bounds.max - bounds.min, 1);
    const rough = Math.pow(10, Math.floor(Math.log10(span)) - 1);
    const fine = Math.round(rough / 10) * 10 || 100;
    const base = Math.max(50, Math.min(2000, fine));
    const coarser = Math.round((base * 2.25) / 50) * 50;
    const cappedBySpan = Math.max(span / 6, 1);
    return Math.min(cappedBySpan, Math.max(100, coarser));
  }, [bounds.min, bounds.max]);

  const commitMin = React.useCallback(() => {
    const raw = minDraft;
    setMinDraft(null);
    if (raw === null) return;
    const parsed = parsePriceInput(raw);
    if (parsed === null) return;
    const nextLo = clamp(parsed, bounds.min, Math.min(bounds.max, hi));
    onChange([nextLo, Math.max(nextLo, hi)]);
  }, [minDraft, bounds.min, bounds.max, hi, onChange]);

  const commitMax = React.useCallback(() => {
    const raw = maxDraft;
    setMaxDraft(null);
    if (raw === null) return;
    const parsed = parsePriceInput(raw);
    if (parsed === null) return;
    const nextHi = clamp(parsed, Math.max(bounds.min, lo), bounds.max);
    onChange([Math.min(lo, nextHi), nextHi]);
  }, [maxDraft, bounds.min, bounds.max, lo, onChange]);

  const minShown = minDraft !== null ? minDraft : String(lo);
  const maxShown = maxDraft !== null ? maxDraft : String(hi);

  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, display: "block", mb: 0.75 }}
      >
        Faixa de preço
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1,
          mb: 1.25,
        }}
      >
        <TextField
          size="small"
          label="Mínimo"
          value={minShown}
          onChange={(e) => setMinDraft(e.target.value)}
          onFocus={() => setMinDraft(String(lo))}
          onBlur={commitMin}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">R$</InputAdornment>
              ),
            },
          }}
        />
        <TextField
          size="small"
          label="Máximo"
          value={maxShown}
          onChange={(e) => setMaxDraft(e.target.value)}
          onFocus={() => setMaxDraft(String(hi))}
          onBlur={commitMax}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">R$</InputAdornment>
              ),
            },
          }}
        />
      </Box>

      <Slider
        size="small"
        value={value}
        onChange={(_, v) => onChange(v as [number, number])}
        valueLabelDisplay="auto"
        min={bounds.min}
        max={bounds.max}
        step={step}
        disableSwap
        valueLabelFormat={(n) => brl.format(n)}
        getAriaLabel={(i) => (i === 0 ? "Preço mínimo" : "Preço máximo")}
        sx={(theme) => ({
          cursor: "pointer",
          "& .MuiSlider-thumb": { cursor: "pointer" },
          "& .MuiSlider-track": { cursor: "pointer" },
          "& .MuiSlider-rail": { cursor: "pointer" },
          "&:hover .MuiSlider-thumb": {
            boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.22)}`,
          },
          "&:hover .MuiSlider-track": {
            opacity: 0.92,
          },
        })}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.5, lineHeight: 1.35 }}
      >
        {brl.format(lo)} — {brl.format(hi)}
      </Typography>
    </Box>
  );
}

export default PriceRangeFilter;
