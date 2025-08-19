import { Vector3 } from '../core/math';
import { BIOME_CONFIG, SCENERY_CONFIG, TERRAIN_CONFIG } from './WorldConstants';
import type { TerrainTile } from './TerrainTile';
import { VegetationGenerator, VegetationType } from './VegetationGenerator';

/**
 * Tree species with their biome preferences and characteristics
 */
export interface TreeSpecies {
    id: number;
    name: string;
    biomes: number[]; // Preferred biome IDs
    minElevation: number;
    maxElevation: number;
    maxSlope: number; // Maximum slope angle in radians
    density: number; // Trees per km²
    minHeight: number;
    maxHeight: number;
    canopyRadius: number;
    modelVariations: number; // Number of model variants
}

/**
 * Grass type with biome-specific characteristics
 */
export interface GrassType {
    id: number;
    name: string;
    biomes: number[]; // Preferred biome IDs
    density: number; // Patches per km²
    patchSize: number; // Size of grass patches in meters
    height: number;
    color: [number, number, number];
}

/**
 * Individual vegetation instance
 */
export interface VegetationInstance {
    id: string;
    type: 'tree' | 'grass';
    speciesId: number;
    position: Vector3;
    rotation: number; // Rotation around Y axis
    scale: Vector3;
    distance: number; // Distance from camera for LOD
    visible: boolean;
    lodLevel: number; // 0=full, 1=medium, 2=billboard, 3=culled
}

/**
 * Vegetation placement parameters for a tile
 */
export interface VegetationPlacement {
    tileId: string;
    instances: VegetationInstance[];
    treeBatches: Map<number, VegetationInstance[]>; // Grouped by species
    grassBatches: Map<number, VegetationInstance[]>; // Grouped by type
    lastUpdate: number;
    needsUpdate: boolean;
}

/**
 * Poisson disk sampling for natural distribution
 */
class PoissonDiskSampler {
    private width: number;
    private height: number;
    private cellSize: number;
    private grid: Vector3[][];
    private active: Vector3[] = [];
    private samples: Vector3[] = [];

    constructor(width: number, height: number, minDistance: number) {
        this.width = width;
        this.height = height;
        this.cellSize = minDistance / Math.sqrt(2);

        const cols = Math.ceil(width / this.cellSize);
        const rows = Math.ceil(height / this.cellSize);

        this.grid = Array(rows)
            .fill(null)
            .map(() => Array(cols).fill(null));
    }

    /**
     * Generate samples using Poisson disk sampling
     */
    public generateSamples(numSamples: number = 30): Vector3[] {
        this.samples = [];
        this.active = [];

        // Start with a random initial point
        const initial = new Vector3(Math.random() * this.width, 0, Math.random() * this.height);

        this.addSample(initial);

        // Generate samples around existing points
        while (this.active.length > 0 && this.samples.length < numSamples) {
            const randomIndex = Math.floor(Math.random() * this.active.length);
            const point = this.active[randomIndex];
            let found = false;

            // Try to find a valid point around the selected point
            for (let i = 0; i < 30; i++) {
                const candidate = this.generatePointAround(point);
                if (this.isValidPoint(candidate)) {
                    this.addSample(candidate);
                    found = true;
                    break;
                }
            }

            if (!found) {
                this.active.splice(randomIndex, 1);
            }
        }

        return this.samples;
    }

    private addSample(point: Vector3): void {
        this.samples.push(point);
        this.active.push(point);

        const col = Math.floor(point.x / this.cellSize);
        const row = Math.floor(point.z / this.cellSize);

        if (row >= 0 && row < this.grid.length && col >= 0 && col < this.grid[0].length) {
            this.grid[row][col] = point;
        }
    }

    private generatePointAround(center: Vector3): Vector3 {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.cellSize * Math.sqrt(2) * (1 + Math.random());

        return new Vector3(
            center.x + Math.cos(angle) * distance,
            0,
            center.z + Math.sin(angle) * distance
        );
    }

