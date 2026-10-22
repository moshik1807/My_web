-- Vision Window: spatial schema (PostgreSQL + PostGIS), per the MVP specification section 4.
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Spatial locations
CREATE TABLE IF NOT EXISTS spatial_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    coordinates GEOMETRY(Point, 4326) NOT NULL, -- WGS84 GPS point
    bounding_box GEOMETRY(Polygon, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_spatial_locations_coords ON spatial_locations USING GIST (coordinates);

-- 2. Historical 3D assets
CREATE TABLE IF NOT EXISTS historical_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES spatial_locations(id) ON DELETE CASCADE,
    year_start INT NOT NULL,
    year_end INT NOT NULL,
    asset_type VARCHAR(50) NOT NULL, -- 'building', 'vehicle', 'npc', 'terrain'
    model_url TEXT NOT NULL,         -- path to Draco-compressed GLTF/GLB, or procedural:// for generated geometry
    lod_level INT DEFAULT 0,         -- 0: high detail, 1: medium, 2: low
    metadata JSONB,                  -- scale, rotation_offset, texture_maps, generator parameters
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_historical_assets_location_years ON historical_assets (location_id, year_start, year_end);

-- 3. Entity movement paths
CREATE TABLE IF NOT EXISTS entity_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES spatial_locations(id) ON DELETE CASCADE,
    era_year INT NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'carriage', 'vintage_car', 'pedestrian', ...
    path_geometry GEOMETRY(LineString, 4326) NOT NULL, -- path waypoints
    speed_mps DECIMAL(4,2) DEFAULT 1.50, -- movement speed in meters per second
    spawn_interval_sec INT DEFAULT 10
);
CREATE INDEX IF NOT EXISTS idx_entity_paths_geometry ON entity_paths USING GIST (path_geometry);
