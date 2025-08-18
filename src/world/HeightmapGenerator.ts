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
 * Advanced procedural heightmap generator using multiple noise techniques
 * Supports Fractal Brownian Motion, Ridge noise, Turbulence, and erosion simulation
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

        // Apply erosion simulation
        this.applyErosion(heightmap, size, NOISE_CONFIG.EROSION);

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

                let elevation = 0;
                let amplitude = 1;
                let frequency = 1;

                // Combine multiple noise octaves
                for (const octave of octaves) {
                    const noiseValue = this.sampleNoise(
                        wx * octave.frequency,
                        wz * octave.frequency,
                        octave.type as NoiseType
                    );

                    elevation += noiseValue * octave.amplitude;
                }

                // Apply continental shelf effect
                const continentalFactor = this.getContinentalFactor(wx, wz);
                elevation *= continentalFactor;

                // Apply latitude-based elevation scaling
                const latitudeFactor = this.getLatitudeFactor(wz);
                elevation *= latitudeFactor;

                heightmap[index] = elevation;
            }
        }
    }

    /**
     * Sample noise value at given coordinates
     */
    private sampleNoise(x: number, z: number, type: NoiseType): number {
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
     * Classic Perlin noise implementation
     */
    private perlinNoise(x: number, z: number): number {
        // Integer coordinates
        const xi = Math.floor(x) & 255;
        const zi = Math.floor(z) & 255;

        // Fractional coordinates
        const xf = x - Math.floor(x);
        const zf = z - Math.floor(z);

        // Smooth curves for interpolation
        const u = this.fade(xf);
        const v = this.fade(zf);

        // Hash coordinates of 4 corners
        const aa = this.permutation[this.permutation[xi] + zi];
        const ab = this.permutation[this.permutation[xi] + zi + 1];
        const ba = this.permutation[this.permutation[xi + 1] + zi];
        const bb = this.permutation[this.permutation[xi + 1] + zi + 1];

        // Compute gradients
        const x1 = this.lerp(this.grad(aa, xf, zf), this.grad(ba, xf - 1, zf), u);

        const x2 = this.lerp(this.grad(ab, xf, zf - 1), this.grad(bb, xf - 1, zf - 1), u);

        return this.lerp(x1, x2, v);
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
     * Assign materials based on elevation, slope, and climate
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
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];
                const wx = worldX + j * step;
                const wz = worldZ + i * step;

                // Generate climate data
                const climate = this.generateClimate(wx, wz, elevation);

                // Assign biome based on climate and elevation
                const biomeId = this.classifyBiome(climate);
                materials[index] = biomeId;

                // Set water mask
                waterMask[index] = elevation <= 0 ? 1 : 0;
            }
        }
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

    private getContinentalFactor(x: number, z: number): number {
        // Simple continental shelf effect - for now just return 1 to avoid issues
        return 1.0;
    }

    private getLatitudeFactor(z: number): number {
        // For now, just return 1 to avoid issues
        return 1.0;
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
