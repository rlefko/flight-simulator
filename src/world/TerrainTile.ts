import { Vector3 } from '../core/math';
import {
    TERRAIN_CONFIG,
    LOD_CONFIG,
    getTileSizeForLOD,
    getMeshResolutionForLOD,
} from './WorldConstants';

/**
 * Geographic bounding box for terrain tiles
 */
export interface GeoBounds {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}

/**
 * World space bounding box
 */
export interface WorldBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

/**
 * Terrain tile state enumeration
 */
export enum TerrainTileState {
    UNLOADED = 'unloaded',
    LOADING = 'loading',
    LOADED = 'loaded',
    GENERATING = 'generating',
    READY = 'ready',
    ERROR = 'error',
}

/**
 * Terrain data for a single tile
 */
export interface TerrainData {
    /** Height values as 32-bit float array */
    heightmap: Float32Array;

    /** Normal vectors for lighting calculations */
    normals?: Float32Array;

    /** Material/biome classification per vertex */
    materials?: Uint8Array;

    /** Texture coordinates */
    uvs?: Float32Array;

    /** Water mask (0 = land, 1 = water) */
    waterMask?: Uint8Array;

    /** Slope angles in radians */
    slopes?: Float32Array;

    /** Texture atlas indices */
    textureIndices?: Uint8Array;
}

/**
 * Mesh data for GPU rendering
 */
export interface MeshData {
    /** Vertex positions */
    vertices: Float32Array;

    /** Vertex indices for triangulation */
    indices: Uint32Array;

    /** Vertex normals */
    normals: Float32Array;

    /** Texture coordinates */
    uvs: Float32Array;

    /** Vertex colors/material data */
    colors?: Float32Array;

    /** Number of vertices */
    vertexCount: number;

    /** Number of triangles */
    triangleCount: number;
}

/**
 * Tile metadata and statistics
 */
export interface TileMetadata {
    /** Generation timestamp */
    generatedAt: number;

    /** Last access time for cache management */
    lastAccessTime: number;

    /** Memory usage in bytes */
    memoryUsage: number;

    /** Data source identifier */
    dataSource?: string;

    /** Quality/error metrics */
    quality: number;

    /** Minimum elevation in tile */
    minElevation: number;

    /** Maximum elevation in tile */
    maxElevation: number;

    /** Average elevation */
    avgElevation: number;

    /** Terrain roughness measure */
    roughness: number;
}

/**
 * Individual terrain tile in the quadtree hierarchy
 */
export class TerrainTile {
    /** Tile coordinates in quadtree */
    public readonly x: number;
    public readonly z: number;
    public readonly level: number;

    /** Unique tile identifier */
    public readonly id: string;

    /** Current tile state */
    public state: TerrainTileState = TerrainTileState.UNLOADED;

    /** World space bounds */
    public readonly worldBounds: WorldBounds;

    /** Geographic bounds */
    public readonly geoBounds: GeoBounds;

    /** Tile size in world units */
    public readonly size: number;

    /** Center position in world coordinates */
    public readonly center: Vector3;

    /** Parent tile (null for root level) */
    public parent: TerrainTile | null = null;

    /** Child tiles (null if not subdivided) */
    public children: TerrainTile[] | null = null;

    /** Terrain height and material data */
    public terrainData: TerrainData | null = null;

    /** Generated mesh data for rendering */
    public meshData: MeshData | null = null;

    /** Tile metadata */
    public metadata: TileMetadata;

    /** Error/approximation value for LOD selection */
    public error: number = 0;

    /** Distance to camera for LOD calculations */
    public distanceToCamera: number = Infinity;

    /** Whether tile is currently visible */
    public isVisible: boolean = false;

    /** Whether tile needs mesh regeneration */
    public needsMeshUpdate: boolean = true;

    /** Neighbor tiles for seam prevention */
    public neighbors: {
        north?: TerrainTile;
        south?: TerrainTile;
        east?: TerrainTile;
        west?: TerrainTile;
    } = {};