    private isValidPoint(point: Vector3): boolean {
        if (point.x < 0 || point.x >= this.width || point.z < 0 || point.z >= this.height) {
            return false;
        }

        const col = Math.floor(point.x / this.cellSize);
        const row = Math.floor(point.z / this.cellSize);

        // Check surrounding cells
        for (let r = Math.max(0, row - 1); r <= Math.min(this.grid.length - 1, row + 1); r++) {
            for (
                let c = Math.max(0, col - 1);
                c <= Math.min(this.grid[0].length - 1, col + 1);
                c++
            ) {
                const neighbor = this.grid[r][c];
                if (neighbor) {
                    const distance = Math.sqrt(
                        (point.x - neighbor.x) ** 2 + (point.z - neighbor.z) ** 2
                    );
                    if (distance < this.cellSize * Math.sqrt(2)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }
}

/**
 * Advanced vegetation placement and management system
 */
export class VegetationSystem {
    private treeSpecies: Map<number, TreeSpecies> = new Map();
    private grassTypes: Map<number, GrassType> = new Map();
    private placements: Map<string, VegetationPlacement> = new Map();
    private seed: number;
    private random: () => number;
    private vegetationGenerator: VegetationGenerator;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.random = this.createSeededRandom(seed);
        this.vegetationGenerator = new VegetationGenerator(seed);
        this.initializeSpecies();
    }

    /**
     * Initialize tree species and grass types
     */
    private initializeSpecies(): void {
        // Define tree species for different biomes
        this.treeSpecies.set(0, {
            id: 0,
            name: 'Oak',
            biomes: [BIOME_CONFIG.BIOMES.FOREST.id, BIOME_CONFIG.BIOMES.GRASSLAND.id],
            minElevation: 0,
            maxElevation: 1500,
            maxSlope: Math.PI / 6, // 30 degrees
            density: 5, // Very low density for better visibility
            minHeight: 12,
            maxHeight: 25,
            canopyRadius: 8,
            modelVariations: 3,
        });

        this.treeSpecies.set(1, {
            id: 1,
            name: 'Pine',
            biomes: [
                BIOME_CONFIG.BIOMES.FOREST.id,
                BIOME_CONFIG.BIOMES.MOUNTAIN.id,
                BIOME_CONFIG.BIOMES.TUNDRA.id,
            ],
            minElevation: 500,
            maxElevation: 3000,
            maxSlope: Math.PI / 4, // 45 degrees
            density: 3, // Very low density for better visibility
            minHeight: 15,
            maxHeight: 35,
            canopyRadius: 5,
            modelVariations: 3,
        });

        this.treeSpecies.set(2, {
            id: 2,
            name: 'Palm',
            biomes: [BIOME_CONFIG.BIOMES.BEACH.id],
            minElevation: -5,
            maxElevation: 50,
            maxSlope: Math.PI / 8, // 22.5 degrees
            density: 2, // Very low density for better visibility
            minHeight: 8,
            maxHeight: 18,
            canopyRadius: 6,
            modelVariations: 2,
        });

        this.treeSpecies.set(3, {
            id: 3,
            name: 'Birch',
            biomes: [BIOME_CONFIG.BIOMES.FOREST.id, BIOME_CONFIG.BIOMES.TUNDRA.id],
            minElevation: 200,
            maxElevation: 2000,
            maxSlope: Math.PI / 5, // 36 degrees
            density: 4, // Very low density for better visibility
            minHeight: 8,
            maxHeight: 20,
            canopyRadius: 4,
            modelVariations: 2,
        });

        this.treeSpecies.set(4, {
            id: 4,
            name: 'Cactus',
            biomes: [BIOME_CONFIG.BIOMES.DESERT.id],
            minElevation: 0,
            maxElevation: 1000,
            maxSlope: Math.PI / 6, // 30 degrees
            density: 1, // Very low density for better visibility
            minHeight: 2,
            maxHeight: 8,
            canopyRadius: 1,
            modelVariations: 3,
        });

        // Define grass types
        this.grassTypes.set(0, {
            id: 0,
            name: 'Temperate Grass',
            biomes: [BIOME_CONFIG.BIOMES.GRASSLAND.id, BIOME_CONFIG.BIOMES.FOREST.id],
            density: 100, // Drastically reduced for performance
            patchSize: 3,
            height: 0.3,
            color: [0.4, 0.7, 0.2],
        });

        this.grassTypes.set(1, {
            id: 1,
            name: 'Tundra Grass',
            biomes: [BIOME_CONFIG.BIOMES.TUNDRA.id],
            density: 60, // Drastically reduced for performance
            patchSize: 2,
            height: 0.15,
            color: [0.5, 0.6, 0.3],
        });

        this.grassTypes.set(2, {
            id: 2,
            name: 'Beach Grass',
            biomes: [BIOME_CONFIG.BIOMES.BEACH.id],
            density: 40, // Drastically reduced for performance
            patchSize: 1.5,
            height: 0.4,
            color: [0.6, 0.7, 0.4],
        });

        this.grassTypes.set(3, {
            id: 3,
            name: 'Wetland Grass',
            biomes: [BIOME_CONFIG.BIOMES.WETLAND.id],
            density: 80, // Drastically reduced for performance
            patchSize: 2.5,
            height: 0.6,
            color: [0.3, 0.6, 0.3],
        });
    }

    /**
     * Generate vegetation for a terrain tile
     */
    public generateVegetationForTile(tile: TerrainTile): VegetationPlacement {
        const placement: VegetationPlacement = {
            tileId: tile.id,
            instances: [],
            treeBatches: new Map(),
            grassBatches: new Map(),
            lastUpdate: Date.now(),
            needsUpdate: false,
        };

        if (!tile.terrainData) {
            console.warn('VegetationSystem: No terrain data for tile', tile.id);
            return placement;
        }

        console.log('VegetationSystem: Generating vegetation for tile', tile.id);

        const { heightmap, materials, slopes, waterMask } = tile.terrainData;
        const tileSize = tile.size;
        const resolution = Math.sqrt(heightmap.length);
        const step = tileSize / (resolution - 1);

        // Reset random seed for consistent generation
        this.random = this.createSeededRandom(this.seed + tile.x * 1000 + tile.z);

        // Generate trees
        this.generateTrees(
            tile,
            placement,
            heightmap,
            materials,
            slopes,
            waterMask,
            step,
            resolution
        );

        // Generate grass
        this.generateGrass(
            tile,
            placement,
            heightmap,
            materials,
            slopes,
            waterMask,
            step,
            resolution
        );

        // Group instances into batches for efficient rendering
        this.createBatches(placement);

        console.log(
            'VegetationSystem: Generated',
            placement.instances.length,
            'total vegetation instances for tile',
            tile.id
        );
        console.log(
            'VegetationSystem: Tree batches:',
            placement.treeBatches.size,
            'Grass batches:',
            placement.grassBatches.size
        );

        this.placements.set(tile.id, placement);
        return placement;
    }

    /**
     * Generate tree instances for the tile
     */
    private generateTrees(
        tile: TerrainTile,
        placement: VegetationPlacement,
        heightmap: Float32Array,
        materials: Uint8Array,
        slopes: Float32Array,
        waterMask: Uint8Array,
        step: number,
        resolution: number
    ): void {
        const tileWorldX = tile.x * tile.size;
        const tileWorldZ = tile.z * tile.size;

        for (const [speciesId, species] of this.treeSpecies) {
            // Check if this species can grow in any biomes present in this tile
            const relevantBiomes = new Set();
            for (let i = 0; i < materials.length; i++) {
                if (species.biomes.includes(materials[i])) {
                    relevantBiomes.add(materials[i]);
                }
            }

            if (relevantBiomes.size === 0) continue;

            // Calculate approximate number of trees for this species
            const tileAreaKm2 = (tile.size / 1000) ** 2;
            const baseTreeCount = species.density * tileAreaKm2;
            const treeCount = Math.max(1, Math.round(baseTreeCount * (0.5 + this.random() * 0.5)));

            // Use Poisson disk sampling for natural distribution
            const minDistance = Math.sqrt(1000000 / species.density); // Approximate spacing
            const sampler = new PoissonDiskSampler(tile.size, tile.size, minDistance);
            const samples = sampler.generateSamples(treeCount * 2); // Generate extra samples to filter

            let placedTrees = 0;
            for (const sample of samples) {
                if (placedTrees >= treeCount) break;

                const worldX = tileWorldX + sample.x;
                const worldZ = tileWorldZ + sample.z;

                // Get terrain data at this position
                const terrainData = this.sampleTerrainData(
                    sample.x,
                    sample.z,
                    heightmap,
                    materials,
                    slopes,
                    waterMask,
                    step,
                    resolution
                );

                if (!terrainData) continue;

                // Check if this location is suitable for this tree species
                if (this.isValidTreeLocation(species, terrainData)) {
                    const instance = this.createTreeInstance(
                        speciesId,
                        species,
                        worldX,
                        terrainData.elevation, // Use the actual terrain elevation
                        worldZ
                    );
                    placement.instances.push(instance);
                    placedTrees++;
                }
            }
        }
    }

    /**
     * Generate grass instances for the tile
     */
    private generateGrass(
        tile: TerrainTile,
        placement: VegetationPlacement,
        heightmap: Float32Array,
        materials: Uint8Array,
        slopes: Float32Array,
        waterMask: Uint8Array,
        step: number,
        resolution: number
    ): void {
        const tileWorldX = tile.x * tile.size;
        const tileWorldZ = tile.z * tile.size;

        for (const [grassId, grassType] of this.grassTypes) {
            // Check if this grass type can grow in any biomes present in this tile
            const relevantBiomes = new Set();
            for (let i = 0; i < materials.length; i++) {
                if (grassType.biomes.includes(materials[i])) {
                    relevantBiomes.add(materials[i]);
                }
            }

            if (relevantBiomes.size === 0) continue;

            // Calculate number of grass patches
            const tileAreaKm2 = (tile.size / 1000) ** 2;
            const baseGrassCount = grassType.density * tileAreaKm2;
            const grassCount = Math.max(
                1,
                Math.round(baseGrassCount * (0.3 + this.random() * 0.7))
            );

            // Use less dense sampling for grass
            const minDistance = Math.sqrt(1000000 / grassType.density) * 0.7;
            const sampler = new PoissonDiskSampler(tile.size, tile.size, minDistance);
            const samples = sampler.generateSamples(grassCount * 1.5);

            let placedGrass = 0;
            for (const sample of samples) {
                if (placedGrass >= grassCount) break;

                const worldX = tileWorldX + sample.x;
                const worldZ = tileWorldZ + sample.z;

                // Get terrain data at this position
                const terrainData = this.sampleTerrainData(
                    sample.x,
                    sample.z,
                    heightmap,
                    materials,
                    slopes,
                    waterMask,
                    step,
                    resolution
                );

                if (!terrainData) continue;

                // Check if this location is suitable for grass
                if (this.isValidGrassLocation(grassType, terrainData)) {
                    const instance = this.createGrassInstance(
                        grassId,
                        grassType,
                        worldX,
                        terrainData.elevation, // Use the actual terrain elevation
                        worldZ
                    );
                    placement.instances.push(instance);
                    placedGrass++;
                }
            }
        }
    }

    /**
     * Sample terrain data at a specific position within the tile using bilinear interpolation
     */
    private sampleTerrainData(
        x: number,
        z: number,
        heightmap: Float32Array,
        materials: Uint8Array,
        slopes: Float32Array,
        waterMask: Uint8Array,
        step: number,
        resolution: number
    ) {
        // Convert to grid coordinates
        const fx = x / step;
        const fz = z / step;

        // Clamp to valid range
        const clampedFx = Math.max(0, Math.min(resolution - 1.001, fx));
        const clampedFz = Math.max(0, Math.min(resolution - 1.001, fz));

        const ix = Math.floor(clampedFx);
        const iz = Math.floor(clampedFz);

        // Get fractional parts for interpolation
        const tx = clampedFx - ix;
        const tz = clampedFz - iz;

        // Sample the four corner points
        const i00 = iz * resolution + ix;
        const i10 = iz * resolution + Math.min(ix + 1, resolution - 1);
        const i01 = Math.min(iz + 1, resolution - 1) * resolution + ix;
        const i11 =
            Math.min(iz + 1, resolution - 1) * resolution + Math.min(ix + 1, resolution - 1);

        // Bilinear interpolation for height
        const h00 = heightmap[i00];
        const h10 = heightmap[i10];
        const h01 = heightmap[i01];
        const h11 = heightmap[i11];

        const h0 = h00 * (1 - tx) + h10 * tx;
        const h1 = h01 * (1 - tx) + h11 * tx;
        const elevation = h0 * (1 - tz) + h1 * tz;

        // Use nearest neighbor for discrete data (materials, water mask)
        const nearestIndex = Math.round(clampedFz) * resolution + Math.round(clampedFx);

        return {
            elevation: elevation,
            biome: materials[nearestIndex],
            slope: slopes[nearestIndex],
            isWater: waterMask[nearestIndex] > 0,
        };
    }

    /**
     * Check if a location is valid for placing a tree
     */
    private isValidTreeLocation(species: TreeSpecies, terrainData: any): boolean {
        // Check water
        if (terrainData.isWater) return false;

        // Check elevation range
        if (
            terrainData.elevation < species.minElevation ||
            terrainData.elevation > species.maxElevation
        ) {
            return false;
        }

        // Check slope
        if (terrainData.slope > species.maxSlope) return false;

        // Check biome compatibility
        if (!species.biomes.includes(terrainData.biome)) return false;

        return true;
    }

    /**
     * Check if a location is valid for placing grass
     */
    private isValidGrassLocation(grassType: GrassType, terrainData: any): boolean {
        // Check water (some grass types like wetland grass can be near water)
        if (terrainData.isWater) {
            return grassType.biomes.includes(BIOME_CONFIG.BIOMES.WETLAND.id);
        }

        // Check slope (grass can grow on steeper slopes than trees)
        if (terrainData.slope > Math.PI / 3) return false; // 60 degrees max

        // Check biome compatibility
        if (!grassType.biomes.includes(terrainData.biome)) return false;

        return true;
    }

    /**
     * Create a tree instance
     */
    private createTreeInstance(
        speciesId: number,
        species: TreeSpecies,
        x: number,
        y: number,
        z: number
    ): VegetationInstance {
        const heightVariation =
            species.minHeight + this.random() * (species.maxHeight - species.minHeight);
        const scaleVariation = 0.8 + this.random() * 0.4; // 80%-120% scale variation

        // Scale trees properly - the geometry is 25m tall, so scale to desired height
        const baseHeight = 25.0; // Height of the cone geometry
        const heightScale = heightVariation / baseHeight;

        console.log(
            `VegetationSystem: Creating tree at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) height: ${heightVariation.toFixed(1)}m`
        );

        return {
            id: `tree_${speciesId}_${x}_${z}`,
            type: 'tree',
            speciesId,
            position: new Vector3(x, y, z),
            rotation: this.random() * Math.PI * 2,
            scale: new Vector3(scaleVariation, heightScale, scaleVariation), // Scale height to match species
            distance: 0,
            visible: true,
            lodLevel: 0,
        };
    }

    /**
     * Create a grass instance
     */
    private createGrassInstance(
        grassId: number,
        grassType: GrassType,
        x: number,
        y: number,
        z: number
    ): VegetationInstance {
        const scaleVariation = 0.7 + this.random() * 0.6; // 70%-130% scale variation

        return {
            id: `grass_${grassId}_${x}_${z}`,
            type: 'grass',
            speciesId: grassId,
            position: new Vector3(x, y, z),
            rotation: this.random() * Math.PI * 2,
            scale: new Vector3(
                scaleVariation * grassType.patchSize,
                scaleVariation,
                scaleVariation * grassType.patchSize
            ),
            distance: 0,
            visible: true,
            lodLevel: 0,
        };
    }

    /**
     * Group instances into batches for efficient rendering
     */
    private createBatches(placement: VegetationPlacement): void {
        for (const instance of placement.instances) {
            if (instance.type === 'tree') {
                if (!placement.treeBatches.has(instance.speciesId)) {
                    placement.treeBatches.set(instance.speciesId, []);
                }
                placement.treeBatches.get(instance.speciesId)!.push(instance);
            } else if (instance.type === 'grass') {
                if (!placement.grassBatches.has(instance.speciesId)) {
                    placement.grassBatches.set(instance.speciesId, []);
                }
                placement.grassBatches.get(instance.speciesId)!.push(instance);
            }
        }
    }

    /**
     * Update vegetation LOD based on camera position
     */
    public updateVegetationLOD(cameraPosition: Vector3, viewDistance: number = 10000): void {
        for (const placement of this.placements.values()) {
            let needsUpdate = false;

            for (const instance of placement.instances) {
                const distance = cameraPosition.distanceTo(instance.position);
                instance.distance = distance;

                // Determine LOD level
                let newLodLevel: number;
                if (distance > viewDistance) {
                    newLodLevel = 3; // Culled
                    instance.visible = false;
                } else if (distance > viewDistance * 0.5) {
                    newLodLevel = 2; // Billboard
                    instance.visible = true;
                } else if (distance > viewDistance * 0.2) {
                    newLodLevel = 1; // Medium detail
                    instance.visible = true;
                } else {
                    newLodLevel = 0; // Full detail
                    instance.visible = true;
                }

                if (newLodLevel !== instance.lodLevel) {
                    instance.lodLevel = newLodLevel;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                placement.needsUpdate = true;
                placement.lastUpdate = Date.now();
            }
        }
    }

    /**
     * Get vegetation placement for a tile
     */
    public getVegetationForTile(tileId: string): VegetationPlacement | null {
        return this.placements.get(tileId) || null;
    }

    /**
     * Get all visible vegetation instances
     */
    public getVisibleVegetation(maxDistance: number = 10000): VegetationInstance[] {
        const visible: VegetationInstance[] = [];

        for (const placement of this.placements.values()) {
            for (const instance of placement.instances) {
                if (instance.visible && instance.distance <= maxDistance) {
                    visible.push(instance);
                }
            }
        }

        return visible;
    }

    /**
     * Get tree species information
     */
    public getTreeSpecies(): Map<number, TreeSpecies> {
        return this.treeSpecies;
    }

    /**
     * Get grass type information
     */
    public getGrassTypes(): Map<number, GrassType> {
        return this.grassTypes;
    }

    /**
     * Clear vegetation for a tile
     */
    public clearVegetationForTile(tileId: string): void {
        this.placements.delete(tileId);
    }

    /**
     * Clear all vegetation
     */
    public clearAll(): void {
        this.placements.clear();
    }

    /**
     * Get vegetation statistics
     */
    public getStats() {
        let totalInstances = 0;
        let visibleInstances = 0;
        let treeInstances = 0;
        let grassInstances = 0;

        for (const placement of this.placements.values()) {
            totalInstances += placement.instances.length;
            for (const instance of placement.instances) {
                if (instance.visible) visibleInstances++;
                if (instance.type === 'tree') treeInstances++;
                if (instance.type === 'grass') grassInstances++;
            }
        }

        return {
            totalTiles: this.placements.size,
            totalInstances,
            visibleInstances,
            treeInstances,
            grassInstances,
            memoryUsage: this.placements.size * 1024, // Rough estimate
        };
    }

    /**
     * Create a seeded random number generator
     */
    private createSeededRandom(seed: number): () => number {
        return () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }
}
