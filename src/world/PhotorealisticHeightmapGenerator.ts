import { Vector3 } from '../core/math';
import { TERRAIN_CONFIG } from './WorldConstants';
import type { TerrainData } from './TerrainTile';

/**
 * Photorealistic terrain generator using advanced noise techniques
 * Creates natural-looking terrain with proper continental features, mountains, valleys, and biomes
 */
export class PhotorealisticHeightmapGenerator {
    private seed: number;
    private permutation: Uint8Array;
    private gradients3D: Float32Array;

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.initializeNoise();
    }

    /**
     * Initialize noise generation tables
     */
    private initializeNoise(): void {
        // Create permutation table for Perlin noise
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

        // Create gradient table
        this.gradients3D = new Float32Array(256 * 3);
        for (let i = 0; i < 256; i++) {
            const theta = Math.acos(2 * Math.random() - 1);
            const phi = 2 * Math.PI * Math.random();

            this.gradients3D[i * 3] = Math.sin(theta) * Math.cos(phi);
            this.gradients3D[i * 3 + 1] = Math.sin(theta) * Math.sin(phi);
            this.gradients3D[i * 3 + 2] = Math.cos(theta);
        }
    }

    /**
     * Generate complete terrain data for a tile
     */
    public generateTerrainData(
        tileX: number,
        tileZ: number,
        lodLevel: number,
        resolution: number = TERRAIN_CONFIG.HEIGHT_RESOLUTION,
        tileSize: number = TERRAIN_CONFIG.BASE_TILE_SIZE
    ): TerrainData {
        const size = resolution;
        const heightmap = new Float32Array(size * size);
        const normals = new Float32Array(size * size * 3);
        const materials = new Uint8Array(size * size);
        const waterMask = new Uint8Array(size * size);
        const slopes = new Float32Array(size * size);

        // Calculate world coordinates
        const worldX = tileX * tileSize;
        const worldZ = tileZ * tileSize;
        const step = tileSize / (size - 1);

        // Generate heightmap
        this.generateHeightmap(heightmap, worldX, worldZ, step, size);

        // Apply hydraulic erosion for realistic terrain features
        this.applySimpleErosion(heightmap, size, 8);

        // Calculate derived data
        this.calculateNormals(heightmap, normals, size, step);
        this.calculateSlopes(heightmap, slopes, size, step);
        this.generateWaterBodies(heightmap, waterMask, size);
        this.assignBiomes(heightmap, slopes, materials, waterMask, size);

        return {
            heightmap,
            normals,
            materials,
            uvs: this.generateUVs(size),
            waterMask,
            slopes,
            textureIndices: new Uint8Array(size * size),
        };
    }

    /**
     * Generate the main heightmap using multi-octave FBM with proper erosion simulation
     */
    private generateHeightmap(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        // Generate base terrain using multi-octave Fractal Brownian Motion
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const x = worldX + j * step;
                const z = worldZ + i * step;
                const index = i * size + j;

                // Multi-octave FBM for realistic terrain base
                const baseElevation = this.generateRealisticTerrain(x, z);

                // Ensure proper sea level adherence (0 meters)
                heightmap[index] = baseElevation;
            }
        }
    }

    /**
     * Generate realistic terrain using proper multi-octave FBM
     */
    private generateRealisticTerrain(x: number, z: number): number {
        // Continental-scale landmass distribution
        const continentalNoise = this.fbm(x * 0.000005, z * 0.000005, 6, 2.0, 0.6);

        // Regional terrain features
        const regionalNoise = this.fbm(x * 0.00002, z * 0.00002, 5, 2.1, 0.55);

        // Mountain ridges using ridged noise
        const mountainNoise = this.ridgedNoise(x * 0.00008, z * 0.00008, 4);

        // Hills and valleys
        const hillNoise = this.fbm(x * 0.0003, z * 0.0003, 4, 2.0, 0.5);

        // Fine surface detail
        const detailNoise = this.fbm(x * 0.002, z * 0.002, 3, 2.0, 0.4);

        // Combine layers with realistic weighting
        let elevation = 0;

        // Continental base determines land vs water
        const landMask = Math.max(0, continentalNoise + 0.15); // Favor slightly more land

        if (landMask > 0) {
            // Land elevation calculation
            elevation += regionalNoise * 400; // Regional variations up to 400m
            elevation += Math.max(0, mountainNoise) * 800; // Mountains up to 800m additional
            elevation += hillNoise * 150; // Hills up to 150m
            elevation += detailNoise * 20; // Surface detail up to 20m

            // Apply land mask to ensure gradual transition to sea level
            elevation *= landMask;

            // Ensure minimum land elevation is slightly above sea level
            elevation = Math.max(1, elevation);
        } else {
            // Ocean depth calculation (below sea level = 0)
            const oceanDepth = Math.abs(continentalNoise + 0.15);
            elevation = -oceanDepth * 200; // Ocean depths up to -200m
        }

        // Clamp to realistic values with strict sea level adherence
        return Math.max(-500, Math.min(3000, elevation));
    }

    /**
     * Create natural mountain systems using realistic geological processes
     */
    private createNaturalMountains(x: number, z: number): number {
        // Multiple mountain chains with different orientations and scales - increased heights
        const chain1 = this.createMountainChain(x, z, 0.00008, 45, 1600);
        const chain2 = this.createMountainChain(x, z, 0.00006, 120, 1200);
        const chain3 = this.createMountainChain(x, z, 0.00012, 0, 800);

        // Take maximum to simulate overlapping mountain systems
        return Math.max(chain1, chain2, chain3);
    }

    /**
     * Create individual mountain chain with realistic orientation
     */
    private createMountainChain(
        x: number,
        z: number,
        frequency: number,
        rotation: number,
        maxHeight: number
    ): number {
        // Rotate coordinates for chain orientation
        const rad = (rotation * Math.PI) / 180;
        const rotX = x * Math.cos(rad) - z * Math.sin(rad);
        const rotZ = x * Math.sin(rad) + z * Math.cos(rad);

        // Ridge noise for mountain spine
        const ridgeNoise = Math.abs(this.perlin2D(rotX * frequency * 0.3, rotZ * frequency));
        const ridge = Math.pow(1 - ridgeNoise, 2);

        // Perpendicular noise for mountain width variation
        const widthNoise = this.fbm(rotX * frequency * 2, rotZ * frequency * 0.1, 3, 2.0, 0.6);
        const width = Math.max(0, widthNoise + 0.2);

        // Combine ridge and width for natural mountain shape
        return ridge * width * maxHeight;
    }

    /**
     * Create natural valley networks with realistic drainage patterns
     */
    private createNaturalValleys(x: number, z: number): number {
        // Primary drainage valleys
        const mainDrainage = this.createDrainageValley(x, z, 0.00015, 30, -80);
        const secondaryDrainage = this.createDrainageValley(x, z, 0.0003, 75, -40);
        const tertiaryDrainage = this.createDrainageValley(x, z, 0.0008, 150, -20);

        // Combine drainage systems
        return Math.min(mainDrainage, secondaryDrainage, tertiaryDrainage);
    }

    /**
     * Create individual drainage valley system
     */
    private createDrainageValley(
        x: number,
        z: number,
        frequency: number,
        rotation: number,
        depth: number
    ): number {
        // Rotate coordinates for valley orientation
        const rad = (rotation * Math.PI) / 180;
        const rotX = x * Math.cos(rad) - z * Math.sin(rad);
        const rotZ = x * Math.sin(rad) + z * Math.cos(rad);

        // Valley floor using inverse ridge noise
        const valleyNoise = Math.abs(this.perlin2D(rotX * frequency * 0.4, rotZ * frequency));
        const valleyProfile = 1 - Math.pow(valleyNoise, 0.6);

        // Meander factor for natural river curves
        const meander = this.fbm(rotZ * frequency * 0.05, rotX * frequency * 0.05, 2, 2.0, 0.8);
        const meanderOffset = meander * 200; // meters of lateral shift

        // Apply meander to valley position
        const meanderX = rotX + meanderOffset;
        const adjustedProfile = Math.abs(
            this.perlin2D(meanderX * frequency * 0.4, rotZ * frequency)
        );

        return Math.min(0, (1 - Math.pow(adjustedProfile, 0.6)) * depth);
    }

    /**
     * Apply natural coastal transition to prevent sharp boundaries
     */
    private applyNaturalCoastalTransition(elevation: number, x: number, z: number): number {
        // Add coastal erosion effects near sea level
        if (elevation > -100 && elevation < 200) {
            // Coastal erosion noise for natural shoreline irregularity
            const erosionNoise = this.fbm(x * 0.0005, z * 0.0005, 4, 2.2, 0.6);
            const erosionFactor = 0.3 + erosionNoise * 0.4;

            // Apply stronger erosion closer to sea level
            const distanceFromSeaLevel = Math.abs(elevation);
            const erosionStrength = Math.max(0, 1 - distanceFromSeaLevel / 150);

            elevation *= 1 - erosionStrength * erosionFactor * 0.5;
        }

        return elevation;
    }

    /**
     * Create valley patterns using multiple noise octaves
     */
    private createValleys(x: number, z: number): number {
        // Legacy method - replaced by createNaturalValleys
        return this.createNaturalValleys(x, z);
    }

    /**
     * Improved Perlin noise implementation
     */
    private perlin2D(x: number, y: number): number {
        // Find unit grid cell containing point
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        // Get relative position in cell
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);

        // Compute fade curves
        const u = this.fade(xf);
        const v = this.fade(yf);

        // Hash coordinates of corners
        const A = this.permutation[X] + Y;
        const B = this.permutation[X + 1] + Y;

        // Blend results from corners
        const res = this.lerp(
            v,
            this.lerp(
                u,
                this.grad2D(this.permutation[A], xf, yf),
                this.grad2D(this.permutation[B], xf - 1, yf)
            ),
            this.lerp(
                u,
                this.grad2D(this.permutation[A + 1], xf, yf - 1),
                this.grad2D(this.permutation[B + 1], xf - 1, yf - 1)
            )
        );

        return res;
    }

    /**
     * Fractal Brownian Motion - creates natural-looking terrain
     */
    private fbm(x: number, y: number, octaves: number, lacunarity: number, gain: number): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += this.perlin2D(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= gain;
            frequency *= lacunarity;
        }

        return value / maxValue;
    }

    /**
     * Ridged noise for mountain ranges
     */
    private ridgedNoise(x: number, y: number, octaves: number): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            let noise = Math.abs(this.perlin2D(x * frequency, y * frequency));
            noise = 1 - noise; // Create ridges
            noise = noise * noise; // Sharpen ridges
            value += noise * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2.1;
        }

        return (value / maxValue) * 2 - 1;
    }

    /**
     * Enhanced terrain curve for more realistic elevation distribution
     */
    private enhancedTerrainCurve(
        elevation: number,
        continental: number,
        mountains: number
    ): number {
        const normalized = elevation / 2000;

        // Ocean depths with realistic abyssal plains
        if (normalized < -0.2) {
            return elevation * 0.7 + continental * 0.2;
        }
        // Continental shelf
        else if (normalized < -0.05) {
            return elevation * 0.9;
        }
        // Coastal transition zone with realistic slopes
        else if (normalized < 0.02) {
            const transitionFactor = (normalized + 0.05) / 0.07;
            return elevation * (0.3 + transitionFactor * 0.4);
        }
        // Lowlands and plains
        else if (normalized < 0.1) {
            return (
                elevation * 0.8 + this.fbm(elevation * 0.01, continental * 0.01, 2, 2.0, 0.5) * 20
            );
        }
        // Hills with realistic slopes
        else if (normalized < 0.4) {
            const hillFactor = 1.0 + (normalized - 0.1) * 0.5;
            return elevation * hillFactor;
        }
        // Mountains with proper orographic effects
        else if (normalized < 0.8) {
            const mountainFactor = 1.2 + (mountains / 2000) * 0.3;
            return elevation * mountainFactor + 50;
        }
        // High peaks with snow line effects
        else {
            return elevation * 1.4 + 150;
        }
    }

    /**
     * Apply realistic hydraulic erosion simulation
     */
    private applySimpleErosion(heightmap: Float32Array, size: number, iterations: number): void {
        // Always apply a minimum of 5 iterations for realistic erosion
        const erosionIterations = Math.max(5, iterations);

        const temp = new Float32Array(heightmap.length);
        const waterMap = new Float32Array(heightmap.length);
        const sedimentMap = new Float32Array(heightmap.length);

        for (let iter = 0; iter < erosionIterations; iter++) {
            temp.set(heightmap);

            // Hydraulic erosion simulation
            this.simulateHydraulicErosion(heightmap, waterMap, sedimentMap, size);

            // Thermal erosion for natural slope stability
            if (iter % 2 === 0) {
                this.applyThermalErosion(heightmap, temp, size);
            }

            // Coastal smoothing to create natural shorelines
            this.smoothCoastalAreas(heightmap, size);
        }
    }

    /**
     * Enhanced thermal erosion - simulates rock weathering with improved realism
     */
    private applyEnhancedThermalErosion(
        heightmap: Float32Array,
        temp: Float32Array,
        size: number
    ): void {
        const talusAngle = 0.6; // Slightly more lenient maximum stable slope
        const erosionRate = 0.05; // Reduced for more gradual changes

        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const currentHeight = temp[index];

                // Calculate average slope to all neighbors
                let totalSlope = 0;
                let slopeCount = 0;
                const materialToMove = [];

                const neighbors = [
                    { di: -1, dj: 0, weight: 1.0 }, // N
                    { di: 1, dj: 0, weight: 1.0 }, // S
                    { di: 0, dj: -1, weight: 1.0 }, // W
                    { di: 0, dj: 1, weight: 1.0 }, // E
                    { di: -1, dj: -1, weight: 0.7 }, // NW
                    { di: -1, dj: 1, weight: 0.7 }, // NE
                    { di: 1, dj: -1, weight: 0.7 }, // SW
                    { di: 1, dj: 1, weight: 0.7 }, // SE
                ];

                for (const neighbor of neighbors) {
                    const ni = i + neighbor.di;
                    const nj = j + neighbor.dj;
                    const nIndex = ni * size + nj;

                    const heightDiff = currentHeight - temp[nIndex];
                    const distance = Math.sqrt(
                        neighbor.di * neighbor.di + neighbor.dj * neighbor.dj
                    );
                    const slope = heightDiff / distance;

                    if (slope > talusAngle) {
                        const excessSlope = slope - talusAngle;
                        const erosionAmount = excessSlope * erosionRate * neighbor.weight;
                        materialToMove.push({ index: nIndex, amount: erosionAmount });
                        totalSlope += excessSlope;
                        slopeCount++;
                    }
                }

                // Distribute material to neighbors proportionally
                if (materialToMove.length > 0 && totalSlope > 0) {
                    let totalMaterial = 0;
                    for (const movement of materialToMove) {
                        totalMaterial += movement.amount;
                    }

                    heightmap[index] -= totalMaterial;
                    for (const movement of materialToMove) {
                        heightmap[movement.index] += movement.amount;
                    }
                }
            }
        }
    }

    /**
     * Advanced hydraulic erosion simulation with realistic water flow
     */
    private simulateHydraulicErosion(
        heightmap: Float32Array,
        waterMap: Float32Array,
        sedimentMap: Float32Array,
        size: number
    ): void {
        const evaporationRate = 0.01;
        const sedimentCapacity = 4.0;
        const depositionRate = 0.3;
        const erosionRate = 0.3;
        const minSlope = 0.01;

        // Simulate droplet-based erosion
        const numDroplets = size * size * 0.1; // Reduced for performance

        for (let d = 0; d < numDroplets; d++) {
            // Random starting position
            let x = Math.random() * (size - 2) + 1;
            let z = Math.random() * (size - 2) + 1;
            let vx = 0,
                vz = 0;
            let water = 1.0;
            let sediment = 0;

            for (let lifetime = 0; lifetime < 30; lifetime++) {
                const ix = Math.floor(x);
                const iz = Math.floor(z);

                if (ix < 1 || ix >= size - 1 || iz < 1 || iz >= size - 1) break;

                const index = iz * size + ix;
                const currentHeight = heightmap[index];

                // Calculate height gradient
                const heightN = heightmap[(iz - 1) * size + ix];
                const heightS = heightmap[(iz + 1) * size + ix];
                const heightE = heightmap[iz * size + (ix + 1)];
                const heightW = heightmap[iz * size + (ix - 1)];

                const gradX = (heightE - heightW) * 0.5;
                const gradZ = (heightS - heightN) * 0.5;

                // Update velocity
                vx = vx * 0.9 - gradX;
                vz = vz * 0.9 - gradZ;

                // Limit speed
                const speed = Math.sqrt(vx * vx + vz * vz);
                if (speed > 1) {
                    vx /= speed;
                    vz /= speed;
                }

                // Update position
                x += vx;
                z += vz;

                // Calculate sediment capacity
                const capacity = Math.max(minSlope, speed) * water * sedimentCapacity;

                // Erosion/deposition
                if (sediment > capacity) {
                    // Deposit excess sediment
                    const deposited = (sediment - capacity) * depositionRate;
                    heightmap[index] += deposited;
                    sediment -= deposited;
                } else {
                    // Erode terrain
                    const maxErosion = Math.max(0, currentHeight - 0); // Don't erode below sea level
                    const eroded = Math.min((capacity - sediment) * erosionRate, maxErosion);
                    heightmap[index] -= eroded;
                    sediment += eroded;
                }

                // Evaporate water
                water *= 1 - evaporationRate;
                if (water < 0.01) break;
            }
        }
    }

    /**
     * Smooth coastal areas to create natural beach transitions
     */
    private smoothCoastalAreas(heightmap: Float32Array, size: number): void {
        const smoothed = new Float32Array(heightmap.length);
        smoothed.set(heightmap);

        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Only smooth areas near sea level for natural coastlines
                if (elevation >= -50 && elevation <= 50) {
                    let sum = 0;
                    let count = 0;

                    // 3x3 smoothing kernel
                    for (let di = -1; di <= 1; di++) {
                        for (let dj = -1; dj <= 1; dj++) {
                            const ni = i + di;
                            const nj = j + dj;

                            if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                                sum += heightmap[ni * size + nj];
                                count++;
                            }
                        }
                    }

                    if (count > 0) {
                        const smoothedValue = sum / count;
                        // Gentle blending to preserve detail
                        smoothed[index] = elevation * 0.7 + smoothedValue * 0.3;

                        // Ensure sea level constraint
                        if (smoothed[index] <= 0) {
                            smoothed[index] = Math.min(0, smoothed[index]);
                        }
                    }
                }
            }
        }

        heightmap.set(smoothed);
    }

    /**
     * Enhanced sediment deposition with realistic spreading
     */
    private depositSedimentEnhanced(
        heightmap: Float32Array,
        centerX: number,
        centerZ: number,
        amount: number,
        size: number,
        radius: number
    ): void {
        const intRadius = Math.ceil(radius);

        for (let dz = -intRadius; dz <= intRadius; dz++) {
            for (let dx = -intRadius; dx <= intRadius; dx++) {
                const x = centerX + dx;
                const z = centerZ + dz;

                if (x >= 0 && x < size && z >= 0 && z < size) {
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    if (distance <= radius) {
                        const weight = Math.max(0, 1 - distance / radius);
                        heightmap[z * size + x] += amount * weight;
                    }
                }
            }
        }
    }

    /**
     * Enhanced sediment erosion with realistic spreading
     */
    private erodeSedimentEnhanced(
        heightmap: Float32Array,
        centerX: number,
        centerZ: number,
        amount: number,
        size: number,
        radius: number
    ): void {
        const intRadius = Math.ceil(radius);

        for (let dz = -intRadius; dz <= intRadius; dz++) {
            for (let dx = -intRadius; dx <= intRadius; dx++) {
                const x = centerX + dx;
                const z = centerZ + dz;

                if (x >= 0 && x < size && z >= 0 && z < size) {
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    if (distance <= radius) {
                        const weight = Math.max(0, 1 - distance / radius);
                        heightmap[z * size + x] -= amount * weight;
                    }
                }
            }
        }
    }

    /**
     * Legacy thermal erosion method - replaced by enhanced version
     */
    private applyThermalErosion(heightmap: Float32Array, temp: Float32Array, size: number): void {
        // Delegate to enhanced version
        this.applyEnhancedThermalErosion(heightmap, temp, size);
    }

    /**
     * Hydraulic erosion - simulates water flow and sediment transport
     */
    private applyHydraulicErosion(
        heightmap: Float32Array,
        sediment: Float32Array,
        velocity: Float32Array,
        size: number
    ): void {
        const evaporationRate = 0.01;
        const sedimentCapacity = 4.0;
        const depositionRate = 0.3;
        const erosionRate = 0.3;

        // Simulate water droplets
        for (let drop = 0; drop < size * 2; drop++) {
            let x = Math.random() * (size - 1);
            let z = Math.random() * (size - 1);
            let vx = 0,
                vz = 0;
            let water = 1.0;
            let carriedSediment = 0;

            for (let step = 0; step < 30; step++) {
                const ix = Math.floor(x);
                const iz = Math.floor(z);

                if (ix < 1 || ix >= size - 1 || iz < 1 || iz >= size - 1) break;

                // Calculate gradient
                const index = iz * size + ix;
                const heightHere = heightmap[index];
                const gradX = (heightmap[index + 1] - heightmap[index - 1]) * 0.5;
                const gradZ = (heightmap[index + size] - heightmap[index - size]) * 0.5;

                // Update velocity
                vx = vx * 0.9 - gradX;
                vz = vz * 0.9 - gradZ;

                // Update position
                x += vx * 0.1;
                z += vz * 0.1;

                // Calculate sediment capacity
                const speed = Math.sqrt(vx * vx + vz * vz);
                const capacity = Math.max(0, speed * water * sedimentCapacity);

                // Erosion/Deposition
                if (carriedSediment > capacity) {
                    // Deposit sediment
                    const deposited = (carriedSediment - capacity) * depositionRate;
                    heightmap[index] += deposited;
                    carriedSediment -= deposited;
                } else {
                    // Erode terrain
                    const eroded = Math.min((capacity - carriedSediment) * erosionRate, heightHere);
                    heightmap[index] -= eroded;
                    carriedSediment += eroded;
                }

                // Evaporate water
                water *= 1 - evaporationRate;
                if (water < 0.01) break;
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

                // Sample neighboring heights
                const left = j > 0 ? heightmap[i * size + (j - 1)] : heightmap[index];
                const right = j < size - 1 ? heightmap[i * size + (j + 1)] : heightmap[index];
                const up = i > 0 ? heightmap[(i - 1) * size + j] : heightmap[index];
                const down = i < size - 1 ? heightmap[(i + 1) * size + j] : heightmap[index];

                // Calculate gradient
                const dx = (right - left) / (2 * step);
                const dz = (down - up) / (2 * step);

                // Create normal vector (pointing up from surface)
                const len = Math.sqrt(dx * dx + 1 + dz * dz);

                normals[index * 3] = -dx / len;
                normals[index * 3 + 1] = 1 / len;
                normals[index * 3 + 2] = -dz / len;
            }
        }
    }

    /**
     * Calculate slope at each point
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

                // Sample neighboring heights
                const center = heightmap[index];
                const left = j > 0 ? heightmap[i * size + (j - 1)] : center;
                const right = j < size - 1 ? heightmap[i * size + (j + 1)] : center;
                const up = i > 0 ? heightmap[(i - 1) * size + j] : center;
                const down = i < size - 1 ? heightmap[(i + 1) * size + j] : center;

                // Calculate maximum slope
                const dx = Math.max(Math.abs(center - left), Math.abs(center - right)) / step;
                const dz = Math.max(Math.abs(center - up), Math.abs(center - down)) / step;

                slopes[index] = Math.sqrt(dx * dx + dz * dz);
            }
        }
    }

    /**
     * Generate water bodies with strict sea level adherence (0 meters)
     */
    private generateWaterBodies(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Clear water mask first
        waterMask.fill(0);

        // Apply strict sea level rule: water only exists where elevation <= 0
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                if (elevation <= 0) {
                    waterMask[index] = 255; // Water present
                    // Ensure water surface is exactly at sea level
                    heightmap[index] = Math.min(0, elevation);
                } else {
                    waterMask[index] = 0; // No water
                }
            }
        }

        // Create realistic rivers in valleys above sea level
        this.generateRealitiscRivers(heightmap, waterMask, size);

        // Generate lakes in natural depressions above sea level
        this.generateMountainLakes(heightmap, waterMask, size);

        // Create natural coastlines
        this.generateNaturalCoastlines(heightmap, waterMask, size);
    }

    /**
     * Create a realistic drainage network using flow accumulation
     */
    private createDrainageNetwork(heightmap: Float32Array, size: number): Float32Array {
        const flowDirection = new Int8Array(size * size * 2); // x,y flow direction
        const flowAccumulation = new Float32Array(size * size);

        // Calculate flow directions using D8 algorithm
        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const currentElevation = heightmap[index];

                let steepestSlope = 0;
                let flowDirX = 0;
                let flowDirY = 0;

                // Check 8 neighbors
                const directions = [
                    { dx: -1, dy: -1 },
                    { dx: 0, dy: -1 },
                    { dx: 1, dy: -1 },
                    { dx: -1, dy: 0 },
                    { dx: 1, dy: 0 },
                    { dx: -1, dy: 1 },
                    { dx: 0, dy: 1 },
                    { dx: 1, dy: 1 },
                ];

                for (const dir of directions) {
                    const ni = i + dir.dy;
                    const nj = j + dir.dx;
                    const nIndex = ni * size + nj;
                    const neighborElevation = heightmap[nIndex];

                    const distance = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
                    const slope = (currentElevation - neighborElevation) / distance;

                    if (slope > steepestSlope) {
                        steepestSlope = slope;
                        flowDirX = dir.dx;
                        flowDirY = dir.dy;
                    }
                }

                flowDirection[index * 2] = flowDirX;
                flowDirection[index * 2 + 1] = flowDirY;
            }
        }

        // Calculate flow accumulation
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                flowAccumulation[index] = this.calculateUpstreamArea(
                    i,
                    j,
                    flowDirection,
                    size,
                    new Set()
                );
            }
        }

        return flowAccumulation;
    }

    /**
     * Calculate upstream drainage area recursively
     */
    private calculateUpstreamArea(
        i: number,
        j: number,
        flowDirection: Int8Array,
        size: number,
        visited: Set<number>
    ): number {
        const index = i * size + j;

        if (visited.has(index) || i < 0 || i >= size || j < 0 || j >= size) {
            return 0;
        }

        visited.add(index);
        let area = 1; // This cell contributes 1 unit

        // Check all neighbors to see if they flow into this cell
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;

                const ni = i + di;
                const nj = j + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const nIndex = ni * size + nj;
                    const flowX = flowDirection[nIndex * 2];
                    const flowY = flowDirection[nIndex * 2 + 1];

                    // If neighbor flows into this cell
                    if (ni + flowY === i && nj + flowX === j) {
                        area += this.calculateUpstreamArea(ni, nj, flowDirection, size, visited);
                    }
                }
            }
        }

        return area;
    }

    /**
     * Generate realistic rivers in valleys above sea level
     */
    private generateRealitiscRivers(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Find valleys for river placement
        for (let i = 2; i < size - 2; i++) {
            for (let j = 2; j < size - 2; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Only place rivers above sea level
                if (elevation <= 0) continue;

                // Check if this is a valley (lower than surrounding area)
                const isValley = this.isValleyPoint(heightmap, i, j, size);

                if (isValley && elevation > 5 && elevation < 300) {
                    // Probability based on elevation (more likely at lower elevations)
                    const riverProbability = Math.max(0, (300 - elevation) / 300) * 0.003;

                    if (Math.random() < riverProbability) {
                        // Create a small river
                        this.createRiverSegment(heightmap, waterMask, i, j, size, 1);
                    }
                }
            }
        }
    }

    /**
     * Generate mountain lakes in natural depressions above sea level
     */
    private generateMountainLakes(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Find suitable lake locations in mountainous areas
        for (let i = 3; i < size - 3; i++) {
            for (let j = 3; j < size - 3; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Only consider areas above sea level and not too high
                if (elevation <= 10 || elevation > 800 || waterMask[index] > 0) continue;

                // Check if this is a natural depression
                const isDepression = this.isNaturalDepression(heightmap, i, j, size);

                if (isDepression) {
                    const lakeProbability = Math.max(0, (elevation - 50) / 500) * 0.002;

                    if (Math.random() < lakeProbability) {
                        // Create a small mountain lake
                        const lakeSize = Math.random() * 3 + 1;
                        this.createSmallLake(heightmap, waterMask, i, j, size, lakeSize);
                    }
                }
            }
        }
    }

    /**
     * Analyze terrain depression for lake suitability
     */
    private analyzeDepression(
        centerI: number,
        centerJ: number,
        heightmap: Float32Array,
        size: number
    ): { isValid: boolean; depth: number; area: number } {
        const centerElevation = heightmap[centerI * size + centerJ];
        let minElevation = centerElevation;
        let maxElevation = centerElevation;
        let validCells = 0;
        const maxRadius = 8;

        for (let di = -maxRadius; di <= maxRadius; di++) {
            for (let dj = -maxRadius; dj <= maxRadius; dj++) {
                const ni = centerI + di;
                const nj = centerJ + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const nIndex = ni * size + nj;
                    const elevation = heightmap[nIndex];
                    const distance = Math.sqrt(di * di + dj * dj);

                    if (distance <= maxRadius) {
                        minElevation = Math.min(minElevation, elevation);
                        maxElevation = Math.max(maxElevation, elevation);

                        if (elevation <= centerElevation + 10) {
                            validCells++;
                        }
                    }
                }
            }
        }

        const depth = maxElevation - minElevation;
        const isValid = depth > 5 && validCells > 20;

        return { isValid, depth, area: validCells };
    }

    /**
     * Create a lake at specified location
     */
    private createLake(
        centerX: number,
        centerZ: number,
        elevation: number,
        area: number,
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        const lakeRadius = Math.sqrt(area / Math.PI);
        const waterLevel = elevation + 3;

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const dx = j - centerX;
                const dz = i - centerZ;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance <= lakeRadius) {
                    const index = i * size + j;
                    const terrainElevation = heightmap[index];

                    // Natural lake shape with depth variation
                    const depthFactor = 1 - distance / lakeRadius;
                    const lakeDepth = depthFactor * depthFactor * 8;

                    // Only place water in actual depressions above sea level
                    if (terrainElevation <= waterLevel && terrainElevation > 5) {
                        waterMask[index] = 255;
                        heightmap[index] = Math.min(terrainElevation, waterLevel - lakeDepth);
                    }
                }
            }
        }
    }

    /**
     * Generate natural coastlines with proper beach transitions
     */
    private generateNaturalCoastlines(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Process coastline areas (transition between land and sea)
                if (elevation >= -5 && elevation <= 20) {
                    // Check if this point is near the coastline
                    const nearCoast = this.isNearCoastline(heightmap, i, j, size);

                    if (nearCoast) {
                        // Create natural beach slope
                        const distanceToSea = this.getDistanceToSeaLevel(heightmap, i, j, size);

                        if (distanceToSea < 10 && elevation > 0) {
                            // Create gentle beach slope
                            const beachSlope = Math.max(0, elevation * (1 - distanceToSea / 10));
                            heightmap[index] = Math.max(0.5, beachSlope);
                        }

                        // Add some coastal variation with noise
                        const coastalNoise = this.perlin2D(i * 0.05, j * 0.05) * 3;
                        if (elevation > 2) {
                            heightmap[index] = Math.max(1, heightmap[index] + coastalNoise);
                        }
                    }
                }
            }
        }
    }

    /**
     * Assign biomes with smooth blending and realistic distribution
     */
    private assignBiomes(
        heightmap: Float32Array,
        slopes: Float32Array,
        materials: Uint8Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Create temperature and moisture maps for realistic biome distribution
        const temperatureMap = new Float32Array(size * size);
        const moistureMap = new Float32Array(size * size);
        const biomeMaps = new Map<number, Float32Array>();

        // Initialize biome influence maps
        for (let biomeId = 0; biomeId <= 11; biomeId++) {
            biomeMaps.set(biomeId, new Float32Array(size * size));
        }

        this.generateEnvironmentalMaps(temperatureMap, moistureMap, heightmap, size);
        this.calculateBiomeInfluences(
            biomeMaps,
            heightmap,
            slopes,
            temperatureMap,
            moistureMap,
            waterMask,
            size
        );
        this.blendBiomes(materials, biomeMaps, size);
    }

    /**
     * Generate temperature and moisture maps based on elevation and noise
     */
    private generateEnvironmentalMaps(
        temperatureMap: Float32Array,
        moistureMap: Float32Array,
        heightmap: Float32Array,
        size: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Temperature decreases with elevation (lapse rate ~6.5°C per 1000m)
                const baseTemperature = 20.0; // Base temperature at sea level in Celsius
                const lapseRate = 0.0065;
                const temperatureFromElevation =
                    baseTemperature - Math.max(0, elevation) * lapseRate;

                // Add large-scale temperature variation (latitude-like effect)
                const tempNoise = this.fbm(j * 0.000005, i * 0.000005, 3, 2.0, 0.5) * 15;
                temperatureMap[index] = temperatureFromElevation + tempNoise;

                // Moisture based on elevation, temperature, and noise
                const elevationMoisture = Math.max(0, Math.min(1, (2000 - elevation) / 2000));
                const temperatureMoisture = Math.max(
                    0,
                    Math.min(1, (temperatureMap[index] + 10) / 40)
                );
                const moistureNoise = this.fbm(j * 0.00001, i * 0.00001, 4, 2.2, 0.6) * 0.5 + 0.5;

                moistureMap[index] =
                    elevationMoisture * 0.4 + temperatureMoisture * 0.3 + moistureNoise * 0.3;
            }
        }
    }

    /**
     * Calculate influence strength for each biome at each point
     */
    private calculateBiomeInfluences(
        biomeMaps: Map<number, Float32Array>,
        heightmap: Float32Array,
        slopes: Float32Array,
        temperatureMap: Float32Array,
        moistureMap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];
                const slope = slopes[index];
                const temperature = temperatureMap[index];
                const moisture = moistureMap[index];

                // Water bodies (highest priority)
                if (waterMask[index] > 0) {
                    if (elevation < 0) {
                        biomeMaps.get(0)![index] = 1.0; // Ocean - only below sea level
                    } else if (elevation < 200) {
                        biomeMaps.get(11)![index] = 1.0; // River - only in valleys
                    } else {
                        biomeMaps.get(10)![index] = 1.0; // Lake - only in depressions
                    }
                    continue;
                }

                // Calculate biome suitability scores
                const biomeScores = this.calculateBiomeSuitability(
                    elevation,
                    slope,
                    temperature,
                    moisture
                );

                // Apply smoothing to create transition zones
                const transitionRadius = 3; // Pixels
                const smoothedScores = this.smoothBiomeScores(
                    biomeScores,
                    i,
                    j,
                    size,
                    transitionRadius,
                    heightmap,
                    slopes,
                    temperatureMap,
                    moistureMap
                );

                // Normalize and assign to biome maps
                const totalScore = Object.values(smoothedScores).reduce(
                    (sum, score) => sum + score,
                    0
                );
                if (totalScore > 0) {
                    for (const [biomeId, score] of Object.entries(smoothedScores)) {
                        const id = parseInt(biomeId);
                        biomeMaps.get(id)![index] = score / totalScore;
                    }
                }
            }
        }
    }

    /**
     * Calculate suitability scores for each biome type with smooth transitions
     */
    private calculateBiomeSuitability(
        elevation: number,
        slope: number,
        temperature: number,
        moisture: number
    ): { [biomeId: number]: number } {
        const scores: { [biomeId: number]: number } = {};

        // Smooth transition functions for better blending
        const smoothStep = (edge0: number, edge1: number, x: number): number => {
            const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
            return t * t * (3 - 2 * t);
        };

        const gaussianCurve = (x: number, center: number, width: number): number => {
            const d = (x - center) / width;
            return Math.exp(-0.5 * d * d);
        };

        // Ocean (0) - strictly below sea level with smooth depth falloff
        scores[0] = elevation <= 0 ? smoothStep(-200, 0, elevation) : 0;

        // Beach (1) - coastal areas with smooth elevation transition
        const beachElevationScore = smoothStep(0, 30, elevation) * smoothStep(30, 0, elevation);
        const beachSlopeScore = smoothStep(0.8, 0, slope);
        scores[1] = beachElevationScore * beachSlopeScore;

        // Grassland (2) - temperate lowlands with smooth parameter curves
        const grasslandTempScore = gaussianCurve(temperature, 15, 12);
        const grasslandMoistureScore = gaussianCurve(moisture, 0.6, 0.4);
        const grasslandElevationScore =
            smoothStep(10, 100, elevation) * smoothStep(600, 200, elevation);
        const grasslandSlopeScore = smoothStep(0.6, 0, slope);
        scores[2] =
            grasslandTempScore *
            grasslandMoistureScore *
            grasslandElevationScore *
            grasslandSlopeScore;

        // Forest (3) - higher moisture areas with smooth transitions
        const forestTempScore = gaussianCurve(temperature, 12, 15);
        const forestMoistureScore = smoothStep(0.4, 0.8, moisture);
        const forestElevationScore =
            smoothStep(20, 150, elevation) * smoothStep(1000, 400, elevation);
        const forestSlopeScore = smoothStep(0.7, 0, slope);
        scores[3] = forestTempScore * forestMoistureScore * forestElevationScore * forestSlopeScore;

        // Desert (4) - hot, dry areas with smooth boundaries
        const desertTempScore = smoothStep(18, 35, temperature);
        const desertMoistureScore = smoothStep(0.4, 0, moisture);
        const desertElevationScore = smoothStep(0, 50, elevation) * smoothStep(800, 200, elevation);
        scores[4] = desertTempScore * desertMoistureScore * desertElevationScore;

        // Mountain/Rock (5) - high elevation or steep slopes with smooth transitions
        const mountainElevationScore = smoothStep(400, 800, elevation);
        const mountainSlopeScore = smoothStep(0.3, 0.8, slope);
        scores[5] = Math.max(mountainElevationScore * 0.8, mountainSlopeScore);

        // Snow (6) - high elevation or very cold with smooth boundaries
        const snowElevationScore = smoothStep(1200, 2000, elevation);
        const snowTempScore = smoothStep(0, -10, temperature);
        scores[6] = Math.max(snowElevationScore, snowTempScore);

        // Tundra (7) - cold, dry areas with smooth parameter curves
        const tundraTempScore = gaussianCurve(temperature, -2, 8);
        const tundraMoistureScore = smoothStep(0.5, 0.1, moisture);
        const tundraElevationScore =
            smoothStep(50, 200, elevation) * smoothStep(600, 400, elevation);
        scores[7] = tundraTempScore * tundraMoistureScore * tundraElevationScore;

        // Wetland (8) - high moisture, low elevation with smooth curves
        const wetlandMoistureScore = smoothStep(0.7, 1.0, moisture);
        const wetlandElevationScore = smoothStep(150, 20, elevation);
        const wetlandSlopeScore = smoothStep(0.3, 0, slope);
        scores[8] = wetlandMoistureScore * wetlandElevationScore * wetlandSlopeScore;

        // Normalize scores to prevent over-saturation
        const maxScore = Math.max(...Object.values(scores));
        if (maxScore > 0) {
            for (const biomeId in scores) {
                scores[biomeId] /= maxScore;
            }
        }

        return scores;
    }

    /**
     * Smooth biome scores to create natural transition zones
     */
    private smoothBiomeScores(
        scores: { [biomeId: number]: number },
        centerI: number,
        centerJ: number,
        size: number,
        radius: number,
        heightmap: Float32Array,
        slopes: Float32Array,
        temperatureMap: Float32Array,
        moistureMap: Float32Array
    ): { [biomeId: number]: number } {
        const smoothedScores: { [biomeId: number]: number } = {};
        const neighborScores: { [biomeId: number]: number[] } = {};

        // Initialize arrays for each biome
        for (const biomeId of Object.keys(scores)) {
            const id = parseInt(biomeId);
            neighborScores[id] = [];
        }

        // Sample neighborhood
        for (let di = -radius; di <= radius; di++) {
            for (let dj = -radius; dj <= radius; dj++) {
                const ni = centerI + di;
                const nj = centerJ + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const nIndex = ni * size + nj;
                    const distance = Math.sqrt(di * di + dj * dj);
                    const weight = Math.max(0, 1 - distance / radius);

                    const biomeScores = this.calculateBiomeSuitability(
                        heightmap[nIndex],
                        slopes[nIndex],
                        temperatureMap[nIndex],
                        moistureMap[nIndex]
                    );

                    for (const [biomeId, score] of Object.entries(biomeScores)) {
                        const id = parseInt(biomeId);
                        if (!neighborScores[id]) neighborScores[id] = [];
                        neighborScores[id].push(score * weight);
                    }
                }
            }
        }

        // Average neighboring scores
        for (const [biomeId, scoreArray] of Object.entries(neighborScores)) {
            const id = parseInt(biomeId);
            const avgScore =
                scoreArray.length > 0
                    ? scoreArray.reduce((sum, s) => sum + s, 0) / scoreArray.length
                    : 0;
            smoothedScores[id] = avgScore;
        }

        return smoothedScores;
    }

    /**
     * Blend biomes based on their influence maps
     */
    private blendBiomes(
        materials: Uint8Array,
        biomeMaps: Map<number, Float32Array>,
        size: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;

                // Find dominant biome
                let maxInfluence = 0;
                let dominantBiome = 2; // Default to grassland

                for (const [biomeId, influenceMap] of biomeMaps.entries()) {
                    const influence = influenceMap[index];
                    if (influence > maxInfluence) {
                        maxInfluence = influence;
                        dominantBiome = biomeId;
                    }
                }

                materials[index] = dominantBiome;
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
     * Helper functions for noise generation
     */
    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    private grad2D(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * Helper methods for improved terrain generation
     */

    /**
     * Check if a point is in a valley (lower than surrounding terrain)
     */
    private isValleyPoint(heightmap: Float32Array, i: number, j: number, size: number): boolean {
        const centerHeight = heightmap[i * size + j];
        let lowerCount = 0;
        let totalCount = 0;

        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;

                const ni = i + di;
                const nj = j + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const neighborHeight = heightmap[ni * size + nj];
                    if (neighborHeight > centerHeight) {
                        lowerCount++;
                    }
                    totalCount++;
                }
            }
        }

        return lowerCount >= totalCount * 0.6;
    }

    /**
     * Check if a point is in a natural depression
     */
    private isNaturalDepression(
        heightmap: Float32Array,
        i: number,
        j: number,
        size: number
    ): boolean {
        const centerHeight = heightmap[i * size + j];
        const radius = 2;
        let higherCount = 0;
        let totalCount = 0;

        for (let di = -radius; di <= radius; di++) {
            for (let dj = -radius; dj <= radius; dj++) {
                if (di === 0 && dj === 0) continue;

                const ni = i + di;
                const nj = j + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const neighborHeight = heightmap[ni * size + nj];
                    if (neighborHeight > centerHeight + 5) {
                        // At least 5m higher
                        higherCount++;
                    }
                    totalCount++;
                }
            }
        }

        return higherCount >= totalCount * 0.4;
    }

    /**
     * Check if a point is near the coastline
     */
    private isNearCoastline(heightmap: Float32Array, i: number, j: number, size: number): boolean {
        const radius = 3;
        let hasWater = false;
        let hasLand = false;

        for (let di = -radius; di <= radius; di++) {
            for (let dj = -radius; dj <= radius; dj++) {
                const ni = i + di;
                const nj = j + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const height = heightmap[ni * size + nj];
                    if (height <= 0) {
                        hasWater = true;
                    } else {
                        hasLand = true;
                    }
                }
            }
        }

        return hasWater && hasLand;
    }

    /**
     * Get distance to sea level (0 meters)
     */
    private getDistanceToSeaLevel(
        heightmap: Float32Array,
        i: number,
        j: number,
        size: number
    ): number {
        const radius = 10;
        let minDistance = radius;

        for (let di = -radius; di <= radius; di++) {
            for (let dj = -radius; dj <= radius; dj++) {
                const ni = i + di;
                const nj = j + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const height = heightmap[ni * size + nj];
                    if (height <= 0) {
                        const distance = Math.sqrt(di * di + dj * dj);
                        minDistance = Math.min(minDistance, distance);
                    }
                }
            }
        }

        return minDistance;
    }

    /**
     * Create a river segment
     */
    private createRiverSegment(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        centerI: number,
        centerJ: number,
        size: number,
        width: number
    ): void {
        for (let di = -width; di <= width; di++) {
            for (let dj = -width; dj <= width; dj++) {
                const ni = centerI + di;
                const nj = centerJ + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const distance = Math.sqrt(di * di + dj * dj);
                    if (distance <= width) {
                        const index = ni * size + nj;
                        const currentHeight = heightmap[index];

                        if (currentHeight > 1) {
                            // Only above sea level
                            waterMask[index] = 255;
                            // Carve shallow river channel
                            const depth = (1 - distance / width) * 2;
                            heightmap[index] = Math.max(1, currentHeight - depth);
                        }
                    }
                }
            }
        }
    }

    /**
     * Create a small lake
     */
    private createSmallLake(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        centerI: number,
        centerJ: number,
        size: number,
        radius: number
    ): void {
        const centerHeight = heightmap[centerI * size + centerJ];

        for (let di = -Math.ceil(radius); di <= Math.ceil(radius); di++) {
            for (let dj = -Math.ceil(radius); dj <= Math.ceil(radius); dj++) {
                const ni = centerI + di;
                const nj = centerJ + dj;

                if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                    const distance = Math.sqrt(di * di + dj * dj);
                    if (distance <= radius) {
                        const index = ni * size + nj;
                        const currentHeight = heightmap[index];

                        if (currentHeight > 10) {
                            // Only in elevated areas
                            waterMask[index] = 255;
                            // Create lake depression
                            const depth = (1 - distance / radius) * 3;
                            heightmap[index] = Math.max(centerHeight - 2, currentHeight - depth);
                        }
                    }
                }
            }
        }
    }
}