    constructor(x: number, z: number, level: number) {
        // Validate inputs to prevent NaN/Infinity
        if (!isFinite(x) || !isFinite(z) || !isFinite(level)) {
            console.error('Invalid tile coordinates:', { x, z, level });
            x = isFinite(x) ? x : 0;
            z = isFinite(z) ? z : 0;
            level = isFinite(level) ? level : 0;
        }

        // Clamp level to prevent extreme values
        const MAX_LEVEL = 20;
        if (level > MAX_LEVEL) {
            console.warn('Tile level too high:', level, 'clamping to', MAX_LEVEL);
            level = MAX_LEVEL;
        }

        this.x = x;
        this.z = z;
        this.level = level;
        this.id = `tile_${level}_${x}_${z}`;

        this.size = getTileSizeForLOD(level);

        // Validate size
        if (!isFinite(this.size) || this.size <= 0) {
            console.error('Invalid tile size for level', level, ':', this.size);
            this.size = 1000; // Default fallback
        }

        // Calculate world bounds - simple grid without centering
        // Each tile occupies its natural position in the grid
        this.worldBounds = {
            minX: x * this.size,
            maxX: (x + 1) * this.size,
            minZ: z * this.size,
            maxZ: (z + 1) * this.size,
        };

        // Calculate center position
        this.center = new Vector3(
            this.worldBounds.minX + this.size * 0.5,
            0, // Y will be updated based on average elevation
            this.worldBounds.minZ + this.size * 0.5
        );

        // TODO: Convert world bounds to geographic bounds
        this.geoBounds = {
            minLat: this.worldBounds.minZ / 111320, // Approximate conversion
            maxLat: this.worldBounds.maxZ / 111320,
            minLon: this.worldBounds.minX / 111320,
            maxLon: this.worldBounds.maxX / 111320,
        };

        // Initialize metadata
        this.metadata = {
            generatedAt: 0,
            lastAccessTime: Date.now(),
            memoryUsage: 0,
            quality: 0,
            minElevation: 0,
            maxElevation: 0,
            avgElevation: 0,
            roughness: 0,
        };
    }

    /**
     * Check if this tile should be subdivided based on LOD criteria
     */
    public shouldSubdivide(cameraPosition: Vector3, errorThreshold: number): boolean {
        if (this.level >= TERRAIN_CONFIG.MAX_LOD_LEVELS - 1) {
            return false; // Maximum subdivision reached
        }

        // Calculate distance from camera to tile
        this.distanceToCamera = this.center.distanceTo(cameraPosition);

        // Check if tile is within subdivision distance
        const subdivisionDistance =
            LOD_CONFIG.TERRAIN_DISTANCES[this.level + 1] || LOD_CONFIG.CULL_DISTANCE;

        return this.distanceToCamera < subdivisionDistance && this.error > errorThreshold;
    }

    /**
     * Create four child tiles for subdivision
     */
    public subdivide(): TerrainTile[] {
        if (this.children) {
            return this.children; // Already subdivided
        }

        // Prevent subdivision if current tile has invalid coordinates
        if (!isFinite(this.x) || !isFinite(this.z) || !isFinite(this.level)) {
            console.error('Cannot subdivide tile with invalid coordinates:', this.id);
            return [];
        }

        // Prevent excessive subdivision
        const MAX_SUBDIVISION_LEVEL = 10;
        if (this.level >= MAX_SUBDIVISION_LEVEL) {
            console.warn('Maximum subdivision level reached:', this.level);
            return [];
        }

        const childLevel = this.level + 1;
        const childX = this.x * 2;
        const childZ = this.z * 2;

        this.children = [
            new TerrainTile(childX, childZ, childLevel), // Southwest
            new TerrainTile(childX + 1, childZ, childLevel), // Southeast
            new TerrainTile(childX, childZ + 1, childLevel), // Northwest
            new TerrainTile(childX + 1, childZ + 1, childLevel), // Northeast
        ];

        // Set parent reference
        this.children.forEach((child) => {
            child.parent = this;
        });

        return this.children;
    }

    /**
     * Remove child tiles and collapse subdivision
     */
    public collapse(): void {
        if (this.children) {
            this.children.forEach((child) => {
                child.dispose();
            });
            this.children = null;
        }
    }

