-- Polígonos administrativos (GeoJSON WGS84) para mapa / futuras queries espaciais.
-- Origem típica: Nominatim (cidades) e Overpass/OSM (bairros).

ALTER TABLE cidades ADD COLUMN IF NOT EXISTS boundary_geojson jsonb;

ALTER TABLE bairros ADD COLUMN IF NOT EXISTS boundary_geojson jsonb;

COMMENT ON COLUMN cidades.boundary_geojson IS 'GeoJSON Polygon/MultiPolygon ou Feature (EPSG:4326). Fonte: Nominatim/OSM.';
COMMENT ON COLUMN bairros.boundary_geojson IS 'GeoJSON Polygon/MultiPolygon ou Feature (EPSG:4326). Fonte: Overpass/OSM.';
