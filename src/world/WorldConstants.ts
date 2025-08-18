/**
 * World System Configuration Constants
 *
 * Defines all configuration parameters for the terrain generation and world management system.
 * Tuned for optimal performance at 60+ FPS while maintaining high visual fidelity for flight simulation.
 */

// Earth dimensions and scaling
export const EARTH_CONSTANTS = {
    /** Approximate Earth radius in meters */
    RADIUS: 6371000,

    /** Earth circumference in meters */
    CIRCUMFERENCE: 40075000,

    /** Maximum elevation on Earth (Mount Everest) in meters */
    MAX_ELEVATION: 8848,

    /** Minimum ocean depth in meters (negative value) */
    MIN_ELEVATION: -11034,

    /** Degrees to meters conversion factor at equator */
    DEGREES_TO_METERS: 111320,

    /** WGS84 ellipsoid semi-major axis */
    WGS84_A: 6378137.0,

    /** WGS84 ellipsoid flattening */
    WGS84_F: 1.0 / 298.257223563,
} as const;

// Terrain tile configuration
export const TERRAIN_CONFIG = {
    /** Base tile size in world units (meters) */
    BASE_TILE_SIZE: 8192, // 8km base tiles for flight simulator scale

    /** Number of height samples per tile edge */
    HEIGHT_RESOLUTION: 257, // Power of 2 + 1 for seamless LOD

    /** Number of texture samples per tile edge */
    TEXTURE_RESOLUTION: 1024,

    /** Maximum quadtree depth levels */
    MAX_LOD_LEVELS: 12,

    /** Minimum tile size in world units */
    MIN_TILE_SIZE: 16, // BASE_TILE_SIZE / (2^MAX_LOD_LEVELS)

    /** Vertices per tile edge for mesh generation */
    MESH_RESOLUTION: 65, // Power of 2 + 1 for efficient GPU processing

    /** Maximum elevation difference for LOD transitions (meters) */
    MAX_ELEVATION_DELTA: 100,

    /** Tile border overlap for seamless transitions */
    TILE_OVERLAP: 1,
} as const;

// Level of Detail thresholds
export const LOD_CONFIG = {
    /** Distance thresholds for terrain LOD levels (meters) */
    TERRAIN_DISTANCES: [
        0, // Level 0: Highest detail
        2000, // Level 1: High detail (2km)
        5000, // Level 2: Medium-high detail (5km)
        10000, // Level 3: Medium detail (10km)
        20000, // Level 4: Low-medium detail (20km)
        40000, // Level 5: Low detail (40km)
        80000, // Level 6+: Lowest detail (80km)
    ],

    /** Texture resolution per LOD level */
    TEXTURE_SIZES: [2048, 1024, 512, 256, 128, 64, 32],

    /** Mesh complexity per LOD level */
    MESH_SUBDIVISIONS: [4, 4, 3, 3, 2, 1, 0], // Powers of 2 - reduced for debugging

    /** Distance-based culling threshold */
    CULL_DISTANCE: 2000000, // 2000 km

    /** Frustum culling margin */
    FRUSTUM_MARGIN: 1.2,
} as const;

// Performance and memory configuration
export const PERFORMANCE_CONFIG = {
    /** Maximum number of terrain tiles in memory */
    MAX_TILES_IN_MEMORY: 1024,

    /** Maximum number of tiles to load per frame */
    TILES_PER_FRAME: 4,

    /** Maximum number of tiles to generate per frame */
    TILES_GENERATION_PER_FRAME: 2,

    /** Memory budget for terrain data (bytes) */
    TERRAIN_MEMORY_BUDGET: 512 * 1024 * 1024, // 512 MB

    /** Texture memory budget (bytes) */
    TEXTURE_MEMORY_BUDGET: 768 * 1024 * 1024, // 768 MB

    /** Worker thread count for terrain generation */
    WORKER_THREAD_COUNT: 4,

    /** Target frame time budget for terrain updates (ms) */
    TERRAIN_FRAME_BUDGET: 2.0,

    /** Maximum distance for predictive loading */
    PRELOAD_DISTANCE: 50000, // 50 km

    /** Tile cache eviction threshold */
    CACHE_EVICTION_RATIO: 0.8,
} as const;