    /**
     * Check if tile is a leaf node (has no children)
     */
    public isLeaf(): boolean {
        return this.children === null;
    }

    /**
     * Check if tile is ready for rendering
     */
    public isReadyForRender(): boolean {
        return (
            this.state === TerrainTileState.READY &&
            this.meshData !== null &&
            this.terrainData !== null
        );
    }

    /**
     * Update tile's distance to camera and visibility
     */
    public updateLOD(cameraPosition: Vector3, frustum?: any): void {
        this.distanceToCamera = this.center.distanceTo(cameraPosition);
        this.metadata.lastAccessTime = Date.now();

        // Basic frustum culling (simplified)
        if (frustum) {
            // TODO: Implement proper frustum culling
            this.isVisible = this.distanceToCamera < LOD_CONFIG.CULL_DISTANCE;
        } else {
            this.isVisible = this.distanceToCamera < LOD_CONFIG.CULL_DISTANCE;
        }
    }

    /**
     * Calculate geometric error for LOD selection
     */
    public calculateError(): number {
        if (!this.terrainData) {
            return 0;
        }

        // Calculate elevation variance as error metric
        const elevationRange = this.metadata.maxElevation - this.metadata.minElevation;
        const geometricComplexity = this.metadata.roughness;

        // Error decreases with distance and increases with terrain complexity
        this.error =
            (elevationRange + geometricComplexity) / Math.max(1, this.distanceToCamera / 1000);

        return this.error;
    }

    /**
     * Get the appropriate LOD level based on distance
     */
    public getRecommendedLOD(): number {
        for (let i = 0; i < LOD_CONFIG.TERRAIN_DISTANCES.length; i++) {
            if (this.distanceToCamera < LOD_CONFIG.TERRAIN_DISTANCES[i]) {
                return Math.max(0, i - 1);
            }
        }
        return LOD_CONFIG.TERRAIN_DISTANCES.length - 1;
    }

    /**
     * Set terrain data and update metadata
     */
    public setTerrainData(data: TerrainData): void {
        this.terrainData = data;
        this.updateMetadataFromTerrain();
        this.needsMeshUpdate = true;
    }

    /**
     * Set mesh data
     */
    public setMeshData(mesh: MeshData): void {
        this.meshData = mesh;
        this.needsMeshUpdate = false;

        if (this.state === TerrainTileState.LOADED) {
            this.state = TerrainTileState.READY;
        }
    }

    /**
     * Get memory usage of this tile
     */
    public getMemoryUsage(): number {
        let usage = 0;

        if (this.terrainData) {
            usage += this.terrainData.heightmap.byteLength;
            usage += this.terrainData.normals?.byteLength || 0;
            usage += this.terrainData.materials?.byteLength || 0;
            usage += this.terrainData.uvs?.byteLength || 0;
            usage += this.terrainData.waterMask?.byteLength || 0;
            usage += this.terrainData.slopes?.byteLength || 0;
        }

        if (this.meshData) {
            usage += this.meshData.vertices.byteLength;
            usage += this.meshData.indices.byteLength;
            usage += this.meshData.normals.byteLength;
            usage += this.meshData.uvs.byteLength;
            usage += this.meshData.colors?.byteLength || 0;
        }

        this.metadata.memoryUsage = usage;
        return usage;
    }

    /**
     * Check if point is within tile bounds
     */
    public containsPoint(x: number, z: number): boolean {
        return (
            x >= this.worldBounds.minX &&
            x < this.worldBounds.maxX &&
            z >= this.worldBounds.minZ &&
            z < this.worldBounds.maxZ
        );
    }

