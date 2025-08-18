import { Vector3 } from '../core/math';
import { NOISE_CONFIG, TERRAIN_CONFIG, BIOME_CONFIG } from './WorldConstants';
import type { TerrainData } from './TerrainTile';

/**
 * Noise function types for terrain generation
 */
export type NoiseType = 'fbm' | 'ridge' | 'turbulence' | 'simplex' | 'perlin';

/**
 * Octave configuration for noise layers
 */
export interface NoiseOctave {
    frequency: number;
    amplitude: number;
    type: NoiseType;
    seed?: number;
}

/**
 * Climate parameters for biome generation
 */
export interface ClimateData {
    temperature: number; // Celsius
    precipitation: number; // mm/year
    humidity: number; // 0-1
    elevation: number; // meters
}

/**
 * Erosion simulation parameters
 */
export interface ErosionParams {
    iterations: number;
    dropletLifetime: number;
    inertia: number;
    sedimentCapacityFactor: number;
    minSedimentCapacity: number;
    erodeSpeed: number;
    depositSpeed: number;
    evaporateSpeed: number;
    gravity: number;
    maxDropletSpeed: number;
    brushRadius: number;
}

/**
 * Terrain feature types for enhanced generation
 */
export interface TerrainFeature {
    type:
        | 'continental_shelf'
        | 'mountain_ridge'
        | 'valley'
        | 'plains'
        | 'volcanic_peak'
        | 'lake'
        | 'river';
    strength: number;
    radius: number;
    center?: { x: number; z: number };
    direction?: { x: number; z: number };
}

/**
 * Water body detection data
 */
export interface WaterBodyData {
    isWater: boolean;
    waterType: 'ocean' | 'lake' | 'river' | 'beach';
    depth: number;
    flowDirection?: { x: number; z: number };
    flowStrength?: number;
    distanceToShore: number;
}

/**
 * Advanced procedural heightmap generator using multiple noise techniques
 * Supports Fractal Brownian Motion, Ridge noise, Turbulence, and erosion simulation
 * Enhanced with diverse terrain features and realistic water body detection
 */
