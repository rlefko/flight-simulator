import { Vector3 } from '../core/math';
import { BIOME_CONFIG, SCENERY_CONFIG } from './WorldConstants';
import type { TerrainData } from './TerrainTile';
import type { SceneryInstance } from './SceneryManager';

/**
 * Vegetation type definitions
 */
export enum VegetationType {
    OAK_TREE = 'oak_tree',
    PINE_TREE = 'pine_tree',
    BIRCH_TREE = 'birch_tree',
    PALM_TREE = 'palm_tree',
    BUSH = 'bush',
    GRASS_PATCH = 'grass_patch',
    FERN = 'fern',
    CACTUS = 'cactus',
}

/**
 * Tree configuration for different biomes
 */
interface TreeConfig {
    type: VegetationType;
    minHeight: number;
    maxHeight: number;
    minRadius: number;
    maxRadius: number;
    density: number; // Trees per 100m²
    clusterProbability: number;
    color: [number, number, number];
}

/**
 * Grass configuration for different biomes
 */
interface GrassConfig {
    type: VegetationType;
    density: number; // Patches per 100m²
    patchSize: number; // Size of grass patches in meters
    height: number;
    color: [number, number, number];
}

/**
 * Generates realistic vegetation placement for terrain tiles
 */
export class VegetationGenerator {
    private seed: number;
    private treeConfigs: Map<number, TreeConfig[]> = new Map();
    private grassConfigs: Map<number, GrassConfig[]> = new Map();
    private permutation: Uint8Array;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.initializeTreeConfigs();
        this.initializeGrassConfigs();
        this.initializePerlinNoise();
    }

    /**
     * Initialize Perlin noise permutation table for forest clustering
     */
    private initializePerlinNoise(): void {
        this.permutation = new Uint8Array(512);
        const p = new Uint8Array(256);

        // Initialize with values 0-255
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle using seed
        let rng = this.seed;
        for (let i = 255; i > 0; i--) {
            rng = (rng * 1103515245 + 12345) & 0x7fffffff;
            const j = rng % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Double the permutation table
        for (let i = 0; i < 512; i++) {
            this.permutation[i] = p[i & 255];
        }
    }

    /**
     * Initialize tree configurations for each biome
     */
    private initializeTreeConfigs(): void {
        // Forest biome trees - increased density for more visible forests
        this.treeConfigs.set(3, [
            {
                type: VegetationType.OAK_TREE,
                minHeight: 15,
                maxHeight: 25,
                minRadius: 3,
                maxRadius: 6,
                density: 300, // Doubled density
                clusterProbability: 0.8,
                color: [0.2, 0.4, 0.1],
            },
            {
                type: VegetationType.BIRCH_TREE,
                minHeight: 12,
                maxHeight: 20,
                minRadius: 2,
                maxRadius: 4,
                density: 200, // Doubled density
                clusterProbability: 0.6,
                color: [0.3, 0.5, 0.2],
            },
        ]);

        // Grassland biome trees (sparse but visible)
        this.treeConfigs.set(2, [
            {
                type: VegetationType.OAK_TREE,
                minHeight: 10,
                maxHeight: 18,
                minRadius: 3,
                maxRadius: 5,
                density: 30, // Doubled density
                clusterProbability: 0.4,
                color: [0.2, 0.4, 0.1],
            },
        ]);

        // Mountain biome trees (pine trees)
        this.treeConfigs.set(5, [
            {
                type: VegetationType.PINE_TREE,
                minHeight: 20,
                maxHeight: 30,
                minRadius: 2,
                maxRadius: 4,
                density: 160, // Doubled density
                clusterProbability: 0.7,
                color: [0.1, 0.3, 0.1],
            },
        ]);

        // Beach biome trees (palm trees)
        this.treeConfigs.set(1, [
            {
                type: VegetationType.PALM_TREE,
                minHeight: 8,
                maxHeight: 15,
                minRadius: 1,
                maxRadius: 2,
                density: 25, // Doubled density
                clusterProbability: 0.5,
                color: [0.3, 0.4, 0.2],
            },
        ]);

        // Desert biome vegetation
        this.treeConfigs.set(4, [
            {
                type: VegetationType.CACTUS,
                minHeight: 2,
                maxHeight: 5,
                minRadius: 0.5,
                maxRadius: 1,
                density: 16, // Doubled density
                clusterProbability: 0.2,
                color: [0.3, 0.5, 0.2],
            },
        ]);
    }

    /**
     * Initialize grass configurations for each biome
     */
    private initializeGrassConfigs(): void {
        // Forest biome grass
        this.grassConfigs.set(3, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 500, // Dense grass coverage
                patchSize: 2.0,
                height: 0.4,
                color: [0.3, 0.6, 0.2],
            },
            {
                type: VegetationType.FERN,
                density: 150,
                patchSize: 1.5,
                height: 0.6,
                color: [0.2, 0.5, 0.1],
            },
        ]);

        // Grassland biome grass
        this.grassConfigs.set(2, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 800, // Very dense in grasslands
                patchSize: 3.0,
                height: 0.3,
                color: [0.4, 0.7, 0.2],
            },
        ]);

        // Mountain biome grass
        this.grassConfigs.set(5, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 200, // Sparse mountain grass
                patchSize: 1.0,
                height: 0.2,
                color: [0.5, 0.6, 0.3],
            },
        ]);

        // Beach biome grass
        this.grassConfigs.set(1, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 100, // Beach grass
                patchSize: 1.5,
                height: 0.5,
                color: [0.6, 0.7, 0.4],
            },
        ]);

        // Wetland biome grass
        this.grassConfigs.set(8, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 600, // Dense wetland vegetation
                patchSize: 2.5,
                height: 0.7,
                color: [0.3, 0.6, 0.3],
            },
        ]);

        // Tundra biome grass
        this.grassConfigs.set(7, [
            {
                type: VegetationType.GRASS_PATCH,
                density: 300, // Moderate tundra vegetation
                patchSize: 1.0,
                height: 0.15,
                color: [0.5, 0.6, 0.4],
            },
        ]);
    }

    /**
     * Generate vegetation instances for a terrain tile using Poisson disk sampling
     */
    public generateVegetation(
        terrainData: TerrainData,
        tileSize: number,
        worldX: number,
        worldZ: number
    ): SceneryInstance[] {
        const instances: SceneryInstance[] = [];
        const resolution = Math.sqrt(terrainData.heightmap.length);

        // Get all biomes present in this tile to determine vegetation types
        const biomesPresent = new Set(terrainData.materials);

        for (const biomeId of biomesPresent) {
            const configs = this.treeConfigs.get(biomeId);
            if (!configs || configs.length === 0) continue;

            for (const config of configs) {
                // Calculate approximate tree count based on density and tile area
                const tileAreaKm2 = (tileSize / 1000) ** 2;
                const targetTreeCount = Math.round(config.density * tileAreaKm2 * 0.15); // Significantly increased multiplier

                if (targetTreeCount === 0) continue;

                console.log(
                    `VegetationGenerator: Generating ${targetTreeCount} trees of type ${config.type} for biome ${biomeId} in ${tileAreaKm2.toFixed(2)}km² tile`
                );

                // Use Poisson disk sampling for natural distribution with improved randomness
                const baseMinDistance = Math.sqrt(1000000 / config.density);
                // Add randomness to minimum distance to prevent regular patterns
                const distanceVariation =
                    0.3 + this.seededRandom(worldX, worldZ, this.seed + biomeId) * 0.4; // 30%-70% variation
                const minDistance = baseMinDistance * distanceVariation;

                // Add spatial offset to break grid alignment
                const spatialOffsetX =
                    this.seededRandom(worldX, worldZ, this.seed + biomeId * 1000 + 1) *
                    minDistance *
                    0.5;
                const spatialOffsetZ =
                    this.seededRandom(worldX, worldZ, this.seed + biomeId * 1000 + 2) *
                    minDistance *
                    0.5;

                const samples = this.generatePoissonDiskSamples(
                    tileSize,
                    tileSize,
                    minDistance,
                    targetTreeCount * 3, // Generate more samples for better coverage
                    worldX + spatialOffsetX,
                    worldZ + spatialOffsetZ,
                    this.seed + biomeId * 1000 + Math.floor(worldX / 100) + Math.floor(worldZ / 100) // More spatial variation
                );

                let placedTrees = 0;
                for (const sample of samples) {
                    if (placedTrees >= targetTreeCount) break;

                    const worldPosX = worldX + sample.x;
                    const worldPosZ = worldZ + sample.z;

                    // Get precise terrain data at this exact position
                    const terrainSample = this.sampleTerrainAtPosition(
                        sample.x,
                        sample.z,
                        terrainData,
                        tileSize,
                        resolution
                    );

                    if (!terrainSample) continue;

                    // Check if this location is suitable for this tree type
                    if (!this.isValidTreeLocation(config, terrainSample, biomeId)) continue;

                    // Check forest density using enhanced noise for natural clustering
                    const forestDensity = this.getForestDensity(worldPosX, worldPosZ, biomeId);
                    const placementRandom = this.seededRandom(
                        worldPosX + 0.1,
                        worldPosZ + 0.1,
                        this.seed + 1000 + Math.floor(worldPosX * 0.01) // Add micro-spatial variation
                    );

                    // Use adaptive threshold based on forest density with natural variation
                    const adaptiveThreshold = 0.2 + forestDensity * 0.5; // Dynamic threshold 0.2-0.7
                    const naturalVariation =
                        this.fractalNoise(worldPosX * 0.02, worldPosZ * 0.02, 2) * 0.1;
                    if (placementRandom > adaptiveThreshold + naturalVariation) continue;

                    // Create tree instance with proper height sampling
                    const instance = this.createTreeInstance(
                        config,
                        worldPosX,
                        terrainSample.elevation, // Use interpolated terrain height
                        worldPosZ,
                        worldPosX + worldPosZ // Deterministic seed for consistent properties
                    );

                    instances.push(instance);
                    placedTrees++;

                    // Add cluster of trees if configured with enhanced natural clustering
                    const clusterChance = config.clusterProbability * (0.8 + forestDensity * 0.4);
                    if (placementRandom < clusterChance) {
                        const clusterInstances = this.generateTreeCluster(
                            config,
                            worldPosX,
                            worldPosZ,
                            terrainSample.elevation,
                            terrainData,
                            tileSize,
                            resolution,
                            placementRandom,
                            forestDensity
                        );
                        instances.push(...clusterInstances);
                    }
                }
            }
        }

        // Generate grass
        for (const biomeId of biomesPresent) {
            const grassConfigs = this.grassConfigs.get(biomeId);
            if (!grassConfigs || grassConfigs.length === 0) continue;

            for (const config of grassConfigs) {
                // Calculate grass patch count based on density and tile area
                const tileAreaKm2 = (tileSize / 1000) ** 2;
                const targetGrassCount = Math.round(config.density * tileAreaKm2 * 0.05); // Moderate density

                if (targetGrassCount === 0) continue;

                console.log(
                    `VegetationGenerator: Generating ${targetGrassCount} grass patches of type ${config.type} for biome ${biomeId}`
                );

                // Use varied spacing for grass patches to prevent grid patterns
                const baseMinDistance = Math.sqrt(1000000 / config.density);
                const distanceVariation =
                    0.6 + this.seededRandom(worldX, worldZ, this.seed + biomeId * 3000) * 0.4;
                const minDistance = baseMinDistance * distanceVariation;

                // Add spatial variation for grass placement
                const grassOffsetX =
                    this.seededRandom(worldX, worldZ, this.seed + biomeId * 3000 + 1) *
                    minDistance *
                    0.3;
                const grassOffsetZ =
                    this.seededRandom(worldX, worldZ, this.seed + biomeId * 3000 + 2) *
                    minDistance *
                    0.3;

                const samples = this.generatePoissonDiskSamples(
                    tileSize,
                    tileSize,
                    minDistance,
                    targetGrassCount * 2, // Generate more samples for better coverage
                    worldX + grassOffsetX,
                    worldZ + grassOffsetZ,
                    this.seed +
                        biomeId * 2000 +
                        1000 +
                        Math.floor(worldX / 50) +
                        Math.floor(worldZ / 50)
                );

                let placedGrass = 0;
                for (const sample of samples) {
                    if (placedGrass >= targetGrassCount) break;

                    const worldPosX = worldX + sample.x;
                    const worldPosZ = worldZ + sample.z;

                    // Get precise terrain data at this exact position
                    const terrainSample = this.sampleTerrainAtPosition(
                        sample.x,
                        sample.z,
                        terrainData,
                        tileSize,
                        resolution
                    );

                    if (!terrainSample) continue;

                    // Check if this location is suitable for grass
                    if (!this.isValidGrassLocation(config, terrainSample, biomeId)) continue;

                    // Grass has higher placement probability than trees
                    const placementRandom = this.seededRandom(
                        worldPosX,
                        worldPosZ,
                        this.seed + 2000
                    );

                    // High chance of grass placement
                    if (placementRandom > 0.8) continue;

                    // Create grass instance
                    const instance = this.createGrassInstance(
                        config,
                        worldPosX,
                        terrainSample.elevation,
                        worldPosZ,
                        worldPosX + worldPosZ + 1000 // Different seed for grass properties
                    );

                    instances.push(instance);
                    placedGrass++;
                }
            }
        }

        return instances;
    }

    /**
     * Seeded random number generator for deterministic placement
     */
    private seededRandom(x: number, z: number, seed: number): number {
        const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
        return n - Math.floor(n);
    }

    /**
     * Perlin noise function for smooth, natural-looking clustering patterns
     */
    private perlinNoise(x: number, y: number): number {
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);

        const u = this.fade(xf);
        const v = this.fade(yf);

        const aa = this.permutation[this.permutation[xi] + yi];
        const ab = this.permutation[this.permutation[xi] + yi + 1];
        const ba = this.permutation[this.permutation[xi + 1] + yi];
        const bb = this.permutation[this.permutation[xi + 1] + yi + 1];

        const x1 = this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
        const x2 = this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);

        return this.lerp(x1, x2, v);
    }

    /**
     * Fade function for smooth noise interpolation
     */
    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /**
     * Linear interpolation
     */
    private lerp(a: number, b: number, t: number): number {
        return a + t * (b - a);
    }

    /**
     * Gradient function for Perlin noise
     */
    private grad(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * Generate multi-octave Perlin noise for more complex clustering patterns
     */
    private fractalNoise(x: number, y: number, octaves: number = 4): number {
        let result = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            result += this.perlinNoise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return result / maxValue;
    }

    /**
     * Generate Poisson disk samples for natural tree distribution
     */
    private generatePoissonDiskSamples(
        width: number,
        height: number,
        minDistance: number,
        maxSamples: number,
        offsetX: number,
        offsetZ: number,
        seed: number
    ): Vector3[] {
        const cellSize = minDistance / Math.sqrt(2);
        const cols = Math.ceil(width / cellSize);
        const rows = Math.ceil(height / cellSize);
        const grid: Vector3[][] = Array(rows)
            .fill(null)
            .map(() => Array(cols).fill(null));
        const active: Vector3[] = [];
        const samples: Vector3[] = [];

        // Seeded random for consistent generation
        let rng = seed;
        const random = () => {
            rng = (rng * 1664525 + 1013904223) % 4294967296;
            return rng / 4294967296;
        };

        // Start with multiple random initial points for better coverage
        const numInitialPoints = Math.min(3, Math.max(1, Math.floor(maxSamples / 50)));
        for (let i = 0; i < numInitialPoints; i++) {
            const initial = new Vector3(random() * width, 0, random() * height);

            // Check if initial point conflicts with existing ones
            let validInitial = true;
            for (const existing of samples) {
                const dist = Math.sqrt(
                    (initial.x - existing.x) ** 2 + (initial.z - existing.z) ** 2
                );
                if (dist < minDistance) {
                    validInitial = false;
                    break;
                }
            }

            if (validInitial) {
                this.addSampleToGrid(initial, grid, cellSize, active, samples);
            }
        }

        // Generate samples around existing points
        while (active.length > 0 && samples.length < maxSamples) {
            const randomIndex = Math.floor(random() * active.length);
            const point = active[randomIndex];
            let found = false;

            // Try to find a valid point around the selected point with more attempts for better coverage
            const attempts = 50; // Increased attempts for better coverage
            for (let i = 0; i < attempts; i++) {
                const candidate = this.generatePointAround(point, minDistance, random);
                if (this.isValidSample(candidate, width, height, minDistance, grid, cellSize)) {
                    this.addSampleToGrid(candidate, grid, cellSize, active, samples);
                    found = true;
                    break;
                }
            }

            if (!found) {
                active.splice(randomIndex, 1);
            }
        }

        return samples;
    }

    /**
     * Add sample to Poisson disk grid
     */
    private addSampleToGrid(
        point: Vector3,
        grid: Vector3[][],
        cellSize: number,
        active: Vector3[],
        samples: Vector3[]
    ): void {
        samples.push(point);
        active.push(point);

        const col = Math.floor(point.x / cellSize);
        const row = Math.floor(point.z / cellSize);

        if (row >= 0 && row < grid.length && col >= 0 && col < grid[0].length) {
            grid[row][col] = point;
        }
    }

    /**
     * Generate point around existing point for Poisson disk sampling with improved distribution
     */
    private generatePointAround(
        center: Vector3,
        minDistance: number,
        random: () => number
    ): Vector3 {
        // Use more varied distance distribution to prevent regular patterns
        const angle = random() * Math.PI * 2;

        // Non-linear distance distribution for more natural clustering
        const r1 = random();
        const r2 = random();
        const distanceMultiplier = 1 + r1 * r1 * 2; // Quadratic distribution favors closer placement
        const distance = minDistance * distanceMultiplier;

        // Add slight perturbation to break perfect circles
        const perturbation = (random() - 0.5) * minDistance * 0.1;
        const finalDistance = distance + perturbation;

        return new Vector3(
            center.x + Math.cos(angle) * finalDistance,
            0,
            center.z + Math.sin(angle) * finalDistance
        );
    }

    /**
     * Check if sample is valid for Poisson disk sampling
     */
    private isValidSample(
        point: Vector3,
        width: number,
        height: number,
        minDistance: number,
        grid: Vector3[][],
        cellSize: number
    ): boolean {
        if (point.x < 0 || point.x >= width || point.z < 0 || point.z >= height) {
            return false;
        }

        const col = Math.floor(point.x / cellSize);
        const row = Math.floor(point.z / cellSize);

        // Check surrounding cells
        for (let r = Math.max(0, row - 1); r <= Math.min(grid.length - 1, row + 1); r++) {
            for (let c = Math.max(0, col - 1); c <= Math.min(grid[0].length - 1, col + 1); c++) {
                const neighbor = grid[r][c];
                if (neighbor) {
                    const distance = Math.sqrt(
                        (point.x - neighbor.x) ** 2 + (point.z - neighbor.z) ** 2
                    );
                    if (distance < minDistance) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Sample terrain data at exact position with bilinear interpolation
     */
    private sampleTerrainAtPosition(
        localX: number,
        localZ: number,
        terrainData: TerrainData,
        tileSize: number,
        resolution: number
    ) {
        // Convert local tile coordinates to heightmap coordinates
        const fx = (localX / tileSize) * (resolution - 1);
        const fz = (localZ / tileSize) * (resolution - 1);

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
        const h00 = terrainData.heightmap[i00];
        const h10 = terrainData.heightmap[i10];
        const h01 = terrainData.heightmap[i01];
        const h11 = terrainData.heightmap[i11];

        const h0 = h00 * (1 - tx) + h10 * tx;
        const h1 = h01 * (1 - tx) + h11 * tx;
        const elevation = h0 * (1 - tz) + h1 * tz;

        // Use nearest neighbor for discrete data
        const nearestIndex = Math.round(clampedFz) * resolution + Math.round(clampedFx);
        const biomeId = terrainData.materials ? terrainData.materials[nearestIndex] : 0;
        const slope = terrainData.slopes ? terrainData.slopes[nearestIndex] : 0;
        const isWater = terrainData.waterMask ? terrainData.waterMask[nearestIndex] > 0 : false;

        return {
            elevation,
            biomeId,
            slope,
            isWater,
        };
    }

    /**
     * Check if location is valid for tree placement
     */
    private isValidTreeLocation(config: TreeConfig, terrainSample: any, biomeId: number): boolean {
        // Check water areas
        if (terrainSample.isWater) return false;

        // Check if this tree type can grow in this biome
        // For now, allow trees in their configured biomes
        const allowedBiomes = {
            [VegetationType.OAK_TREE]: [2, 3], // Grassland, Forest
            [VegetationType.PINE_TREE]: [3, 5], // Forest, Mountain
            [VegetationType.BIRCH_TREE]: [3], // Forest
            [VegetationType.PALM_TREE]: [1], // Beach
            [VegetationType.CACTUS]: [4], // Desert
        };

        const configBiomes = allowedBiomes[config.type] || [];
        if (!configBiomes.includes(biomeId)) return false;

        // Check elevation (basic - can be enhanced)
        if (terrainSample.elevation < 1) return false;

        // Check slope (trees don't grow on very steep slopes)
        if (terrainSample.slope > 0.7) return false;

        return true;
    }

    /**
     * Check if location is valid for grass placement
     */
    private isValidGrassLocation(
        config: GrassConfig,
        terrainSample: any,
        biomeId: number
    ): boolean {
        // Check water areas - some grass types can grow near water
        if (terrainSample.isWater && biomeId !== 8) return false; // Only wetland grass near water

        // Check if this grass type can grow in this biome
        const allowedBiomes = {
            [VegetationType.GRASS_PATCH]: [1, 2, 3, 5, 7, 8], // Most biomes
            [VegetationType.FERN]: [3, 8], // Forest and wetland only
        };

        const configBiomes = allowedBiomes[config.type] || [];
        if (!configBiomes.includes(biomeId)) return false;

        // Check elevation (grass grows at most elevations)
        if (terrainSample.elevation < -5) return false;

        // Check slope (grass can grow on moderate slopes)
        if (terrainSample.slope > 0.8) return false;

        return true;
    }

    /**
     * Create a grass instance with deterministic properties
     */
    private createGrassInstance(
        config: GrassConfig,
        worldX: number,
        elevation: number,
        worldZ: number,
        seed: number
    ) {
        // Use deterministic random based on position and seed
        const random1 = this.seededRandom(worldX, worldZ, seed);
        const random2 = this.seededRandom(worldX, worldZ, seed + 1);
        const random3 = this.seededRandom(worldX, worldZ, seed + 2);

        // Calculate grass properties
        const scaleVariation = 0.7 + random1 * 0.6; // 70%-130% scale variation
        const rotation = random3 * Math.PI * 2;

        return {
            objectId: config.type,
            position: new Vector3(worldX, elevation, worldZ),
            rotation: new Vector3(0, rotation, 0),
            scale: new Vector3(
                scaleVariation * config.patchSize,
                scaleVariation * config.height,
                scaleVariation * config.patchSize
            ),
            distance: 0,
            lodLevel: 0,
            visible: true,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Create a tree instance with deterministic properties
     */
    private createTreeInstance(
        config: TreeConfig,
        worldX: number,
        elevation: number,
        worldZ: number,
        seed: number
    ) {
        // Use deterministic random based on position and seed
        const random1 = this.seededRandom(worldX, worldZ, seed);
        const random2 = this.seededRandom(worldX, worldZ, seed + 1);
        const random3 = this.seededRandom(worldX, worldZ, seed + 2);

        // Calculate tree properties consistently
        const height = config.minHeight + (config.maxHeight - config.minHeight) * random1;
        const radius = config.minRadius + (config.maxRadius - config.minRadius) * random2;
        const rotation = random3 * Math.PI * 2;

        return {
            objectId: config.type,
            position: new Vector3(worldX, elevation, worldZ),
            rotation: new Vector3(0, rotation, 0),
            scale: new Vector3(radius, height, radius),
            distance: 0,
            lodLevel: 0,
            visible: true,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Generate tree cluster around a main tree with natural distribution
     */
    private generateTreeCluster(
        config: TreeConfig,
        centerX: number,
        centerZ: number,
        baseElevation: number,
        terrainData: TerrainData,
        tileSize: number,
        resolution: number,
        randomSeed: number,
        forestDensity: number = 0.5
    ) {
        const instances = [];

        // Dynamic cluster size based on forest density and tree type
        const baseClusterSize = config.type === VegetationType.PINE_TREE ? 4 : 3; // Pines cluster more
        const densityMultiplier = 0.5 + forestDensity * 1.5; // More trees in denser forest areas
        const clusterSize =
            Math.floor(baseClusterSize * densityMultiplier) + Math.floor(randomSeed * 3);

        // Variable cluster radius based on tree type and terrain
        const baseRadius =
            config.type === VegetationType.OAK_TREE
                ? 15
                : config.type === VegetationType.PINE_TREE
                  ? 20
                  : 10;
        const clusterRadius = baseRadius * (0.7 + randomSeed * 0.6); // 70%-130% variation

        // Generate trees with more natural positioning
        for (let i = 0; i < clusterSize; i++) {
            // Use multiple random factors for more natural placement
            const angleRandom1 = this.seededRandom(centerX, centerZ, this.seed + i * 100);
            const angleRandom2 = this.seededRandom(centerX + i, centerZ + i, this.seed + i * 200);
            const distanceRandom = this.seededRandom(
                centerX * 1.1,
                centerZ * 1.1,
                this.seed + i * 300
            );

            // Non-uniform angular distribution for more natural clustering
            const baseAngle = (i / clusterSize) * Math.PI * 2;
            const angleVariation = (angleRandom1 - 0.5) * Math.PI * 0.8; // Up to ±72° variation
            const angle = baseAngle + angleVariation + angleRandom2 * Math.PI * 0.3;

            // Non-linear distance distribution (some trees closer, some farther)
            const distanceFactor = distanceRandom * distanceRandom; // Quadratic distribution
            const distance = clusterRadius * (0.3 + distanceFactor * 0.7);

            // Add slight micro-positioning randomness
            const microX =
                (this.seededRandom(centerX + i * 0.1, centerZ, this.seed + i * 400) - 0.5) * 2;
            const microZ =
                (this.seededRandom(centerX, centerZ + i * 0.1, this.seed + i * 500) - 0.5) * 2;

            const treeX = centerX + Math.cos(angle) * distance + microX;
            const treeZ = centerZ + Math.sin(angle) * distance + microZ;

            // Check if cluster tree is within tile bounds
            const localX = treeX - (centerX - (centerX % tileSize));
            const localZ = treeZ - (centerZ - (centerZ % tileSize));

            if (localX < 0 || localX >= tileSize || localZ < 0 || localZ >= tileSize) continue;

            // Sample terrain at cluster tree position
            const clusterSample = this.sampleTerrainAtPosition(
                localX,
                localZ,
                terrainData,
                tileSize,
                resolution
            );

            if (!clusterSample || clusterSample.isWater) continue;

            // Create cluster tree instance with natural size variation
            const treeVariation = this.seededRandom(treeX, treeZ, this.seed + i * 600);
            const sizeMultiplier = 0.7 + treeVariation * 0.6; // 70%-130% size variation

            // Age variation - some trees in cluster are younger/smaller
            const ageVariation = this.seededRandom(treeX * 1.2, treeZ * 1.2, this.seed + i * 700);
            const ageFactor = 0.6 + ageVariation * 0.8; // Some trees are significantly smaller

            const instance = this.createTreeInstance(
                {
                    ...config,
                    minHeight: config.minHeight * sizeMultiplier * ageFactor,
                    maxHeight: config.maxHeight * sizeMultiplier * ageFactor,
                    minRadius: config.minRadius * sizeMultiplier * ageFactor,
                    maxRadius: config.maxRadius * sizeMultiplier * ageFactor,
                },
                treeX,
                clusterSample.elevation,
                treeZ,
                Math.floor(treeX * 1000) + Math.floor(treeZ * 1000) + i * 1000 // More deterministic seed
            );

            instances.push(instance);
        }

        return instances;
    }

    /**
     * Get forest density at a specific location using enhanced noise-based clustering
     */
    private getForestDensity(worldX: number, worldZ: number, biomeId: number): number {
        const configs = this.treeConfigs.get(biomeId);
        if (!configs || configs.length === 0) {
            return 0;
        }

        // Use multiple noise scales for natural clustering patterns with improved frequencies
        const largeScaleNoise = this.fractalNoise(worldX * 0.0002, worldZ * 0.0002, 5); // Large forest areas (5km scale)
        const mediumScaleNoise = this.fractalNoise(worldX * 0.001, worldZ * 0.001, 4); // Medium clusters (1km scale)
        const smallScaleNoise = this.fractalNoise(worldX * 0.005, worldZ * 0.005, 3); // Small clearings (200m scale)
        const microScaleNoise = this.fractalNoise(worldX * 0.02, worldZ * 0.02, 2); // Micro variations (50m scale)
        const detailNoise = this.fractalNoise(worldX * 0.1, worldZ * 0.1, 2); // Fine detail (10m scale)

        // Combine noise layers with more natural weightings
        let density =
            largeScaleNoise * 0.4 +
            mediumScaleNoise * 0.25 +
            smallScaleNoise * 0.2 +
            microScaleNoise * 0.1 +
            detailNoise * 0.05;

        // Normalize to 0-1 range
        density = (density + 1.0) * 0.5;

        // Apply biome-specific clustering patterns with enhanced naturalism
        switch (biomeId) {
            case 3: // Forest biome - dense with natural clearings and edge effects
                density = Math.max(0.5, density * 1.2); // Base forest coverage

                // Create natural clearings with varied sizes
                const clearingNoise = this.fractalNoise(worldX * 0.0008, worldZ * 0.0008, 3);
                const clearingSize = this.fractalNoise(worldX * 0.002, worldZ * 0.002, 2);

                if (clearingNoise < -0.4 && clearingSize < -0.2) {
                    density *= 0.1; // Large clearings
                } else if (clearingNoise < -0.2) {
                    density *= 0.4; // Small clearings
                }

                // Add forest edge effects
                const edgeNoise = this.fractalNoise(worldX * 0.01, worldZ * 0.01, 2);
                density *= 0.7 + edgeNoise * 0.3; // Natural density variation
                break;

            case 2: // Grassland - scattered copses and individual trees
                density *= 0.3;

                // Create copses (small groups of trees) with realistic distribution
                const copseNoise = this.fractalNoise(worldX * 0.001, worldZ * 0.001, 4);
                const copseDetail = this.fractalNoise(worldX * 0.005, worldZ * 0.005, 2);

                if (copseNoise > 0.3 && copseDetail > 0.1) {
                    density *= 8.0; // Dense copses
                } else if (copseNoise > 0.0) {
                    density *= 2.5; // Scattered trees near copses
                }

                // Individual scattered trees
                const scatterNoise = this.fractalNoise(worldX * 0.02, worldZ * 0.02, 1);
                if (scatterNoise > 0.6) {
                    density = Math.max(density, 0.4); // Isolated trees
                }
                break;

            case 5: // Mountain - altitude and aspect dependent
                density *= 0.6;

                // Simulate slope aspect effects (north vs south facing)
                const aspectNoise = this.fractalNoise(worldX * 0.0005, worldZ * 0.0005, 2);
                const slopeVariation = this.fractalNoise(worldX * 0.01, worldZ * 0.01, 3);

                // North-facing slopes (cooler, more trees)
                if (aspectNoise > 0.2) {
                    density *= 1.5 + slopeVariation * 0.3;
                } else {
                    density *= 0.8 + slopeVariation * 0.4;
                }

                // Treeline effects with natural variation
                const elevationFactor = Math.max(0.1, 1.0 - Math.abs(worldZ) * 0.0001);
                density *= elevationFactor;
                break;

            case 4: // Desert - oasis-like clustering with realistic spacing
                density *= 0.05;

                // Create sparse oasis-like vegetation clusters
                const oasisNoise = this.fractalNoise(worldX * 0.0003, worldZ * 0.0003, 4);
                const oasisDetail = this.fractalNoise(worldX * 0.003, worldZ * 0.003, 2);

                if (oasisNoise > 0.5 && oasisDetail > 0.3) {
                    density *= 15.0; // Dense oasis vegetation
                } else if (oasisNoise > 0.2) {
                    density *= 3.0; // Scattered desert vegetation
                }

                // Very sparse individual plants
                const sparsePlants = this.fractalNoise(worldX * 0.05, worldZ * 0.05, 1);
                if (sparsePlants > 0.8) {
                    density = Math.max(density, 0.1);
                }
                break;

            case 1: // Beach - coastal gradient effects
                density *= 0.2;

                // Vegetation density increases inland
                const coastalGradient = this.fractalNoise(worldX * 0.002, worldZ * 0.002, 3);
                const distanceFromWater = this.fractalNoise(worldX * 0.01, worldZ * 0.01, 2);

                density *= 0.3 + Math.max(0, coastalGradient * 0.7 + distanceFromWater * 0.5);

                // Dune vegetation clusters
                const duneNoise = this.fractalNoise(worldX * 0.005, worldZ * 0.005, 2);
                if (duneNoise > 0.4) {
                    density *= 2.0;
                }
                break;

            default:
                density *= 0.15;
                // Add some natural clustering even in undefined biomes
                const defaultCluster = this.fractalNoise(worldX * 0.003, worldZ * 0.003, 3);
                if (defaultCluster > 0.3) {
                    density *= 2.0;
                }
        }

        // Add multiple layers of randomness to prevent overly regular patterns
        const randomFactor1 = this.seededRandom(worldX + 0.5, worldZ + 0.5, this.seed + 5000);
        const randomFactor2 = this.seededRandom(worldX * 1.1, worldZ * 1.1, this.seed + 5001);
        const microRandomness = this.fractalNoise(worldX * 0.3, worldZ * 0.3, 1) * 0.1;

        // Combine different scales of randomness
        const combinedRandomness =
            randomFactor1 * 0.5 + randomFactor2 * 0.3 + microRandomness * 0.2;

        density *= 0.7 + combinedRandomness * 0.6; // ±30% random variation with natural clustering

        // Ensure density stays in valid range but allow for sparse and dense areas
        return Math.max(0, Math.min(1.2, density)); // Allow slight overdensity for natural clustering
    }

    /**
     * Get tree mesh data for rendering
     */
    public static generateTreeMesh(
        type: VegetationType,
        height: number,
        radius: number
    ): {
        vertices: Float32Array;
        indices: Uint32Array;
        normals: Float32Array;
        colors: Float32Array;
    } {
        // Simple cone shape for trees (will be replaced with proper models later)
        const segments = 8;
        const vertices: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];

        // Tree color based on type
        const treeColors: { [key in VegetationType]: [number, number, number] } = {
            [VegetationType.OAK_TREE]: [0.2, 0.4, 0.1],
            [VegetationType.PINE_TREE]: [0.1, 0.3, 0.1],
            [VegetationType.BIRCH_TREE]: [0.3, 0.5, 0.2],
            [VegetationType.PALM_TREE]: [0.3, 0.4, 0.2],
            [VegetationType.BUSH]: [0.2, 0.5, 0.1],
            [VegetationType.GRASS_PATCH]: [0.3, 0.6, 0.1],
            [VegetationType.FERN]: [0.2, 0.4, 0.1],
            [VegetationType.CACTUS]: [0.3, 0.5, 0.2],
        };

        const color = treeColors[type];

        // Add trunk (cylinder)
        const trunkHeight = height * 0.3;
        const trunkRadius = radius * 0.2;

        // Add canopy (cone or sphere depending on tree type)
        const canopyHeight = height * 0.7;
        const canopyRadius = radius;

        // Generate trunk vertices
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * trunkRadius;
            const z = Math.sin(angle) * trunkRadius;

            // Bottom vertex
            vertices.push(x, 0, z);
            normals.push(x / trunkRadius, 0, z / trunkRadius);
            colors.push(0.3, 0.2, 0.1, 1); // Brown trunk

            // Top vertex
            vertices.push(x, trunkHeight, z);
            normals.push(x / trunkRadius, 0, z / trunkRadius);
            colors.push(0.3, 0.2, 0.1, 1); // Brown trunk
        }

        // Generate canopy vertices
        const canopyBase = trunkHeight;

        // Center point at top
        vertices.push(0, height, 0);
        normals.push(0, 1, 0);
        colors.push(...color, 1);
        const topIndex = vertices.length / 3 - 1;

        // Base of canopy
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * canopyRadius;
            const z = Math.sin(angle) * canopyRadius;

            vertices.push(x, canopyBase, z);
            const len = Math.sqrt(x * x + canopyHeight * canopyHeight + z * z);
            normals.push(x / len, canopyHeight / len, z / len);
            colors.push(...color, 1);
        }

        // Generate trunk indices
        for (let i = 0; i < segments; i++) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2);
            indices.push(base + 1, base + 3, base + 2);
        }

        // Generate canopy indices
        const canopyBaseIndex = (segments + 1) * 2;
        for (let i = 0; i < segments; i++) {
            indices.push(topIndex, canopyBaseIndex + i + 1, canopyBaseIndex + i);
        }

        return {
            vertices: new Float32Array(vertices),
            indices: new Uint32Array(indices),
            normals: new Float32Array(normals),
            colors: new Float32Array(colors),
        };
    }
}