// Noise generation parameters
export const NOISE_CONFIG = {
    /** Primary terrain noise octaves */
    TERRAIN_OCTAVES: [
        { frequency: 0.00005, amplitude: 300, type: 'fbm' }, // Continental features - much lower frequency
        { frequency: 0.0002, amplitude: 150, type: 'fbm' }, // Mountain ranges
        { frequency: 0.0008, amplitude: 50, type: 'fbm' }, // Hills and valleys
        { frequency: 0.0032, amplitude: 20, type: 'fbm' }, // Local features
        { frequency: 0.0128, amplitude: 5, type: 'fbm' }, // Fine detail
        { frequency: 0.0512, amplitude: 1, type: 'fbm' }, // Surface roughness
    ],

    /** Erosion simulation parameters */
    EROSION: {
        iterations: 0, // Disable erosion for now to avoid potential NaN issues
        dropletLifetime: 30,
        inertia: 0.05,
        sedimentCapacityFactor: 4,
        minSedimentCapacity: 0.01,
        erodeSpeed: 0.3,
        depositSpeed: 0.3,
        evaporateSpeed: 0.01,
        gravity: 4,
        maxDropletSpeed: 10,
        brushRadius: 3,
    },

    /** Temperature and precipitation noise */
    CLIMATE_OCTAVES: [
        { frequency: 0.001, amplitude: 30 }, // Large climate zones
        { frequency: 0.004, amplitude: 10 }, // Regional variations
        { frequency: 0.016, amplitude: 3 }, // Local variations
    ],
} as const;

// Material and biome configuration
export const BIOME_CONFIG = {
    /** Biome types and their properties */
    BIOMES: {
        OCEAN: { id: 0, name: 'Ocean', color: [0, 0.4, 0.8] },
        BEACH: { id: 1, name: 'Beach', color: [0.9, 0.8, 0.6] },
        GRASSLAND: { id: 2, name: 'Grassland', color: [0.4, 0.7, 0.2] },
        FOREST: { id: 3, name: 'Forest', color: [0.2, 0.5, 0.1] },
        DESERT: { id: 4, name: 'Desert', color: [0.9, 0.7, 0.4] },
        MOUNTAIN: { id: 5, name: 'Mountain', color: [0.6, 0.6, 0.6] },
        SNOW: { id: 6, name: 'Snow', color: [0.95, 0.95, 0.95] },
        TUNDRA: { id: 7, name: 'Tundra', color: [0.5, 0.6, 0.5] },
        WETLAND: { id: 8, name: 'Wetland', color: [0.3, 0.5, 0.3] },
        URBAN: { id: 9, name: 'Urban', color: [0.7, 0.7, 0.7] },
    },

    /** Elevation thresholds for biome classification */
    ELEVATION_THRESHOLDS: {
        OCEAN: -1,
        BEACH: 5,
        GRASSLAND: 100,
        FOREST: 500,
        MOUNTAIN: 2000,
        SNOW: 3500,
    },

    /** Temperature thresholds (Celsius) */
    TEMPERATURE_THRESHOLDS: {
        FROZEN: -15,
        COLD: 5,
        TEMPERATE: 25,
        HOT: 35,
    },

    /** Precipitation thresholds (mm/year) */
    PRECIPITATION_THRESHOLDS: {
        ARID: 200,
        SEMI_ARID: 600,
        HUMID: 1200,
        WET: 2000,
    },
} as const;

// Water system configuration
export const WATER_CONFIG = {
    /** Ocean level in meters */
    SEA_LEVEL: 0,

    /** Wave simulation parameters */
    WAVES: {
        amplitude: 2.0,
        frequency: 0.1,
        speed: 1.0,
        direction: [1, 0, 1], // Normalized wave direction
        choppy: 0.8,
        windSpeed: 15.0, // m/s
    },

    /** Water rendering parameters */
    RENDERING: {
        transparency: 0.8,
        refractionIndex: 1.33,
        foamThreshold: 0.6,
        foamColor: [1, 1, 1],
        deepWaterColor: [0.0, 0.2, 0.4],
        shallowWaterColor: [0.2, 0.6, 0.8],
    },

    /** Shore detection parameters */
    SHORE: {
        detectionRadius: 100, // meters
        foamWidth: 10, // meters
        waveHeight: 1.5, // meters
    },
} as const;