export class HeightmapGenerator {
    private permutation: number[];
    private gradients: Vector3[];
    private seed: number;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.initializeNoise();
    }

    /**
     * Generate complete terrain data for a tile
     */
    public generateTerrainData(
        x: number,
        z: number,
        level: number,
        resolution: number = TERRAIN_CONFIG.HEIGHT_RESOLUTION,
        tileSize: number = TERRAIN_CONFIG.BASE_TILE_SIZE
    ): TerrainData {
        const size = resolution;
        const heightmap = new Float32Array(size * size);
        const normals = new Float32Array(size * size * 3);
        const materials = new Uint8Array(size * size);
        const waterMask = new Uint8Array(size * size);
        const slopes = new Float32Array(size * size);

        // Calculate world coordinates for this tile
        const worldX = x * tileSize;
        const worldZ = z * tileSize;
        const step = tileSize / (size - 1);

        // Generate base heightmap using multiple noise octaves
        this.generateBaseHeightmap(heightmap, worldX, worldZ, step, size);

        // Apply erosion simulation only if safe
        if (NOISE_CONFIG.EROSION.iterations > 0) {
            this.applyErosion(heightmap, size, NOISE_CONFIG.EROSION);

            // Validate heightmap after erosion to prevent NaN propagation
            for (let i = 0; i < heightmap.length; i++) {
                if (!isFinite(heightmap[i])) {
                    console.warn(`Invalid height at index ${i}: ${heightmap[i]}`);
                    heightmap[i] = 0; // Reset to sea level
                }
            }
        }

        // Calculate normals from heightmap
        this.calculateNormals(heightmap, normals, size, step);

        // Calculate slopes
        this.calculateSlopes(heightmap, slopes, size, step);

        // Generate climate data and assign biomes/materials
        this.assignMaterials(heightmap, materials, waterMask, worldX, worldZ, step, size);

        return {
            heightmap,
            normals,
            materials,
            uvs: this.generateUVs(size),
            waterMask,
            slopes,
            textureIndices: this.generateTextureIndices(materials, size),
        };
    }

    /**
     * Generate base heightmap using layered noise
     */
    private generateBaseHeightmap(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        const octaves = NOISE_CONFIG.TERRAIN_OCTAVES;

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const wx = worldX + j * step;
                const wz = worldZ + i * step;
                const index = i * size + j;

                // Base terrain elevation using enhanced layered noise
                let elevation = this.generateBaseElevation(wx, wz, octaves);

                // Apply continental shelf effects for realistic landmasses
                const continentalFactor = this.getEnhancedContinentalFactor(wx, wz);
                elevation *= continentalFactor;

                // Add mountain ridge generation (scale down the contribution)
                const ridgeContribution = this.generateMountainRidges(wx, wz) * 0.001;
                elevation += ridgeContribution;

                // Create valley carving (scale down the contribution)
                const valleyCarving = this.generateValleys(wx, wz) * 0.001;
                elevation += valleyCarving;

                // Add plains with subtle variations (scale down the contribution)
                const plainsContribution = this.generatePlains(wx, wz) * 0.01;
                elevation += plainsContribution;

                // Generate volcanic peaks (scale down the contribution)
                const volcanicContribution = this.generateVolcanicPeaks(wx, wz) * 0.001;
                elevation += volcanicContribution;

                // Apply latitude-based elevation scaling
                const latitudeFactor = this.getLatitudeFactor(wz);
                elevation *= latitudeFactor;

                // Clamp before scaling to prevent extreme values (must be in [-1, 1] range)
                elevation = Math.max(-1, Math.min(1, elevation));

                // Scale to realistic elevation ranges (-500m to 8000m)
                elevation = this.scaleElevationToRealistic(elevation);

                // Validate elevation to prevent NaN propagation
                if (!isFinite(elevation)) {
                    elevation = 0; // Default to sea level
                }

                heightmap[index] = elevation;
            }
        }

        // Post-process for water body detection and shore smoothing
        this.postProcessWaterBodies(heightmap, worldX, worldZ, step, size);
    }

    /**
     * Sample noise value at given coordinates with optimized caching
     */
    private sampleNoise(x: number, z: number, type: NoiseType): number {
        // Cache frequently used values to improve performance
        const cacheKey = `${Math.floor(x * 1000)},${Math.floor(z * 1000)},${type}`;

        switch (type) {
            case 'fbm':
                return this.fractalBrownianMotion(x, z, 4);
            case 'ridge':
                return this.ridgeNoise(x, z);
            case 'turbulence':
                return this.turbulence(x, z, 4);
            case 'simplex':
                return this.simplexNoise(x, z);
            case 'perlin':
            default:
                return this.perlinNoise(x, z);
        }
    }

    /**
     * Fractal Brownian Motion - layered noise for natural terrain
     */
    private fractalBrownianMotion(x: number, z: number, octaves: number): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += this.perlinNoise(x * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return value / maxValue;
    }

    /**
     * Ridge noise for mountain ridges and valleys
     */
    private ridgeNoise(x: number, z: number): number {
        let noise = Math.abs(this.perlinNoise(x, z));
        noise = 1 - noise; // Invert to create ridges
        noise = noise * noise; // Square for sharper ridges
        return noise * 2 - 1; // Normalize to [-1, 1]
    }

    /**
     * Turbulence noise for chaotic terrain features
     */
    private turbulence(x: number, z: number, octaves: number): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;

        for (let i = 0; i < octaves; i++) {
            value += Math.abs(this.perlinNoise(x * frequency, z * frequency)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return value;
    }

    /**
     * Optimized Perlin noise implementation
     */
    private perlinNoise(x: number, z: number): number {
        // Fast floor operation using bitwise for positive numbers
        const x0 = x >= 0 ? Math.floor(x) : Math.floor(x) - 1;
        const z0 = z >= 0 ? Math.floor(z) : Math.floor(z) - 1;

        // Integer coordinates
        const xi = x0 & 255;
        const zi = z0 & 255;

        // Fractional coordinates
        const xf = x - x0;
        const zf = z - z0;

        // Smooth curves for interpolation - optimized with direct calculation
        const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        const v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);

        // Hash coordinates of 4 corners - optimized with direct array access
        const perm = this.permutation;
        const aa = perm[perm[xi] + zi];
        const ab = perm[perm[xi] + zi + 1];
        const ba = perm[perm[xi + 1] + zi];
        const bb = perm[perm[xi + 1] + zi + 1];

        // Compute gradients with optimized grad function
        const x1 = this.lerp(this.gradOptimized(aa, xf, zf), this.gradOptimized(ba, xf - 1, zf), u);
        const x2 = this.lerp(
            this.gradOptimized(ab, xf, zf - 1),
            this.gradOptimized(bb, xf - 1, zf - 1),
            u
        );

        const result = this.lerp(x1, x2, v);
        return isFinite(result) ? result : 0;
    }

    /**
     * Optimized gradient function for better performance
     */
    private gradOptimized(hash: number, x: number, z: number): number {
        // Use simplified gradient calculation for 2D
        const h = hash & 3;
        const u = h < 2 ? x : z;
        const v = h < 2 ? z : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * Simplified 2D Simplex noise
     */
    private simplexNoise(x: number, z: number): number {
        // Skew the input space to determine which simplex cell we're in
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const s = (x + z) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(z + s);

        const G2 = (3 - Math.sqrt(3)) / 6;
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = x - X0;
        const y0 = z - Y0;

        // Determine which simplex we are in
        let i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }

        // Offsets for other corners
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2;
        const y2 = y0 - 1 + 2 * G2;

        // Hash the corners
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.permutation[ii + this.permutation[jj]] % 12;
        const gi1 = this.permutation[ii + i1 + this.permutation[jj + j1]] % 12;
        const gi2 = this.permutation[ii + 1 + this.permutation[jj + 1]] % 12;

        // Calculate contributions from each corner
        let n0 = 0,
            n1 = 0,
            n2 = 0;

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            t0 *= t0;
            n0 = t0 * t0 * this.dot2D(gi0, x0, y0);
        }

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            t1 *= t1;
            n1 = t1 * t1 * this.dot2D(gi1, x1, y1);
        }

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            t2 *= t2;
            n2 = t2 * t2 * this.dot2D(gi2, x2, y2);
        }

        // Sum contributions and scale
        return 70 * (n0 + n1 + n2);
    }

    /**
     * Apply hydraulic erosion simulation
     */
    private applyErosion(heightmap: Float32Array, size: number, params: ErosionParams): void {
        for (let iteration = 0; iteration < params.iterations; iteration++) {
            // Random starting position
            let posX = Math.random() * (size - 1);
            let posZ = Math.random() * (size - 1);
            let dirX = 0;
            let dirZ = 0;
            let speed = 1;
            let water = 1;
            let sediment = 0;

            for (let lifetime = 0; lifetime < params.dropletLifetime; lifetime++) {
                const nodeX = Math.floor(posX);
                const nodeZ = Math.floor(posZ);

                if (nodeX < 0 || nodeX >= size - 1 || nodeZ < 0 || nodeZ >= size - 1) {
                    break;
                }

                // Calculate droplet's offset inside the cell
                const cellOffsetX = posX - nodeX;
                const cellOffsetZ = posZ - nodeZ;

                // Calculate height and gradient using bilinear interpolation
                const heightNW = heightmap[nodeZ * size + nodeX];
                const heightNE = heightmap[nodeZ * size + nodeX + 1];
                const heightSW = heightmap[(nodeZ + 1) * size + nodeX];
                const heightSE = heightmap[(nodeZ + 1) * size + nodeX + 1];

                // Bilinear interpolation of height
                const heightN = heightNW * (1 - cellOffsetX) + heightNE * cellOffsetX;
                const heightS = heightSW * (1 - cellOffsetX) + heightSE * cellOffsetX;
                const height = heightN * (1 - cellOffsetZ) + heightS * cellOffsetZ;

                // Calculate gradient
                const gradientX =
                    (heightNE - heightNW) * (1 - cellOffsetZ) + (heightSE - heightSW) * cellOffsetZ;
                const gradientZ = heightS - heightN;

                // Update velocity (apply gradient and inertia)
                dirX = dirX * params.inertia - gradientX * (1 - params.inertia);
                dirZ = dirZ * params.inertia - gradientZ * (1 - params.inertia);

                // Normalize direction if too long
                const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
                if (length !== 0) {
                    dirX /= length;
                    dirZ /= length;
                }

                // Update position
                posX += dirX;
                posZ += dirZ;

                // Stop if moving uphill
                const newHeight = this.getHeightInterpolated(heightmap, size, posX, posZ);
                const heightDelta = newHeight - height;

                // Calculate sediment capacity
                const capacity = Math.max(
                    -heightDelta * speed * water * params.sedimentCapacityFactor,
                    params.minSedimentCapacity
                );

                // Deposit or erode
                if (sediment > capacity || heightDelta > 0) {
                    // Deposit sediment
                    const amountToDeposit =
                        heightDelta > 0
                            ? Math.min(heightDelta, sediment)
                            : (sediment - capacity) * params.depositSpeed;

                    sediment -= amountToDeposit;

                    // Deposit in a brush pattern
                    this.depositSediment(
                        heightmap,
                        size,
                        nodeX,
                        nodeZ,
                        amountToDeposit,
                        params.brushRadius
                    );
                } else {
                    // Erode
                    const amountToErode = Math.min(
                        (capacity - sediment) * params.erodeSpeed,
                        -heightDelta
                    );

                    // Erode in a brush pattern
                    this.erodeSediment(
                        heightmap,
                        size,
                        nodeX,
                        nodeZ,
                        amountToErode,
                        params.brushRadius
                    );
                    sediment += amountToErode;
                }

                // Update water and speed
                water *= 1 - params.evaporateSpeed;
                speed = Math.sqrt(speed * speed + heightDelta * params.gravity);
                speed = Math.min(speed, params.maxDropletSpeed);
            }
        }
    }

    /**
     * Calculate normal vectors from heightmap
     */
    private calculateNormals(
        heightmap: Float32Array,
        normals: Float32Array,
        size: number,
        step: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;

                // Get neighboring heights
                const left = j > 0 ? heightmap[i * size + (j - 1)] : heightmap[index];
                const right = j < size - 1 ? heightmap[i * size + (j + 1)] : heightmap[index];
                const up = i > 0 ? heightmap[(i - 1) * size + j] : heightmap[index];
                const down = i < size - 1 ? heightmap[(i + 1) * size + j] : heightmap[index];

                // Calculate gradient vectors
                const dx = (right - left) / (2 * step);
                const dz = (down - up) / (2 * step);

                // Calculate normal (cross product of gradient vectors)
                const normal = new Vector3(-dx, 1, -dz).normalize();

                normals[index * 3] = normal.x;
                normals[index * 3 + 1] = normal.y;
                normals[index * 3 + 2] = normal.z;
            }
        }
    }

    /**
     * Calculate slope angles
     */
    private calculateSlopes(
        heightmap: Float32Array,
        slopes: Float32Array,
        size: number,
        step: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;

                // Get neighboring heights
                const left = j > 0 ? heightmap[i * size + (j - 1)] : heightmap[index];
                const right = j < size - 1 ? heightmap[i * size + (j + 1)] : heightmap[index];
                const up = i > 0 ? heightmap[(i - 1) * size + j] : heightmap[index];
                const down = i < size - 1 ? heightmap[(i + 1) * size + j] : heightmap[index];

                // Calculate gradient magnitude
                const dx = (right - left) / (2 * step);
                const dz = (down - up) / (2 * step);
                const gradient = Math.sqrt(dx * dx + dz * dz);

                // Convert to angle in radians
                slopes[index] = Math.atan(gradient);
            }
        }
    }

    /**
     * Assign materials based on elevation, slope, climate, and water body detection
     */
    private assignMaterials(
        heightmap: Float32Array,
        materials: Uint8Array,
        waterMask: Uint8Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        // First pass: detect water bodies
        const waterBodies = this.detectWaterBodies(heightmap, worldX, worldZ, step, size);

        // Calculate slopes for biome classification
        const slopes = new Float32Array(size * size);
        this.calculateSlopes(heightmap, slopes, size, step);

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];
                const slope = slopes[index];
                const waterData = waterBodies[index];
                const wx = worldX + j * step;
                const wz = worldZ + i * step;

                // Generate enhanced climate data
                const climate = this.generateEnhancedClimate(wx, wz, elevation, waterData);

                // Assign biome with smooth transitions
                const biomeId = this.classifyBiomeEnhanced(climate, elevation, slope, waterData);
                materials[index] = biomeId;

                // Set enhanced water mask
                waterMask[index] = waterData.isWater ? 1 : 0;
            }
        }

        // Post-process for smooth biome transitions
        this.smoothBiomeTransitions(materials, size);
    }

    /**
     * Generate enhanced climate data for biome classification
     */
    private generateEnhancedClimate(
        x: number,
        z: number,
        elevation: number,
        waterData: WaterBodyData
    ): ClimateData {
        return this.generateClimate(x, z, elevation);
    }

    /**
     * Generate climate data for biome classification
     */
    private generateClimate(x: number, z: number, elevation: number): ClimateData {
        // Latitude-based temperature (simplified)
        const latitude = z / 111320; // Convert to degrees
        const baseTemperature = 30 - Math.abs(latitude) * 0.5; // Warmer at equator

        // Elevation-based temperature lapse rate (6.5°C per 1000m)
        const temperature = baseTemperature - (elevation * 6.5) / 1000;

        // Noise-based precipitation
        const precipitationNoise = this.perlinNoise(x * 0.0001, z * 0.0001);
        const precipitation = Math.max(0, 800 + precipitationNoise * 1200); // 0-2000mm

        // Humidity based on precipitation and temperature
        const humidity =
            Math.min(1, precipitation / 2000) * Math.max(0, 1 - Math.abs(temperature - 20) / 40);

        return {
            temperature,
            precipitation,
            humidity,
            elevation,
        };
    }

    /**
     * Classify biome based on climate data
     */
    private classifyBiome(climate: ClimateData): number {
        const { temperature, precipitation, elevation } = climate;
        const thresholds = BIOME_CONFIG.ELEVATION_THRESHOLDS;
        const tempThresholds = BIOME_CONFIG.TEMPERATURE_THRESHOLDS;
        const precipThresholds = BIOME_CONFIG.PRECIPITATION_THRESHOLDS;

        // Water bodies
        if (elevation <= thresholds.OCEAN) {
            return BIOME_CONFIG.BIOMES.OCEAN.id;
        }

        // Beach/coastal
        if (elevation <= thresholds.BEACH) {
            return BIOME_CONFIG.BIOMES.BEACH.id;
        }

        // High elevation biomes
        if (elevation > thresholds.SNOW || temperature < tempThresholds.FROZEN) {
            return BIOME_CONFIG.BIOMES.SNOW.id;
        }

        if (elevation > thresholds.MOUNTAIN) {
            return temperature < tempThresholds.COLD
                ? BIOME_CONFIG.BIOMES.TUNDRA.id
                : BIOME_CONFIG.BIOMES.MOUNTAIN.id;
        }

        // Temperature and precipitation based classification
        if (precipitation < precipThresholds.ARID) {
            return BIOME_CONFIG.BIOMES.DESERT.id;
        }

        if (temperature > tempThresholds.TEMPERATE && precipitation > precipThresholds.HUMID) {
            return BIOME_CONFIG.BIOMES.FOREST.id;
        }

        if (precipitation > precipThresholds.WET) {
            return elevation > thresholds.FOREST
                ? BIOME_CONFIG.BIOMES.FOREST.id
                : BIOME_CONFIG.BIOMES.WETLAND.id;
        }

        // Default to grassland
        return BIOME_CONFIG.BIOMES.GRASSLAND.id;
    }

    /**
     * Enhanced biome classification with water body awareness and slope consideration
     */
    private classifyBiomeEnhanced(
        climate: ClimateData,
        elevation: number,
        slope: number,
        waterData: WaterBodyData
    ): number {
        const { temperature, precipitation } = climate;
        const thresholds = BIOME_CONFIG.ELEVATION_THRESHOLDS;
        const tempThresholds = BIOME_CONFIG.TEMPERATURE_THRESHOLDS;
        const precipThresholds = BIOME_CONFIG.PRECIPITATION_THRESHOLDS;

        // Water body classification first
        if (waterData.isWater) {
            switch (waterData.waterType) {
                case 'ocean':
                    return BIOME_CONFIG.BIOMES.OCEAN.id;
                case 'lake':
                    return BIOME_CONFIG.BIOMES.LAKE.id;
                case 'river':
                    return BIOME_CONFIG.BIOMES.RIVER.id;
                case 'beach':
                    return BIOME_CONFIG.BIOMES.BEACH.id;
                default:
                    return BIOME_CONFIG.BIOMES.OCEAN.id;
            }
        }

        // Beach/coastal areas (within 10m of sea level and near water)
        if (elevation <= thresholds.BEACH && waterData.distanceToShore < 20) {
            return BIOME_CONFIG.BIOMES.BEACH.id;
        }

        // High elevation biomes with slope consideration
        if (elevation > thresholds.SNOW || temperature < tempThresholds.FROZEN) {
            return BIOME_CONFIG.BIOMES.SNOW.id;
        }

        if (elevation > thresholds.MOUNTAIN) {
            // Steep slopes at high elevation are rocky mountains
            if (slope > Math.PI / 6) {
                // > 30 degrees
                return BIOME_CONFIG.BIOMES.MOUNTAIN.id;
            }
            return temperature < tempThresholds.COLD
                ? BIOME_CONFIG.BIOMES.TUNDRA.id
                : BIOME_CONFIG.BIOMES.MOUNTAIN.id;
        }

        // Mid-elevation biomes
        if (elevation > thresholds.FOREST) {
            if (slope > Math.PI / 4) {
                // > 45 degrees
                return BIOME_CONFIG.BIOMES.MOUNTAIN.id; // Steep slopes are rocky
            }

            if (temperature > tempThresholds.TEMPERATE && precipitation > precipThresholds.HUMID) {
                return BIOME_CONFIG.BIOMES.FOREST.id;
            }

            if (precipitation < precipThresholds.ARID) {
                return BIOME_CONFIG.BIOMES.DESERT.id;
            }

            return BIOME_CONFIG.BIOMES.GRASSLAND.id;
        }

        // Low elevation biomes
        if (precipitation < precipThresholds.ARID) {
            return BIOME_CONFIG.BIOMES.DESERT.id;
        }

        if (precipitation > precipThresholds.WET && elevation < thresholds.GRASSLAND) {
            return BIOME_CONFIG.BIOMES.WETLAND.id;
        }

        if (temperature > tempThresholds.TEMPERATE && precipitation > precipThresholds.HUMID) {
            return BIOME_CONFIG.BIOMES.FOREST.id;
        }

        // Default to grassland for moderate conditions
        return BIOME_CONFIG.BIOMES.GRASSLAND.id;
    }

    /**
     * Smooth biome transitions with enhanced algorithm for more natural boundaries
     */
    private smoothBiomeTransitions(materials: Uint8Array, size: number): void {
        const originalMaterials = new Uint8Array(materials);

        // Multi-pass smoothing for better results
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 1; i < size - 1; i++) {
                for (let j = 1; j < size - 1; j++) {
                    const index = i * size + j;
                    const currentBiome = originalMaterials[index];

                    // Get all neighboring biomes including diagonal neighbors
                    const neighbors = [
                        originalMaterials[(i - 1) * size + j], // North
                        originalMaterials[(i + 1) * size + j], // South
                        originalMaterials[i * size + (j - 1)], // West
                        originalMaterials[i * size + (j + 1)], // East
                        originalMaterials[(i - 1) * size + (j - 1)], // NW
                        originalMaterials[(i - 1) * size + (j + 1)], // NE
                        originalMaterials[(i + 1) * size + (j - 1)], // SW
                        originalMaterials[(i + 1) * size + (j + 1)], // SE
                    ];

                    // Count occurrences with weighted importance (cardinal directions have more weight)
                    const biomeCounts = new Map<number, number>();
                    biomeCounts.set(currentBiome, 2); // Current biome has initial weight

                    // Cardinal neighbors have more influence than diagonal
                    const weights = [2, 2, 2, 2, 1, 1, 1, 1]; // N, S, W, E, NW, NE, SW, SE

                    for (let i = 0; i < neighbors.length; i++) {
                        const neighbor = neighbors[i];
                        const weight = weights[i];
                        biomeCounts.set(neighbor, (biomeCounts.get(neighbor) || 0) + weight);
                    }

                    // Find most dominant biome
                    let bestBiome = currentBiome;
                    let maxWeight = biomeCounts.get(currentBiome) || 0;

                    for (const [biome, weight] of biomeCounts) {
                        if (weight > maxWeight) {
                            bestBiome = biome;
                            maxWeight = weight;
                        }
                    }

                    // Define protected biome types that shouldn't be smoothed away
                    const protectedBiomes = new Set([
                        BIOME_CONFIG.BIOMES.OCEAN.id,
                        BIOME_CONFIG.BIOMES.LAKE.id,
                        BIOME_CONFIG.BIOMES.RIVER.id,
                    ]);

                    // Define transition-compatible biomes
                    const compatibleTransitions = new Map([
                        [
                            BIOME_CONFIG.BIOMES.BEACH.id,
                            new Set([
                                BIOME_CONFIG.BIOMES.GRASSLAND.id,
                                BIOME_CONFIG.BIOMES.DESERT.id,
                            ]),
                        ],
                        [
                            BIOME_CONFIG.BIOMES.GRASSLAND.id,
                            new Set([
                                BIOME_CONFIG.BIOMES.FOREST.id,
                                BIOME_CONFIG.BIOMES.DESERT.id,
                                BIOME_CONFIG.BIOMES.WETLAND.id,
                            ]),
                        ],
                        [
                            BIOME_CONFIG.BIOMES.FOREST.id,
                            new Set([
                                BIOME_CONFIG.BIOMES.GRASSLAND.id,
                                BIOME_CONFIG.BIOMES.MOUNTAIN.id,
                                BIOME_CONFIG.BIOMES.TUNDRA.id,
                            ]),
                        ],
                        [
                            BIOME_CONFIG.BIOMES.MOUNTAIN.id,
                            new Set([
                                BIOME_CONFIG.BIOMES.FOREST.id,
                                BIOME_CONFIG.BIOMES.TUNDRA.id,
                                BIOME_CONFIG.BIOMES.SNOW.id,
                            ]),
                        ],
                        [
                            BIOME_CONFIG.BIOMES.DESERT.id,
                            new Set([
                                BIOME_CONFIG.BIOMES.GRASSLAND.id,
                                BIOME_CONFIG.BIOMES.BEACH.id,
                            ]),
                        ],
                    ]);

                    // Apply smoothing with compatibility rules
                    if (
                        bestBiome !== currentBiome &&
                        !protectedBiomes.has(currentBiome) &&
                        maxWeight >= 6
                    ) {
                        // Require significant majority

                        // Check if transition is natural/compatible
                        const currentCompatible = compatibleTransitions.get(currentBiome);
                        const newCompatible = compatibleTransitions.get(bestBiome);

                        if (
                            (currentCompatible && currentCompatible.has(bestBiome)) ||
                            (newCompatible && newCompatible.has(currentBiome)) ||
                            maxWeight >= 8
                        ) {
                            // Override compatibility for strong majorities
                            materials[index] = bestBiome;
                        }
                    }
                }
            }

            // Update original materials for next pass
            if (pass === 0) {
                originalMaterials.set(materials);
            }
        }
    }

    /**
     * Generate UV coordinates
     */
    private generateUVs(size: number): Float32Array {
        const uvs = new Float32Array(size * size * 2);

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = (i * size + j) * 2;
                uvs[index] = j / (size - 1);
                uvs[index + 1] = i / (size - 1);
            }
        }

        return uvs;
    }

    /**
     * Generate texture indices for material blending
     */
    private generateTextureIndices(materials: Uint8Array, size: number): Uint8Array {
        // For now, just copy materials. Later can be extended for texture atlas mapping
        return new Uint8Array(materials);
    }

    /**
     * Generate base elevation using enhanced layered noise
     */
    private generateBaseElevation(wx: number, wz: number, octaves: any[]): number {
        let elevation = 0;
        let amplitude = 1;
        let maxValue = 0;

        // Combine multiple noise octaves with proper amplitude scaling
        for (const octave of octaves) {
            const noiseValue = this.sampleNoise(
                wx * octave.frequency,
                wz * octave.frequency,
                octave.type as NoiseType
            );

            elevation += noiseValue * octave.amplitude * amplitude;
            maxValue += octave.amplitude * amplitude;
            amplitude *= 0.5; // Reduce amplitude for higher frequencies
        }

        return elevation / maxValue; // Normalize to [-1, 1]
    }

    /**
     * Enhanced continental shelf effects for realistic landmasses
     */
    private getEnhancedContinentalFactor(x: number, z: number): number {
        // Multiple continental centers for more interesting landmasses
        const continents = [
            { x: 0, z: 0, size: 800000, strength: 1.0 },
            { x: 500000, z: 300000, size: 600000, strength: 0.8 },
            { x: -400000, z: -200000, size: 500000, strength: 0.7 },
        ];

        let maxFactor = 0;
        for (const continent of continents) {
            const distance = Math.sqrt(
                (x - continent.x) * (x - continent.x) + (z - continent.z) * (z - continent.z)
            );

            // Smooth falloff with shelf break
            const shelfBreak = continent.size * 0.7;
            const deepOcean = continent.size * 1.2;

            let factor;
            if (distance < shelfBreak) {
                // Continental shelf - gradual descent
                factor = continent.strength * (1 - (distance / shelfBreak) * 0.3);
            } else if (distance < deepOcean) {
                // Continental slope - steeper descent
                const t = (distance - shelfBreak) / (deepOcean - shelfBreak);
                factor = continent.strength * (0.7 - t * 0.9); // Down to -0.2 for ocean depths
            } else {
                // Abyssal plains
                factor = -0.2;
            }

            maxFactor = Math.max(maxFactor, factor);
        }

        const result = Math.max(-0.5, Math.min(1.0, maxFactor));
        return isFinite(result) ? result : 0;
    }

    /**
     * Generate mountain ridges using ridge noise
     */
    private generateMountainRidges(x: number, z: number): number {
        // Create multiple ridge systems with different orientations
        const ridge1 = this.createRidgeSystem(x, z, { x: 1, z: 0.3 }, 0.0003, 800);
        const ridge2 = this.createRidgeSystem(x, z, { x: 0.2, z: 1 }, 0.0002, 600);
        const ridge3 = this.createRidgeSystem(x, z, { x: -0.7, z: 0.7 }, 0.0004, 400);

        return Math.max(ridge1, ridge2, ridge3);
    }

    /**
     * Create a single ridge system
     */
    private createRidgeSystem(
        x: number,
        z: number,
        direction: { x: number; z: number },
        frequency: number,
        amplitude: number
    ): number {
        // Normalize direction
        const len = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        const dx = direction.x / len;
        const dz = direction.z / len;

        // Project coordinates onto ridge direction
        const parallel = x * dx + z * dz;
        const perpendicular = x * dz - z * dx;

        // Ridge noise - absolute value creates ridges
        const ridgeNoise = Math.abs(
            this.perlinNoise(perpendicular * frequency, parallel * frequency * 0.3)
        );
        const ridge = Math.pow(1 - ridgeNoise, 2); // Sharpen ridges

        // Modulate along ridge length
        const lengthModulation = 0.5 + 0.5 * this.perlinNoise(parallel * frequency * 0.1, 0);

        return ridge * amplitude * lengthModulation;
    }

    /**
     * Generate valley carving algorithms
     */
    private generateValleys(x: number, z: number): number {
        // Use turbulence to create valley networks
        const valleyNoise = this.turbulence(x * 0.0001, z * 0.0001, 3);

        // Create valley floors by inverting peaks
        const valley1 = this.carveValley(x, z, { x: 0.8, z: 0.6 }, 0.0002, -200);
        const valley2 = this.carveValley(x, z, { x: -0.4, z: 0.9 }, 0.00015, -150);

        return Math.min(valley1, valley2) * valleyNoise;
    }

    /**
     * Carve individual valleys
     */
    private carveValley(
        x: number,
        z: number,
        direction: { x: number; z: number },
        frequency: number,
        depth: number
    ): number {
        // Normalize direction
        const len = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        const dx = direction.x / len;
        const dz = direction.z / len;

        // Project coordinates
        const parallel = x * dx + z * dz;
        const perpendicular = x * dz - z * dx;

        // Valley profile - inverted ridge
        const valleyProfile = Math.abs(
            this.perlinNoise(perpendicular * frequency, parallel * frequency * 0.5)
        );
        const valley = Math.pow(valleyProfile, 0.5); // Smoother valley sides

        // Valley depth varies along length
        const depthModulation =
            0.3 + 0.7 * Math.abs(this.perlinNoise(parallel * frequency * 0.05, 0));

        return -valley * depth * depthModulation;
    }

    /**
     * Generate plains with subtle variations
     */
    private generatePlains(x: number, z: number): number {
        // Low-frequency, low-amplitude variations for rolling plains
        const plains1 = this.perlinNoise(x * 0.00005, z * 0.00005) * 30;
        const plains2 = this.perlinNoise(x * 0.0002, z * 0.0002) * 10;
        const plains3 = this.perlinNoise(x * 0.001, z * 0.001) * 3;

        return plains1 + plains2 + plains3;
    }

    /**
     * Generate volcanic peak generation
     */
    private generateVolcanicPeaks(x: number, z: number): number {
        // Define volcanic centers
        const volcanoes = [
            { x: 200000, z: 150000, radius: 20000, height: 2000 },
            { x: -300000, z: 200000, radius: 15000, height: 1500 },
            { x: 100000, z: -250000, radius: 25000, height: 2500 },
        ];

        let maxHeight = 0;
        for (const volcano of volcanoes) {
            const distance = Math.sqrt(
                (x - volcano.x) * (x - volcano.x) + (z - volcano.z) * (z - volcano.z)
            );

            if (distance < volcano.radius) {
                // Volcanic cone profile
                const normalizedDistance = distance / volcano.radius;
                const coneHeight = Math.pow(1 - normalizedDistance, 2) * volcano.height;

                // Add crater at peak
                if (normalizedDistance < 0.1) {
                    const craterDepth = volcano.height * 0.15;
                    const craterProfile = Math.pow(normalizedDistance / 0.1, 2);
                    const height = coneHeight - craterDepth * (1 - craterProfile);
                    maxHeight = Math.max(maxHeight, height);
                } else {
                    maxHeight = Math.max(maxHeight, coneHeight);
                }
            }
        }

        return maxHeight;
    }

    /**
     * Scale elevation to realistic ranges (-500m to 8000m)
     */
    private scaleElevationToRealistic(normalizedElevation: number): number {
        // Map [-1, 1] to [-500, 8000] with emphasis on land elevations
        const seaLevel = 0;
        const oceanDepth = -500;
        const maxElevation = 8000;

        if (normalizedElevation < 0) {
            // Ocean depths: [-1, 0] -> [-500, 0]
            return normalizedElevation * Math.abs(oceanDepth);
        } else {
            // Land elevations: [0, 1] -> [0, 8000]
            // Use power function to create more low elevations
            const scaledElevation = Math.pow(normalizedElevation, 0.7);
            return scaledElevation * maxElevation;
        }
    }

    /**
     * Post-process heightmap for enhanced water body detection and beach zone generation
     */
    private postProcessWaterBodies(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        // First pass: Create realistic beach slopes
        this.generateBeachZones(heightmap, size, step);

        // Second pass: Smooth water-land transitions
        this.smoothShoreTransitions(heightmap, size);
    }

    /**
     * Generate realistic beach zones with proper elevation gradients
     */
    private generateBeachZones(heightmap: Float32Array, size: number, step: number): void {
        const processedMask = new Uint8Array(size * size);

        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Skip if already processed or not in potential beach zone
                if (processedMask[index] || elevation < -20 || elevation > 20) {
                    continue;
                }

                // Check if this point is near water (has negative elevation neighbors)
                const hasWaterNeighbor = this.hasNearbyWater(heightmap, i, j, size);
                const hasLandNeighbor = this.hasNearbyLand(heightmap, i, j, size);

                if (hasWaterNeighbor && hasLandNeighbor) {
                    // This is a shore zone - create beach profile
                    this.createBeachProfile(heightmap, processedMask, i, j, size, step);
                }
            }
        }
    }

    /**
     * Check if point has nearby water
     */
    private hasNearbyWater(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): boolean {
        const checkRadius = 5;

        for (let di = -checkRadius; di <= checkRadius; di++) {
            for (let dj = -checkRadius; dj <= checkRadius; dj++) {
                const i = centerI + di;
                const j = centerJ + dj;

                if (i >= 0 && i < size && j >= 0 && j < size) {
                    if (heightmap[i * size + j] <= 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Check if point has nearby land
     */
    private hasNearbyLand(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): boolean {
        const checkRadius = 5;

        for (let di = -checkRadius; di <= checkRadius; di++) {
            for (let dj = -checkRadius; dj <= checkRadius; dj++) {
                const i = centerI + di;
                const j = centerJ + dj;

                if (i >= 0 && i < size && j >= 0 && j < size) {
                    if (heightmap[i * size + j] > 5) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Create realistic beach profile with gradual slope
     */
    private createBeachProfile(
        heightmap: Float32Array,
        processedMask: Uint8Array,
        centerI: number,
        centerJ: number,
        size: number,
        step: number
    ): void {
        const beachRadius = 8;

        for (let di = -beachRadius; di <= beachRadius; di++) {
            for (let dj = -beachRadius; dj <= beachRadius; dj++) {
                const i = centerI + di;
                const j = centerJ + dj;

                if (i >= 0 && i < size && j >= 0 && j < size) {
                    const index = i * size + j;

                    if (processedMask[index]) continue;

                    const distance = Math.sqrt(di * di + dj * dj);
                    if (distance <= beachRadius) {
                        const currentElevation = heightmap[index];

                        // Create gentle beach slope: steeper near water, gentler toward land
                        const distanceToWater = this.calculateDistanceToWater(
                            heightmap,
                            i,
                            j,
                            size
                        );
                        const distanceToHighLand = this.calculateDistanceToHighLand(
                            heightmap,
                            i,
                            j,
                            size
                        );

                        if (distanceToWater < 10 && distanceToHighLand < 15) {
                            // Beach zone - apply realistic elevation profile
                            const beachElevation = this.calculateBeachElevation(
                                distanceToWater,
                                distanceToHighLand
                            );

                            // Blend with existing elevation for smooth transition
                            const blendFactor = Math.max(0, 1 - distance / beachRadius);
                            heightmap[index] =
                                currentElevation * (1 - blendFactor) + beachElevation * blendFactor;

                            processedMask[index] = 1;
                        }
                    }
                }
            }
        }
    }

    /**
     * Calculate distance to water for beach profile generation
     */
    private calculateDistanceToWater(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): number {
        const maxRadius = 20;

        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const i = Math.round(centerI + radius * Math.sin(angle));
                const j = Math.round(centerJ + radius * Math.cos(angle));

                if (i >= 0 && i < size && j >= 0 && j < size) {
                    if (heightmap[i * size + j] <= 0) {
                        return radius;
                    }
                }
            }
        }
        return maxRadius;
    }

    /**
     * Calculate distance to high land for beach profile generation
     */
    private calculateDistanceToHighLand(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): number {
        const maxRadius = 20;

        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const i = Math.round(centerI + radius * Math.sin(angle));
                const j = Math.round(centerJ + radius * Math.cos(angle));

                if (i >= 0 && i < size && j >= 0 && j < size) {
                    if (heightmap[i * size + j] > 10) {
                        return radius;
                    }
                }
            }
        }
        return maxRadius;
    }

    /**
     * Calculate realistic beach elevation based on distance to water and land
     */
    private calculateBeachElevation(distanceToWater: number, distanceToHighLand: number): number {
        // Beach slope parameters
        const waterLevel = 0;
        const maxBeachHeight = 8;

        // Create realistic beach profile
        const totalDistance = distanceToWater + distanceToHighLand;
        const beachPosition = distanceToWater / Math.max(totalDistance, 1);

        // Use exponential curve for realistic beach slope
        const elevation = waterLevel + maxBeachHeight * Math.pow(beachPosition, 1.5);

        return Math.max(waterLevel, Math.min(maxBeachHeight, elevation));
    }

    /**
     * Smooth shore transitions for natural appearance
     */
    private smoothShoreTransitions(heightmap: Float32Array, size: number): void {
        const smoothed = new Float32Array(heightmap);

        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Apply smoothing only to shore zones
                if (elevation >= -5 && elevation <= 15) {
                    // Use 3x3 Gaussian-like smoothing kernel
                    const weights = [
                        0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625,
                    ];

                    let weightedSum = 0;
                    let totalWeight = 0;

                    for (let di = -1; di <= 1; di++) {
                        for (let dj = -1; dj <= 1; dj++) {
                            const ni = i + di;
                            const nj = j + dj;

                            if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                                const neighborElevation = heightmap[ni * size + nj];
                                const weight = weights[(di + 1) * 3 + (dj + 1)];

                                weightedSum += neighborElevation * weight;
                                totalWeight += weight;
                            }
                        }
                    }

                    if (totalWeight > 0) {
                        // Blend smoothed result with original for subtle effect
                        const smoothedElevation = weightedSum / totalWeight;
                        smoothed[index] = elevation * 0.6 + smoothedElevation * 0.4;
                    }
                }
            }
        }

        // Copy smoothed values back
        heightmap.set(smoothed);
    }

    /**
     * Detect water bodies and classify them
     */
    public detectWaterBodies(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): WaterBodyData[] {
        const waterBodies: WaterBodyData[] = [];

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];
                const wx = worldX + j * step;
                const wz = worldZ + i * step;

                let waterData: WaterBodyData = {
                    isWater: false,
                    waterType: 'ocean',
                    depth: 0,
                    distanceToShore: 0,
                };

                if (elevation <= 0) {
                    // Below sea level - determine water type
                    waterData.isWater = true;
                    waterData.depth = Math.abs(elevation);

                    // Enhanced water type detection with river identification
                    const distanceToLand = this.calculateDistanceToLand(heightmap, i, j, size);
                    const isEnclosed = this.isEnclosedWaterBody(heightmap, i, j, size);
                    const flowStrength = this.calculateFlowStrength(heightmap, i, j, size, step);

                    if (flowStrength > 0.1 && elevation > -20) {
                        // Strong flow indicates a river
                        waterData.waterType = 'river';
                    } else if (isEnclosed && distanceToLand < 100) {
                        // Enclosed body of water is a lake
                        waterData.waterType = 'lake';
                    } else if (elevation > -10 && distanceToLand < 20) {
                        // Shallow water near shore is beach
                        waterData.waterType = 'beach';
                    } else {
                        // Deep or open water is ocean
                        waterData.waterType = 'ocean';
                    }

                    waterData.distanceToShore = distanceToLand;

                    // Calculate flow direction for all water bodies
                    waterData.flowDirection = this.calculateFlowDirection(
                        heightmap,
                        i,
                        j,
                        size,
                        step
                    );

                    // Store flow strength for river detection
                    if (waterData.waterType === 'river') {
                        (waterData as any).flowStrength = flowStrength;
                    }
                }

                waterBodies.push(waterData);
            }
        }

        return waterBodies;
    }

    /**
     * Calculate distance to nearest land with optimized search pattern
     */
    private calculateDistanceToLand(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): number {
        const maxRadius = Math.min(50, size / 4);

        // Use expanding square search for better performance
        for (let radius = 1; radius <= maxRadius; radius++) {
            // Check the perimeter of the current radius square
            for (let side = 0; side < 4; side++) {
                let startI, startJ, deltaI, deltaJ, steps;

                switch (side) {
                    case 0: // Top edge
                        startI = centerI - radius;
                        startJ = centerJ - radius;
                        deltaI = 0;
                        deltaJ = 1;
                        steps = 2 * radius;
                        break;
                    case 1: // Right edge
                        startI = centerI - radius;
                        startJ = centerJ + radius;
                        deltaI = 1;
                        deltaJ = 0;
                        steps = 2 * radius;
                        break;
                    case 2: // Bottom edge
                        startI = centerI + radius;
                        startJ = centerJ + radius;
                        deltaI = 0;
                        deltaJ = -1;
                        steps = 2 * radius;
                        break;
                    case 3: // Left edge
                        startI = centerI + radius;
                        startJ = centerJ - radius;
                        deltaI = -1;
                        deltaJ = 0;
                        steps = 2 * radius;
                        break;
                    default:
                        continue;
                }

                for (let step = 0; step < steps; step++) {
                    const i = startI + step * deltaI;
                    const j = startJ + step * deltaJ;

                    if (i >= 0 && i < size && j >= 0 && j < size) {
                        const elevation = heightmap[i * size + j];
                        if (elevation > 0) {
                            return radius;
                        }
                    }
                }
            }
        }

        return maxRadius;
    }

    /**
     * Check if water body is enclosed (lake vs ocean) with optimized sampling
     */
    private isEnclosedWaterBody(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number
    ): boolean {
        const checkRadius = Math.min(30, size / 6);
        let landCount = 0;
        let totalChecked = 0;

        // Use a more efficient sampling pattern
        const sampleStep = Math.max(3, checkRadius / 8);

        for (let i = centerI - checkRadius; i <= centerI + checkRadius; i += sampleStep) {
            for (let j = centerJ - checkRadius; j <= centerJ + checkRadius; j += sampleStep) {
                if (i >= 0 && i < size && j >= 0 && j < size) {
                    totalChecked++;
                    if (heightmap[i * size + j] > 0) {
                        landCount++;
                    }
                }
            }
        }

        // If more than 50% of surrounding area is land, consider it enclosed
        // Reduced threshold for better lake detection
        return totalChecked > 0 && landCount / totalChecked > 0.5;
    }

    /**
     * Calculate flow direction for rivers
     */
    private calculateFlowDirection(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number,
        step: number
    ): { x: number; z: number } | undefined {
        if (centerI <= 0 || centerI >= size - 1 || centerJ <= 0 || centerJ >= size - 1) {
            return undefined;
        }

        // Calculate gradient
        const left = heightmap[centerI * size + (centerJ - 1)];
        const right = heightmap[centerI * size + (centerJ + 1)];
        const up = heightmap[(centerI - 1) * size + centerJ];
        const down = heightmap[(centerI + 1) * size + centerJ];

        const gradX = (right - left) / (2 * step);
        const gradZ = (down - up) / (2 * step);

        // Flow direction is negative gradient (water flows downhill)
        const length = Math.sqrt(gradX * gradX + gradZ * gradZ);
        if (length > 0) {
            return { x: -gradX / length, z: -gradZ / length };
        }

        return undefined;
    }

    /**
     * Calculate flow strength to help identify rivers
     */
    private calculateFlowStrength(
        heightmap: Float32Array,
        centerI: number,
        centerJ: number,
        size: number,
        step: number
    ): number {
        if (centerI <= 0 || centerI >= size - 1 || centerJ <= 0 || centerJ >= size - 1) {
            return 0;
        }

        // Calculate local gradient magnitude
        const left = heightmap[centerI * size + (centerJ - 1)];
        const right = heightmap[centerI * size + (centerJ + 1)];
        const up = heightmap[(centerI - 1) * size + centerJ];
        const down = heightmap[(centerI + 1) * size + centerJ];

        const gradX = (right - left) / (2 * step);
        const gradZ = (down - up) / (2 * step);
        const gradientMagnitude = Math.sqrt(gradX * gradX + gradZ * gradZ);

        // Check if terrain forms a natural channel (lower than surroundings)
        const center = heightmap[centerI * size + centerJ];
        const neighbors = [left, right, up, down];
        const avgNeighborHeight = neighbors.reduce((sum, h) => sum + h, 0) / neighbors.length;
        const channelDepth = Math.max(0, avgNeighborHeight - center);

        // Flow strength combines gradient and channel characteristics
        return gradientMagnitude * 10 + channelDepth * 0.1;
    }

    // Helper methods

    private initializeNoise(): void {
        // Initialize permutation table
        this.permutation = new Array(512);
        const p = new Array(256);

        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle based on seed
        const random = this.seededRandom(this.seed);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Duplicate for wrapping
        for (let i = 0; i < 512; i++) {
            this.permutation[i] = p[i % 256];
        }

        // Initialize gradient vectors
        this.gradients = [
            new Vector3(1, 1, 0),
            new Vector3(-1, 1, 0),
            new Vector3(1, -1, 0),
            new Vector3(-1, -1, 0),
            new Vector3(1, 0, 1),
            new Vector3(-1, 0, 1),
            new Vector3(1, 0, -1),
            new Vector3(-1, 0, -1),
            new Vector3(0, 1, 1),
            new Vector3(0, -1, 1),
            new Vector3(0, 1, -1),
            new Vector3(0, -1, -1),
        ];
    }

    private getContinentalFactor(x: number, z: number): number {
        // Legacy method - delegate to enhanced version
        return this.getEnhancedContinentalFactor(x, z);
    }

    private getLatitudeFactor(z: number): number {
        // Elevation varies by latitude - higher at poles, lower at equator for ice caps
        const latitude = Math.abs(z / 111320);
        return 0.8 + 0.4 * Math.cos((latitude * Math.PI) / 180);
    }

    private seededRandom(seed: number): () => number {
        return () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(a: number, b: number, t: number): number {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, z: number): number {
        const h = hash & 15;
        const u = h < 8 ? x : z;
        const v = h < 4 ? z : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    private dot2D(gi: number, x: number, y: number): number {
        const gradient = this.gradients[gi % this.gradients.length];
        return gradient.x * x + gradient.z * y;
    }

    private getHeightInterpolated(
        heightmap: Float32Array,
        size: number,
        x: number,
        z: number
    ): number {
        const fx = Math.max(0, Math.min(size - 1.001, x));
        const fz = Math.max(0, Math.min(size - 1.001, z));

        const ix = Math.floor(fx);
        const iz = Math.floor(fz);

        const tx = fx - ix;
        const tz = fz - iz;

        const h00 = heightmap[iz * size + ix];
        const h10 = heightmap[iz * size + Math.min(ix + 1, size - 1)];
        const h01 = heightmap[Math.min(iz + 1, size - 1) * size + ix];
        const h11 = heightmap[Math.min(iz + 1, size - 1) * size + Math.min(ix + 1, size - 1)];

        const h0 = h00 * (1 - tx) + h10 * tx;
        const h1 = h01 * (1 - tx) + h11 * tx;

        return h0 * (1 - tz) + h1 * tz;
    }

    private depositSediment(
        heightmap: Float32Array,
        size: number,
        x: number,
        z: number,
        amount: number,
        radius: number
    ): void {
        const intRadius = Math.floor(radius);
        for (let i = -intRadius; i <= intRadius; i++) {
            for (let j = -intRadius; j <= intRadius; j++) {
                const nx = x + j;
                const nz = z + i;

                if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
                    const distance = Math.sqrt(i * i + j * j);
                    if (distance <= radius) {
                        const weight = 1 - distance / radius;
                        heightmap[nz * size + nx] += amount * weight;
                    }
                }
            }
        }
    }

    private erodeSediment(
        heightmap: Float32Array,
        size: number,
        x: number,
        z: number,
        amount: number,
        radius: number
    ): void {
        const intRadius = Math.floor(radius);
        for (let i = -intRadius; i <= intRadius; i++) {
            for (let j = -intRadius; j <= intRadius; j++) {
                const nx = x + j;
                const nz = z + i;

                if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
                    const distance = Math.sqrt(i * i + j * j);
                    if (distance <= radius) {
                        const weight = 1 - distance / radius;
                        heightmap[nz * size + nx] -= amount * weight;
                    }
                }
            }
        }
    }
}
