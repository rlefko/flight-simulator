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
 * Generates realistic vegetation placement for terrain tiles
 */
export class VegetationGenerator {
    private seed: number;
    private treeConfigs: Map<number, TreeConfig[]> = new Map();
    private permutation: Uint8Array;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.initializeTreeConfigs();
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
        // Forest biome trees
        this.treeConfigs.set(3, [
            {
                type: VegetationType.OAK_TREE,
                minHeight: 15,
                maxHeight: 25,
                minRadius: 3,
                maxRadius: 6,
                density: 150,
                clusterProbability: 0.7,
                color: [0.2, 0.4, 0.1],
            },
            {
                type: VegetationType.BIRCH_TREE,
                minHeight: 12,
                maxHeight: 20,
                minRadius: 2,
                maxRadius: 4,
                density: 100,
                clusterProbability: 0.5,
                color: [0.3, 0.5, 0.2],
            },
        ]);

        // Grassland biome trees (sparse)
        this.treeConfigs.set(2, [
            {
                type: VegetationType.OAK_TREE,
                minHeight: 10,
                maxHeight: 18,
                minRadius: 3,
                maxRadius: 5,
                density: 15,
                clusterProbability: 0.3,
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
                density: 80,
                clusterProbability: 0.6,
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
                density: 12,
                clusterProbability: 0.4,
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
                density: 8,
                clusterProbability: 0.1,
                color: [0.3, 0.5, 0.2],
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
                const targetTreeCount = Math.round(config.density * tileAreaKm2 * 0.05); // Increased density

                if (targetTreeCount === 0) continue;

                // Use Poisson disk sampling for natural distribution
                const minDistance = Math.sqrt(1000000 / config.density) * 0.5; // Minimum spacing between trees
                const samples = this.generatePoissonDiskSamples(
                    tileSize,
                    tileSize,
                    minDistance,
                    targetTreeCount * 2, // Generate extra samples to filter
                    worldX,
                    worldZ,
                    this.seed + biomeId * 1000
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

                    // Check forest density using noise for natural clustering
                    const forestDensity = this.getForestDensity(worldPosX, worldPosZ, biomeId);
                    const placementRandom = this.seededRandom(
                        worldPosX,
                        worldPosZ,
                        this.seed + 1000
                    );

                    if (placementRandom > forestDensity) continue;

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

                    // Add cluster of trees if configured
                    if (placementRandom < config.clusterProbability) {
                        const clusterInstances = this.generateTreeCluster(
                            config,
                            worldPosX,
                            worldPosZ,
                            terrainSample.elevation,
                            terrainData,
                            tileSize,
                            resolution,
                            placementRandom
                        );
                        instances.push(...clusterInstances);
                    }
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

        // Start with a random initial point
        const initial = new Vector3(random() * width, 0, random() * height);
        this.addSampleToGrid(initial, grid, cellSize, active, samples);

        // Generate samples around existing points
        while (active.length > 0 && samples.length < maxSamples) {
            const randomIndex = Math.floor(random() * active.length);
            const point = active[randomIndex];
            let found = false;

            // Try to find a valid point around the selected point
            for (let i = 0; i < 30; i++) {
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
     * Generate point around existing point for Poisson disk sampling
     */
    private generatePointAround(
        center: Vector3,
        minDistance: number,
        random: () => number
    ): Vector3 {
        const angle = random() * Math.PI * 2;
        const distance = minDistance * (1 + random());

        return new Vector3(
            center.x + Math.cos(angle) * distance,
            0,
            center.z + Math.sin(angle) * distance
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
     * Generate tree cluster around a main tree
     */
    private generateTreeCluster(
        config: TreeConfig,
        centerX: number,
        centerZ: number,
        baseElevation: number,
        terrainData: TerrainData,
        tileSize: number,
        resolution: number,
        randomSeed: number
    ) {
        const instances = [];
        const clusterSize = 3 + Math.floor(randomSeed * 4); // 3-6 trees in cluster
        const clusterRadius = 8 + randomSeed * 12; // 8-20 meter cluster radius

        for (let i = 0; i < clusterSize; i++) {
            const angle = (i / clusterSize) * Math.PI * 2 + randomSeed * Math.PI;
            const distance = clusterRadius * (0.4 + randomSeed * 0.6);

            const treeX = centerX + Math.cos(angle) * distance;
            const treeZ = centerZ + Math.sin(angle) * distance;

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

            // Create cluster tree instance (slightly smaller)
            const instance = this.createTreeInstance(
                {
                    ...config,
                    minHeight: config.minHeight * 0.8,
                    maxHeight: config.maxHeight * 0.9,
                    minRadius: config.minRadius * 0.8,
                    maxRadius: config.maxRadius * 0.9,
                },
                treeX,
                clusterSample.elevation,
                treeZ,
                treeX + treeZ + i * 1000 // Unique seed for each cluster tree
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

        // Use multiple noise scales for natural clustering patterns
        const largeScaleNoise = this.fractalNoise(worldX * 0.0003, worldZ * 0.0003, 4); // Large forest areas (3km scale)
        const mediumScaleNoise = this.fractalNoise(worldX * 0.0015, worldZ * 0.0015, 3); // Medium clusters (700m scale)
        const smallScaleNoise = this.fractalNoise(worldX * 0.008, worldZ * 0.008, 2); // Small clearings (125m scale)
        const microScaleNoise = this.fractalNoise(worldX * 0.04, worldZ * 0.04, 2); // Micro variations (25m scale)

        // Combine noise layers with realistic weightings
        let density =
            largeScaleNoise * 0.5 +
            mediumScaleNoise * 0.25 +
            smallScaleNoise * 0.15 +
            microScaleNoise * 0.1;

        // Normalize to 0-1 range
        density = (density + 1.0) * 0.5;

        // Apply biome-specific clustering patterns
        switch (biomeId) {
            case 3: // Forest biome - dense with clearings
                density = Math.max(0.5, density); // Minimum 50% forest coverage
                // Add natural clearings using additional noise
                const clearingNoise = this.fractalNoise(worldX * 0.001, worldZ * 0.001, 2);
                if (clearingNoise < -0.4) {
                    density *= 0.2; // Create natural clearings
                }
                break;

            case 2: // Grassland - scattered trees in groups
                density *= 0.25;
                // Create tree groves using clustered noise
                const groveNoise = this.fractalNoise(worldX * 0.002, worldZ * 0.002, 3);
                if (groveNoise > 0.3) {
                    density *= 3.0; // Boost density in grove areas
                }
                break;

            case 5: // Mountain - elevation and slope dependent
                density *= 0.6;
                // Simulate treeline effects (less dense at higher altitudes)
                const elevationFactor = Math.max(0, 1.0 - worldZ * 0.0001); // Rough elevation proxy
                density *= elevationFactor;
                break;

            case 4: // Desert - very sparse, oasis-like clustering
                density *= 0.03;
                // Create rare oasis-like clusters
                const oasisNoise = this.fractalNoise(worldX * 0.0008, worldZ * 0.0008, 2);
                if (oasisNoise > 0.6) {
                    density *= 5.0; // Dense vegetation near water sources
                }
                break;

            case 1: // Beach - sparse coastal vegetation
                density *= 0.15;
                // Denser vegetation away from water
                const coastalNoise = this.fractalNoise(worldX * 0.005, worldZ * 0.005, 2);
                density *= 0.5 + coastalNoise * 0.5;
                break;

            default:
                density *= 0.1; // Default sparse coverage for unknown biomes
        }

        // Add some randomness to prevent overly regular patterns
        const randomFactor = this.seededRandom(worldX, worldZ, this.seed + 5000);
        density *= 0.8 + randomFactor * 0.4; // ±20% random variation

        return Math.max(0, Math.min(1, density));
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