    /**
     * Get height at specific coordinates within tile
     */
    public getHeightAt(x: number, z: number): number {
        if (!this.terrainData || !this.containsPoint(x, z)) {
            return 0;
        }

        // Convert world coordinates to tile-local coordinates
        const localX = (x - this.worldBounds.minX) / this.size;
        const localZ = (z - this.worldBounds.minZ) / this.size;

        // Sample heightmap with bilinear interpolation
        const resolution = Math.sqrt(this.terrainData.heightmap.length);
        const fx = localX * (resolution - 1);
        const fz = localZ * (resolution - 1);

        const ix = Math.floor(fx);
        const iz = Math.floor(fz);

        if (ix >= resolution - 1 || iz >= resolution - 1) {
            return this.terrainData.heightmap[iz * resolution + ix] || 0;
        }

        // Bilinear interpolation
        const tx = fx - ix;
        const tz = fz - iz;

        const h00 = this.terrainData.heightmap[iz * resolution + ix];
        const h10 = this.terrainData.heightmap[iz * resolution + ix + 1];
        const h01 = this.terrainData.heightmap[(iz + 1) * resolution + ix];
        const h11 = this.terrainData.heightmap[(iz + 1) * resolution + ix + 1];

        const h0 = h00 * (1 - tx) + h10 * tx;
        const h1 = h01 * (1 - tx) + h11 * tx;

        return h0 * (1 - tz) + h1 * tz;
    }

    /**
     * Update metadata based on terrain data
     */
    private updateMetadataFromTerrain(): void {
        if (!this.terrainData) return;

        const heights = this.terrainData.heightmap;
        let minElevation = Infinity;
        let maxElevation = -Infinity;
        let totalElevation = 0;
        let roughnessSum = 0;

        // Calculate elevation statistics
        for (let i = 0; i < heights.length; i++) {
            const height = heights[i];
            minElevation = Math.min(minElevation, height);
            maxElevation = Math.max(maxElevation, height);
            totalElevation += height;
        }

        // Calculate roughness as variance in elevation
        const avgElevation = totalElevation / heights.length;
        for (let i = 0; i < heights.length; i++) {
            const diff = heights[i] - avgElevation;
            roughnessSum += diff * diff;
        }

        this.metadata.minElevation = minElevation;
        this.metadata.maxElevation = maxElevation;

        // Update center Y position to average elevation
        this.center.y = avgElevation;
        this.metadata.avgElevation = avgElevation;
        this.metadata.roughness = Math.sqrt(roughnessSum / heights.length);
        this.metadata.generatedAt = Date.now();

        // Update tile center Y coordinate
        this.center.y = avgElevation;
    }

    /**
     * Dispose of tile resources
     */
    public dispose(): void {
        // Clear terrain data
        this.terrainData = null;
        this.meshData = null;

        // Dispose children
        if (this.children) {
            this.children.forEach((child) => child.dispose());
            this.children = null;
        }

        // Clear neighbor references
        this.neighbors = {};

        this.state = TerrainTileState.UNLOADED;
    }

    /**
     * Serialize tile data for caching or network transfer
     */
    public serialize(): any {
        return {
            x: this.x,
            z: this.z,
            level: this.level,
            terrainData: this.terrainData
                ? {
                      heightmap: Array.from(this.terrainData.heightmap),
                      normals: this.terrainData.normals
                          ? Array.from(this.terrainData.normals)
                          : null,
                      materials: this.terrainData.materials
                          ? Array.from(this.terrainData.materials)
                          : null,
                      waterMask: this.terrainData.waterMask
                          ? Array.from(this.terrainData.waterMask)
                          : null,
                  }
                : null,
            metadata: this.metadata,
        };
    }

    /**
     * Deserialize tile data from cache or network
     */
    public static deserialize(data: any): TerrainTile {
        const tile = new TerrainTile(data.x, data.z, data.level);

        if (data.terrainData) {
            tile.terrainData = {
                heightmap: new Float32Array(data.terrainData.heightmap),
                normals: data.terrainData.normals
                    ? new Float32Array(data.terrainData.normals)
                    : undefined,
                materials: data.terrainData.materials
                    ? new Uint8Array(data.terrainData.materials)
                    : undefined,
                waterMask: data.terrainData.waterMask
                    ? new Uint8Array(data.terrainData.waterMask)
                    : undefined,
            };
            tile.state = TerrainTileState.LOADED;
        }

        if (data.metadata) {
            tile.metadata = { ...tile.metadata, ...data.metadata };
        }

        return tile;
    }
}
