"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import {
  ClearAllOutlined,
  MapOutlined,
  SatelliteAltOutlined,
} from "@mui/icons-material";
import { Map } from "@/Components/Map";
import {
  SearchBar,
  type SearchBarInputChangeReason,
} from "@/Components/SearchBar";
import { PriceRangeFilter } from "@/Components/PriceRangeFilter";
import { Sidebar } from "@/Components/Sidebar";
import {
  listingMatchesSearchQuery,
  type ListingPlacePin,
} from "@/lib/listingMatchesSearchQuery";
import { buildSearchSuggestions } from "@/lib/searchListingSuggestions";
import {
  buildBairroSearchOptions,
  buildCidadeSearchOptions,
} from "@/lib/placeSearchOptions";
import {
  isListingSearchOption,
  type SearchBarOption,
} from "@/lib/searchBarOption";
import {
  LISTING_SEARCH_SCOPE_LABELS,
  type ListingSearchScope,
} from "@/lib/listingSearchScope";
import type { SearchHoveredPlaceLocation } from "@/Components/Map/SearchHoveredBairroPolygon";
import {
  computeListingPriceBounds,
  effectivePriceFilter,
} from "@/lib/listingPriceRange";
import type { OlxListing } from "@/types/olx";
import type { MapBasemap } from "@/lib/mapBasemap";
import { MAP_BASEMAP_LABELS } from "@/lib/mapBasemap";

/** Alinhado a `Sidebar` (Drawer `paper` width) — se divergir, o mapa fica por baixo da barra. */
const EXPANDED_WIDTH = 286;
const COLLAPSED_WIDTH = 68;

const brlShort = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

interface HomeScreenProps {
  listings: OlxListing[];
}