// Scenery and object placement
export const SCENERY_CONFIG = {
    /** Maximum objects per tile */
    MAX_OBJECTS_PER_TILE: 10000,

    /** Object density by type (objects per km²) */
    OBJECT_DENSITY: {
        TREES: 2000,
        ROCKS: 50,
        BUILDINGS: 10,
        ROADS: 5,
    },

    /** Object LOD distances */
    OBJECT_LOD_DISTANCES: [
        0, // Full detail
        100, // Medium detail
        500, // Low detail
        2000, // Billboard only
        10000, // Culled
    ],

    /** Instancing thresholds */
    INSTANCING_THRESHOLDS: {
        MIN_INSTANCES: 10,
        MAX_INSTANCES_PER_BATCH: 1000,
    },
} as const;

// Streaming and caching
export const STREAMING_CONFIG = {
    /** Tile request priorities */
    PRIORITY_LEVELS: {
        IMMEDIATE: 0, // Player's current tile
        HIGH: 1, // Visible tiles
        MEDIUM: 2, // Predictive loading
        LOW: 3, // Background loading
        IDLE: 4, // Cache warming
    },

    /** Network request configuration */
    REQUEST_CONFIG: {
        timeout: 30000, // 30 seconds
        retryAttempts: 3,
        retryDelay: 1000, // 1 second
        maxConcurrentRequests: 8,
    },

    /** Cache configuration */
    CACHE_CONFIG: {
        maxAge: 3600000, // 1 hour in milliseconds
        maxSize: 1000, // Number of tiles
        compressionLevel: 6,
    },
} as const;

// Debug and development
export const DEBUG_CONFIG = {
    /** Enable wireframe rendering */
    WIREFRAME_MODE: false,

    /** Show tile boundaries */
    SHOW_TILE_BOUNDS: false,

    /** Show LOD levels with colors */
    SHOW_LOD_COLORS: false,

    /** Enable performance profiling */
    ENABLE_PROFILING: true,

    /** Log verbose tile operations */
    VERBOSE_LOGGING: false,

    /** Freeze terrain updates */
    FREEZE_UPDATES: false,
} as const;

// Coordinate system utilities
export const COORDINATE_SYSTEM = {
    /** Convert geographic coordinates to world space */
    GEO_TO_WORLD_SCALE: 1.0, // 1:1 mapping for now

    /** World origin offset (for floating point precision) */
    WORLD_ORIGIN: { x: 0, y: 0, z: 0 },

    /** Tile coordinate system base */
    TILE_COORD_BASE: 2, // Binary subdivision
} as const;

/**
 * Calculate tile size for a given LOD level
 */
export function getTileSizeForLOD(level: number): number {
    return TERRAIN_CONFIG.BASE_TILE_SIZE / Math.pow(2, level);
}

/**
 * Calculate mesh resolution for a given LOD level
 */
export function getMeshResolutionForLOD(level: number): number {
    const subdivisions =
        LOD_CONFIG.MESH_SUBDIVISIONS[Math.min(level, LOD_CONFIG.MESH_SUBDIVISIONS.length - 1)];
    return Math.pow(2, subdivisions) + 1;
}

/**
 * Get texture resolution for LOD level
 */
export function getTextureResolutionForLOD(level: number): number {
    return LOD_CONFIG.TEXTURE_SIZES[Math.min(level, LOD_CONFIG.TEXTURE_SIZES.length - 1)];
}

/**
 * Convert world coordinates to tile coordinates
 */
export function worldToTileCoord(x: number, z: number, level: number): { tx: number; tz: number } {
    // Validate inputs
    if (!isFinite(x) || !isFinite(z) || !isFinite(level)) {
        console.error('Invalid worldToTileCoord inputs:', { x, z, level });
        return { tx: 0, tz: 0 };
    }

    const tileSize = getTileSizeForLOD(level);

    // Validate tile size
    if (!isFinite(tileSize) || tileSize <= 0) {
        console.error('Invalid tile size for level', level, ':', tileSize);
        return { tx: 0, tz: 0 };
    }

    const tx = Math.floor(x / tileSize);
    const tz = Math.floor(z / tileSize);

    // Validate outputs
    if (!isFinite(tx) || !isFinite(tz)) {
        console.error('Invalid tile coordinates calculated:', { tx, tz });
        return { tx: 0, tz: 0 };
    }

    return { tx, tz };
}

/**
 * Convert tile coordinates to world coordinates (tile center)
 */
export function tileCoordToWorld(tx: number, tz: number, level: number): { x: number; z: number } {
    const tileSize = getTileSizeForLOD(level);
    return {
        x: (tx + 0.5) * tileSize,
        z: (tz + 0.5) * tileSize,
    };
}
