"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import type { LeafletMapInnerProps } from "./LeafletMapInner";

const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), {
  ssr: false,
  loading: () => (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minHeight: 320,
        borderRadius: 0,
        bgcolor: "action.hover",
      }}
    >
      <CircularProgress size={32} />
    </Box>
  ),
});

export type MapProps = LeafletMapInnerProps;
export type { MapBasemap } from "@/lib/mapBasemap";

/**
 * Mapa Leaflet + OpenStreetMap. Carregado só no cliente (`dynamic` + `ssr: false`)
 * para funcionar com o App Router do Next.js.
 */
export function Map(props: MapProps) {
  return <LeafletMapInner {...props} />;
}

export default Map;