const HomeScreen = ({ listings }: HomeScreenProps) => {
  const priceBounds = React.useMemo(
    () => computeListingPriceBounds(listings),
    [listings],
  );

  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [priceSlider, setPriceSlider] = React.useState<[number, number]>(
    () => [priceBounds.min, priceBounds.max],
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchScope, setSearchScope] =
    React.useState<ListingSearchScope>("tudo");
  const [placePin, setPlacePin] = React.useState<ListingPlacePin | null>(null);
  const [flyTo, setFlyTo] = React.useState<{
    stableId: string;
    token: number;
  } | null>(null);
  const [searchHoveredPlace, setSearchHoveredPlace] =
    React.useState<SearchHoveredPlaceLocation | null>(null);
  const [filtersClearedOpen, setFiltersClearedOpen] = React.useState(false);
  const [mapBasemap, setMapBasemap] = React.useState<MapBasemap>("streets");

  /**
   * Após escolher bairro/cidade no autocomplete, o MUI dispara `onInputChange` com
   * reason "input" ao preencher o campo — isso não deve limpar `placePin`.
   */
  const selectedPlaceQueryRef = React.useRef<string | null>(null);
  const suppressPlacePinClearUntilRef = React.useRef(0);

  const sidebarWidth = sidebarOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  const priceFilter = React.useMemo(
    () => effectivePriceFilter(priceSlider, priceBounds),
    [priceSlider, priceBounds],
  );

  const suggestions = React.useMemo((): SearchBarOption[] => {
    if (searchScope === "bairro") {
      return buildBairroSearchOptions(
        listings,
        searchQuery,
        24,
        priceFilter,
      );
    }
    if (searchScope === "cidade") {
      return buildCidadeSearchOptions(
        listings,
        searchQuery,
        24,
        priceFilter,
      );
    }
    return buildSearchSuggestions(
      listings,
      searchQuery,
      15,
      (listing) =>
        listingMatchesSearchQuery(
          listing,
          searchQuery,
          searchScope,
          placePin,
          priceFilter,
        ),
      searchScope,
    );
  }, [listings, searchQuery, searchScope, placePin, priceFilter]);

  const handleScopeChange = React.useCallback((s: ListingSearchScope) => {
    setSearchScope(s);
    setPlacePin(null);
  }, []);

  const handleSelectSuggestion = React.useCallback((o: SearchBarOption) => {
    setSearchHoveredPlace(null);
    if (isListingSearchOption(o)) {
      selectedPlaceQueryRef.current = null;
      setPlacePin(null);
      setFlyTo({ stableId: `olx-${o.index}`, token: Date.now() });
      setSearchQuery(o.secondaryLabel);
      return;
    }
    setFlyTo(null);
    const label = o.primaryLabel.trim();
    selectedPlaceQueryRef.current = label;
    /** Evita `input` com "" ou parcial antes do texto final do autocomplete. */
    suppressPlacePinClearUntilRef.current = Date.now() + 120;
    if (o.kind === "bairro") {
      setPlacePin({
        kind: "bairro",
        bairro: o.bairro,
        cidade: o.cidade,
        estado: o.estado,
      });
      setSearchQuery(o.primaryLabel);
      return;
    }
    setPlacePin({
      kind: "cidade",
      cidade: o.cidade,
      estado: o.estado,
    });
    setSearchQuery(o.primaryLabel);
  }, []);

  const handleSearchInputChangeReason = React.useCallback(
    (newInput: string, reason: SearchBarInputChangeReason) => {
      if (reason === "clear") {
        selectedPlaceQueryRef.current = null;
        setPlacePin(null);
        return;
      }
      if (reason !== "input") return;

      const ni = newInput.trim();
      const expected = selectedPlaceQueryRef.current;
      if (expected !== null && ni === expected) return;

      if (
        Date.now() < suppressPlacePinClearUntilRef.current &&
        (ni === "" || (expected !== null && expected.startsWith(ni)))
      ) {
        return;
      }

      if (expected !== null) selectedPlaceQueryRef.current = null;
      setPlacePin(null);
    },
    [],
  );

  const hasActiveFilters = React.useMemo(() => {
    if (searchQuery.trim() !== "") return true;
    if (searchScope !== "tudo") return true;
    if (placePin !== null) return true;
    if (priceFilter !== null) return true;
    return false;
  }, [searchQuery, searchScope, placePin, priceFilter]);

  const activeFilterSummary = React.useMemo(() => {
    if (!hasActiveFilters) return null;
    const parts: string[] = [];
    const q = searchQuery.trim();
    if (q) parts.push(`“${q}”`);
    if (searchScope !== "tudo")
      parts.push(LISTING_SEARCH_SCOPE_LABELS[searchScope]);
    if (placePin) {
      parts.push(
        placePin.kind === "bairro"
          ? placePin.bairro
          : placePin.cidade,
      );
    }
    if (priceFilter) {
      parts.push(
        `${brlShort.format(priceFilter.min)} – ${brlShort.format(priceFilter.max)}`,
      );
    }
    return parts.join(" · ");
  }, [
    hasActiveFilters,
    searchQuery,
    searchScope,
    placePin,
    priceFilter,
  ]);

  const handleClearFilters = React.useCallback(() => {
    selectedPlaceQueryRef.current = null;
    suppressPlacePinClearUntilRef.current = 0;
    setSearchQuery("");
    setSearchScope("tudo");
    setPlacePin(null);
    setFlyTo(null);
    setSearchHoveredPlace(null);
    setPriceSlider([priceBounds.min, priceBounds.max]);
    setFiltersClearedOpen(true);
  }, [priceBounds.min, priceBounds.max]);

  const handleSuggestionHover = React.useCallback(
    (o: SearchBarOption | null) => {
      if (!o) {
        setSearchHoveredPlace(null);
        return;
      }
      if (isListingSearchOption(o)) {
        const bairro = o.listing.bairro?.trim();
        const cidade = o.listing.cidade?.trim();
        if (!bairro || !cidade) {
          setSearchHoveredPlace(null);
          return;
        }
        setSearchHoveredPlace({
          kind: "bairro",
          bairro,
          cidade,
          estado: o.listing.estado?.trim() ?? null,
        });
        return;
      }
      if (o.kind === "bairro") {
        setSearchHoveredPlace({
          kind: "bairro",
          bairro: o.bairro,
          cidade: o.cidade,
          estado: o.estado,
        });
        return;
      }
      setSearchHoveredPlace({
        kind: "cidade",
        cidade: o.cidade,
        estado: o.estado,
      });
    },
    [],
  );

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-layout-canvas">
      <Sidebar open={sidebarOpen} onToggle={setSidebarOpen}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onInputChangeReason={handleSearchInputChangeReason}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
            onSuggestionHover={handleSuggestionHover}
            searchScope={searchScope}
            onSearchScopeChange={handleScopeChange}
          />
          <PriceRangeFilter
            bounds={priceBounds}
            value={priceSlider}
            onChange={setPriceSlider}
          />
          <Box sx={{ width: "100%", minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, display: "block", mb: 0.75 }}
            >
              Mapa base
            </Typography>
            <ToggleButtonGroup
              value={mapBasemap}
              exclusive
              fullWidth
              size="small"
              onChange={(_, v: MapBasemap | null) => {
                if (v != null) setMapBasemap(v);
              }}
              aria-label="Camada do mapa"
            >
              <ToggleButton
                value="streets"
                aria-label={MAP_BASEMAP_LABELS.streets}
                sx={{
                  textTransform: "none",
                  py: 0.75,
                  gap: 0.75,
                }}
              >
                <MapOutlined sx={{ fontSize: "1.125rem" }} />
                {MAP_BASEMAP_LABELS.streets}
              </ToggleButton>
              <ToggleButton
                value="satellite"
                aria-label={MAP_BASEMAP_LABELS.satellite}
                sx={{
                  textTransform: "none",
                  py: 0.75,
                  gap: 0.75,
                }}
              >
                <SatelliteAltOutlined sx={{ fontSize: "1.125rem" }} />
                {MAP_BASEMAP_LABELS.satellite}
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {activeFilterSummary ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                lineHeight: 1.45,
                wordBreak: "break-word",
              }}
            >
              <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
                A filtrar:{" "}
              </Box>
              {activeFilterSummary}
            </Typography>
          ) : null}
          <Button
            type="button"
            variant="outlined"
            size="small"
            fullWidth
            startIcon={<ClearAllOutlined fontSize="small" />}
            disabled={!hasActiveFilters}
            onClick={handleClearFilters}
            aria-label="Limpar filtros"
            sx={{ textTransform: "none" }}
          >
            Limpar filtros
          </Button>
        </Box>
      </Sidebar>

      <main
        className="flex min-h-0 min-w-0 flex-1 flex-col transition-[margin-left] duration-[260ms] ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        <div id="mapa" className="min-h-0 h-full w-full flex-1 scroll-mt-0">
          <Map
            height="100%"
            className="h-full min-h-0"
            listings={listings}
            searchPlacePin={placePin}
            flyTo={flyTo}
            searchHoveredBairro={searchHoveredPlace}
            priceRange={priceFilter}
            basemap={mapBasemap}
          />
        </div>
      </main>

      <Snackbar
        open={filtersClearedOpen}
        autoHideDuration={3200}
        onClose={(_, reason) => {
          if (reason === "clickaway") return;
          setFiltersClearedOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setFiltersClearedOpen(false)}
          severity="success"
          variant="filled"
          sx={{ width: "100%" }}
        >
          Filtros limpos
        </Alert>
      </Snackbar>
    </div>
  );
};

export default HomeScreen;
