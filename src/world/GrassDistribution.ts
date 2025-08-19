import { Vector3 } from '../core/math';
import { BIOME_CONFIG } from './WorldConstants';
import type { TerrainTile } from './TerrainTile';
import type { GrassType } from './VegetationSystem';

/**
 * Grass distribution zone with biome-specific parameters
 */
export interface GrassZone {
    biomeId: number;
    grassTypes: number[];
    baseDensity: number;
    elevationRange: { min: number; max: number };
    slopeThreshold: number;
    moisturePreference: number; // 0 = dry, 1 = wet
    temperatureRange: { min: number; max: number };
    seasonalVariation: number; // How much grass changes with seasons
}

/**
 * Grass cluster for natural distribution patterns
 */
export interface GrassCluster {
    center: Vector3;
    radius: number;
    density: number;
    grassType: number;
    biomeId: number;
    healthFactor: number; // 0-1, affects color and density
}

/**
 * Advanced grass distribution system that creates realistic grass patterns
 * based on biome data, terrain features, and environmental factors
 */
export class GrassDistribution {
    private grassZones: Map<number, GrassZone> = new Map();
    private grassClusters: Map<string, GrassCluster[]> = new Map(); // Keyed by tile ID
    private seed: number;
    private random: () => number;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.random = this.createSeededRandom(seed);
        this.initializeGrassZones();
    }

    /**
     * Initialize grass zones for different biomes
     */
    private initializeGrassZones(): void {
        // Grassland - highest grass density
        this.grassZones.set(BIOME_CONFIG.BIOMES.GRASSLAND.id, {
            biomeId: BIOME_CONFIG.BIOMES.GRASSLAND.id,
            grassTypes: [0, 1], // Temperate and dry grass
            baseDensity: 0.8,
            elevationRange: { min: 0, max: 1200 },
            slopeThreshold: Math.PI / 4, // 45 degrees
            moisturePreference: 0.6,
            temperatureRange: { min: 5, max: 30 },
            seasonalVariation: 0.7,
        });

        // Forest - sparse undergrowth grass
        this.grassZones.set(BIOME_CONFIG.BIOMES.FOREST.id, {
            biomeId: BIOME_CONFIG.BIOMES.FOREST.id,
            grassTypes: [0, 2], // Temperate and lush grass
            baseDensity: 0.3,
            elevationRange: { min: 0, max: 1500 },
            slopeThreshold: Math.PI / 3, // 60 degrees
            moisturePreference: 0.7,
            temperatureRange: { min: 0, max: 25 },
            seasonalVariation: 0.5,
        });

        // Beach - sparse beach grass
        this.grassZones.set(BIOME_CONFIG.BIOMES.BEACH.id, {
            biomeId: BIOME_CONFIG.BIOMES.BEACH.id,
            grassTypes: [1, 3], // Dry and alpine grass (hardy varieties)
            baseDensity: 0.2,
            elevationRange: { min: 0, max: 50 },
            slopeThreshold: Math.PI / 6, // 30 degrees
            moisturePreference: 0.4,
            temperatureRange: { min: 10, max: 35 },
            seasonalVariation: 0.3,
        });

        // Tundra - hardy, sparse grass
        this.grassZones.set(BIOME_CONFIG.BIOMES.TUNDRA.id, {
            biomeId: BIOME_CONFIG.BIOMES.TUNDRA.id,
            grassTypes: [3], // Alpine grass only
            baseDensity: 0.4,
            elevationRange: { min: 0, max: 2000 },
            slopeThreshold: Math.PI / 3,
            moisturePreference: 0.5,
            temperatureRange: { min: -20, max: 15 },
            seasonalVariation: 0.9,
        });

        // Wetland - dense, moisture-loving grass
        this.grassZones.set(BIOME_CONFIG.BIOMES.WETLAND.id, {
            biomeId: BIOME_CONFIG.BIOMES.WETLAND.id,
            grassTypes: [2], // Lush grass
            baseDensity: 0.9,
            elevationRange: { min: -10, max: 100 },
            slopeThreshold: Math.PI / 8, // 22.5 degrees (flat areas)
            moisturePreference: 1.0,
            temperatureRange: { min: 5, max: 30 },
            seasonalVariation: 0.6,
        });

        // Mountain - sparse alpine grass
        this.grassZones.set(BIOME_CONFIG.BIOMES.MOUNTAIN.id, {
            biomeId: BIOME_CONFIG.BIOMES.MOUNTAIN.id,
            grassTypes: [3], // Alpine grass
            baseDensity: 0.25,
            elevationRange: { min: 800, max: 3000 },
            slopeThreshold: Math.PI / 2.5, // 72 degrees (steep slopes)
            moisturePreference: 0.3,
            temperatureRange: { min: -10, max: 20 },
            seasonalVariation: 0.8,
        });
    }

    /**
     * Generate grass distribution for a terrain tile
     */
    public generateGrassDistribution(
        tile: TerrainTile,
        grassTypes: Map<number, GrassType>,
        environmentalFactors: {
            temperature: number;
            moisture: number;
            season: number; // 0-1, where 0 = spring, 0.5 = autumn, etc.
        } = { temperature: 15, moisture: 0.6, season: 0.25 }
    ): GrassCluster[] {
        if (!tile.terrainData) {
            return [];
        }

        console.log(`GrassDistribution: Generating grass for tile ${tile.id}`);

        const clusters: GrassCluster[] = [];
        const { heightmap, materials, slopes, waterMask } = tile.terrainData;
        const resolution = Math.sqrt(heightmap.length);
        const step = tile.size / (resolution - 1);

        // Reset random seed for consistent generation
        this.random = this.createSeededRandom(this.seed + tile.x * 1000 + tile.z);

        // Analyze tile for biome composition and suitable grass areas
        const biomeAnalysis = this.analyzeTileBiomes(materials);

        for (const [biomeId, coverage] of biomeAnalysis) {
            const grassZone = this.grassZones.get(biomeId);
            if (!grassZone || coverage < 0.01) continue; // Skip biomes with < 1% coverage

            console.log(
                `GrassDistribution: Processing biome ${biomeId} with ${(coverage * 100).toFixed(1)}% coverage`
            );

            // Generate clusters for this biome
            const biomeClusters = this.generateClustersForBiome(
                tile,
                grassZone,
                grassTypes,
                environmentalFactors,
                coverage,
                heightmap,
                materials,
                slopes,
                waterMask,
                step,
                resolution
            );

            clusters.push(...biomeClusters);
        }

        console.log(
            `GrassDistribution: Generated ${clusters.length} grass clusters for tile ${tile.id}`
        );
        this.grassClusters.set(tile.id, clusters);
        return clusters;
    }

    /**
     * Analyze biome composition of a tile
     */
    private analyzeTileBiomes(materials: Uint8Array): Map<number, number> {
        const biomeCount = new Map<number, number>();
        const totalPixels = materials.length;

        // Count biome occurrences
        for (let i = 0; i < materials.length; i++) {
            const biome = materials[i];
            biomeCount.set(biome, (biomeCount.get(biome) || 0) + 1);
        }

        // Convert to coverage percentages
        const biomeCoverage = new Map<number, number>();
        for (const [biome, count] of biomeCount) {
            biomeCoverage.set(biome, count / totalPixels);
        }

        return biomeCoverage;
    }

    /**
     * Generate grass clusters for a specific biome
     */
    private generateClustersForBiome(
        tile: TerrainTile,
        grassZone: GrassZone,
        grassTypes: Map<number, GrassType>,
        environmentalFactors: { temperature: number; moisture: number; season: number },
        biomeCoverage: number,
        heightmap: Float32Array,
        materials: Uint8Array,
        slopes: Float32Array,
        waterMask: Uint8Array,
        step: number,
        resolution: number
    ): GrassCluster[] {
        const clusters: GrassCluster[] = [];
        const tileWorldX = tile.x * tile.size;
        const tileWorldZ = tile.z * tile.size;

        // Calculate cluster count based on biome coverage and base density
        const baseClusterCount = Math.floor(biomeCoverage * grassZone.baseDensity * 100);
        const environmentalMultiplier = this.calculateEnvironmentalMultiplier(
            grassZone,
            environmentalFactors
        );
        const clusterCount = Math.max(1, Math.floor(baseClusterCount * environmentalMultiplier));

        for (let i = 0; i < clusterCount; i++) {
            // Find a suitable location for this cluster
            const location = this.findSuitableClusterLocation(
                grassZone,
                environmentalFactors,
                heightmap,
                materials,
                slopes,
                waterMask,
                step,
                resolution,
                tile.size
            );

            if (!location) continue;

            const worldX = tileWorldX + location.x;
            const worldZ = tileWorldZ + location.z;
            const worldY = location.elevation;

            // Select grass type for this cluster
            const grassTypeId = this.selectGrassType(grassZone, environmentalFactors, location);
            const grassType = grassTypes.get(grassTypeId);
            if (!grassType) continue;

            // Calculate cluster properties
            const clusterRadius = this.calculateClusterRadius(grassZone, grassType, location);
            const clusterDensity = this.calculateClusterDensity(
                grassZone,
                environmentalFactors,
                location
            );
            const healthFactor = this.calculateHealthFactor(
                grassZone,
                environmentalFactors,
                location
            );

            clusters.push({
                center: new Vector3(worldX, worldY, worldZ),
                radius: clusterRadius,
                density: clusterDensity,
                grassType: grassTypeId,
                biomeId: grassZone.biomeId,
                healthFactor,
            });
        }

        return clusters;
    }

    /**
     * Calculate environmental multiplier for grass growth
     */
    private calculateEnvironmentalMultiplier(
        grassZone: GrassZone,
        factors: { temperature: number; moisture: number; season: number }
    ): number {
        let multiplier = 1.0;

        // Temperature factor
        const tempRange = grassZone.temperatureRange;
        if (factors.temperature < tempRange.min || factors.temperature > tempRange.max) {
            const tempDiff = Math.min(
                Math.abs(factors.temperature - tempRange.min),
                Math.abs(factors.temperature - tempRange.max)
            );
            multiplier *= Math.max(0.1, 1.0 - tempDiff / 20.0);
        }

        // Moisture factor
        const moistureDiff = Math.abs(factors.moisture - grassZone.moisturePreference);
        multiplier *= Math.max(0.2, 1.0 - moistureDiff);

        // Seasonal factor
        const seasonalEffect =
            1.0 + grassZone.seasonalVariation * Math.sin(factors.season * Math.PI * 2);
        multiplier *= Math.max(0.1, seasonalEffect);

        return multiplier;
    }

    /**
     * Find a suitable location for a grass cluster
     */
    private findSuitableClusterLocation(
        grassZone: GrassZone,
        environmentalFactors: { temperature: number; moisture: number; season: number },
        heightmap: Float32Array,
        materials: Uint8Array,
        slopes: Float32Array,
        waterMask: Uint8Array,
        step: number,
        resolution: number,
        tileSize: number
    ): { x: number; z: number; elevation: number } | null {
        // Try multiple random locations
        for (let attempt = 0; attempt < 50; attempt++) {
            const x = this.random() * tileSize;
            const z = this.random() * tileSize;

            // Sample terrain data at this location
            const terrainData = this.sampleTerrainData(
                x,
                z,
                heightmap,
                materials,
                slopes,
                waterMask,
                step,
                resolution
            );

            if (!terrainData) continue;

            // Check if location is suitable
            if (this.isLocationSuitable(grassZone, terrainData)) {
                return { x, z, elevation: terrainData.elevation };
            }
        }

        return null;
    }

    /**
     * Sample terrain data at a specific position
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
        const fx = x / step;
        const fz = z / step;

        const clampedFx = Math.max(0, Math.min(resolution - 1.001, fx));
        const clampedFz = Math.max(0, Math.min(resolution - 1.001, fz));

        const ix = Math.floor(clampedFx);
        const iz = Math.floor(clampedFz);

        const tx = clampedFx - ix;
        const tz = clampedFz - iz;

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

        const nearestIndex = Math.round(clampedFz) * resolution + Math.round(clampedFx);

        return {
            elevation,
            biome: materials[nearestIndex],
            slope: slopes[nearestIndex],
            isWater: waterMask[nearestIndex] > 0,
        };
    }

    /**
     * Check if a location is suitable for grass
     */
    private isLocationSuitable(grassZone: GrassZone, terrainData: any): boolean {
        // Check water
        if (terrainData.isWater && grassZone.moisturePreference < 0.8) {
            return false;
        }

        // Check biome
        if (terrainData.biome !== grassZone.biomeId) {
            return false;
        }

        // Check elevation
        if (
            terrainData.elevation < grassZone.elevationRange.min ||
            terrainData.elevation > grassZone.elevationRange.max
        ) {
            return false;
        }

        // Check slope
        if (terrainData.slope > grassZone.slopeThreshold) {
            return false;
        }

        return true;
    }

    /**
     * Select appropriate grass type for environmental conditions
     */
    private selectGrassType(
        grassZone: GrassZone,
        environmentalFactors: { temperature: number; moisture: number; season: number },
        location: { elevation: number }
    ): number {
        const availableTypes = grassZone.grassTypes;
        if (availableTypes.length === 1) {
            return availableTypes[0];
        }

        // Simple selection based on elevation and moisture
        if (environmentalFactors.moisture > 0.7) {
            // Prefer lush grass types in wet conditions
            return availableTypes.find((t) => t === 2) || availableTypes[0]; // Type 2 = lush
        } else if (environmentalFactors.moisture < 0.4) {
            // Prefer dry grass types in arid conditions
            return availableTypes.find((t) => t === 1) || availableTypes[0]; // Type 1 = dry
        } else if (location.elevation > 1000) {
            // Prefer alpine grass at high elevation
            return availableTypes.find((t) => t === 3) || availableTypes[0]; // Type 3 = alpine
        }

        // Default to temperate grass
        return availableTypes.find((t) => t === 0) || availableTypes[0]; // Type 0 = temperate
    }

    /**
     * Calculate cluster radius based on grass zone and type
     */
    private calculateClusterRadius(
        grassZone: GrassZone,
        grassType: GrassType,
        location: { elevation: number }
    ): number {
        const baseRadius = grassType.patchSize * 5; // Base cluster size
        const densityFactor = grassZone.baseDensity; // Higher density = smaller clusters
        const elevationFactor = 1.0 - Math.min(location.elevation / 2000, 0.5); // Smaller at high elevation

        return baseRadius * densityFactor * elevationFactor * (0.8 + this.random() * 0.4);
    }

    /**
     * Calculate cluster density
     */
    private calculateClusterDensity(
        grassZone: GrassZone,
        environmentalFactors: { temperature: number; moisture: number; season: number },
        location: { elevation: number }
    ): number {
        const baseDensity = grassZone.baseDensity;
        const environmentalMultiplier = this.calculateEnvironmentalMultiplier(
            grassZone,
            environmentalFactors
        );
        const elevationFactor = Math.max(0.3, 1.0 - location.elevation / 3000); // Reduce density at high elevation

        return baseDensity * environmentalMultiplier * elevationFactor;
    }

    /**
     * Calculate health factor affecting grass appearance
     */
    private calculateHealthFactor(
        grassZone: GrassZone,
        environmentalFactors: { temperature: number; moisture: number; season: number },
        location: { elevation: number }
    ): number {
        let health = 1.0;

        // Temperature stress
        const tempRange = grassZone.temperatureRange;
        const tempOptimal = (tempRange.min + tempRange.max) / 2;
        const tempStress = Math.abs(environmentalFactors.temperature - tempOptimal) / 20.0;
        health *= Math.max(0.3, 1.0 - tempStress);

        // Moisture stress
        const moistureStress = Math.abs(
            environmentalFactors.moisture - grassZone.moisturePreference
        );
        health *= Math.max(0.4, 1.0 - moistureStress);

        // Elevation stress
        const elevationStress =
            Math.max(0, location.elevation - grassZone.elevationRange.max * 0.8) / 1000;
        health *= Math.max(0.5, 1.0 - elevationStress);

        // Seasonal factor
        const seasonalHealth =
            0.7 + 0.3 * Math.sin(environmentalFactors.season * Math.PI * 2 + Math.PI / 2);
        health *= seasonalHealth;

        return Math.max(0.2, Math.min(1.0, health));
    }

    /**
     * Get grass clusters for a specific tile
     */
    public getGrassClustersForTile(tileId: string): GrassCluster[] {
        return this.grassClusters.get(tileId) || [];
    }

    /**
     * Clear grass data for a tile
     */
    public clearGrassForTile(tileId: string): void {
        this.grassClusters.delete(tileId);
    }

    /**
     * Clear all grass data
     */
    public clearAll(): void {
        this.grassClusters.clear();
    }

    /**
     * Get statistics about grass distribution
     */
    public getStats() {
        let totalClusters = 0;
        let totalBiomes = new Set<number>();

        for (const clusters of this.grassClusters.values()) {
            totalClusters += clusters.length;
            for (const cluster of clusters) {
                totalBiomes.add(cluster.biomeId);
            }
        }

        return {
            totalTiles: this.grassClusters.size,
            totalClusters,
            averageClustersPerTile: totalClusters / Math.max(1, this.grassClusters.size),
            biomesWithGrass: totalBiomes.size,
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
