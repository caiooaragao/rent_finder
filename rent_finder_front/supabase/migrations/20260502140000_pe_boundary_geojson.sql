-- Ver rent_finder_scraper/migrations/20260502140000_pe_boundary_geojson.sql (mesmo conteúdo).

ALTER TABLE cidades ADD COLUMN IF NOT EXISTS boundary_geojson jsonb;

ALTER TABLE bairros ADD COLUMN IF NOT EXISTS boundary_geojson jsonb;

COMMENT ON COLUMN cidades.boundary_geojson IS 'GeoJSON Polygon/MultiPolygon ou Feature (EPSG:4326). Fonte: Nominatim/OSM.';
COMMENT ON COLUMN bairros.boundary_geojson IS 'GeoJSON Polygon/MultiPolygon ou Feature (EPSG:4326). Fonte: Overpass/OSM.';
