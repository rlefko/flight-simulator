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

        // Apply erosion for more realistic terrain
        this.applySimpleErosion(heightmap, size, 10);

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
     * Generate the main heightmap using layered noise with enhanced realism
     */
    private generateHeightmap(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        // Pre-calculate noise layers for better performance and coherence
        const continentalNoise = new Float32Array(size * size);
        const mountainNoise = new Float32Array(size * size);
        const hillsNoise = new Float32Array(size * size);
        const valleyNoise = new Float32Array(size * size);
        const detailNoise = new Float32Array(size * size);

        // Generate base noise layers
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const x = worldX + j * step;
                const z = worldZ + i * step;
                const index = i * size + j;

                // Layer 1: Continental shelf (very large scale)
                continentalNoise[index] = this.fbm(x * 0.000005, z * 0.000005, 6, 2.1, 0.5);

                // Layer 2: Mountain ranges with realistic distribution
                const mountainMask = this.fbm(x * 0.00001, z * 0.00001, 3, 2.0, 0.6);
                mountainNoise[index] =
                    this.ridgedNoise(x * 0.00004, z * 0.00004, 5) * Math.max(0, mountainMask + 0.3);

                // Layer 3: Hills and valleys with realistic erosion patterns
                hillsNoise[index] = this.fbm(x * 0.0002, z * 0.0002, 5, 2.3, 0.4);

                // Layer 4: Valley carving for drainage patterns
                valleyNoise[index] = this.createValleys(x, z);

                // Layer 5: Fine surface details
                detailNoise[index] = this.fbm(x * 0.001, z * 0.001, 4, 2.1, 0.5);
            }
        }

        // Combine layers with realistic elevation distribution
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;

                // Base continental elevation (-200 to 800m)
                const continental = continentalNoise[index] * 500;

                // Mountain elevation (0 to 2500m) with realistic distribution
                const mountains = Math.max(0, mountainNoise[index]) * 2000;

                // Hills and valleys (-100 to 400m)
                const hills = hillsNoise[index] * 250;

                // Valley carving (subtracts elevation)
                const valleys = valleyNoise[index] * -150;

                // Surface details (-30 to 30m)
                const details = detailNoise[index] * 30;

                // Realistic elevation combination
                let elevation = continental + mountains + hills + valleys + details;

                // Apply terrain distribution curve for more realistic landforms
                elevation = this.enhancedTerrainCurve(elevation, continental, mountains);

                // Apply coastal erosion near sea level
                if (elevation > -50 && elevation < 100) {
                    const coastalErosion =
                        this.fbm(
                            (worldX + j * step) * 0.0001,
                            (worldZ + i * step) * 0.0001,
                            3,
                            2.0,
                            0.5
                        ) * 0.3;
                    elevation *= 1 - coastalErosion;
                }

                // Clamp to realistic values
                elevation = Math.max(-800, Math.min(4000, elevation));

                heightmap[index] = elevation;
            }
        }
    }

    /**
     * Create valley patterns using multiple noise octaves
     */
    private createValleys(x: number, z: number): number {
        // Create branching valley patterns
        const mainValleys = this.fbm(x * 0.00008, z * 0.00008, 3, 2.5, 0.4);
        const tributaries = this.fbm(x * 0.0003, z * 0.0003, 2, 2.0, 0.5);

        // Combine with ridged noise to create sharp valley cuts
        const valleyMask = Math.abs(this.ridgedNoise(x * 0.0001, z * 0.0001, 3));

        // Create valley effect (negative elevation where valleys should be)
        return Math.min(0, (mainValleys + tributaries * 0.3) * valleyMask - 0.3);
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
     * Advanced erosion simulation with hydraulic and thermal erosion
     */
    private applySimpleErosion(heightmap: Float32Array, size: number, iterations: number): void {
        const temp = new Float32Array(heightmap.length);
        const sediment = new Float32Array(heightmap.length);
        const velocity = new Float32Array(heightmap.length * 2); // x,y components

        for (let iter = 0; iter < iterations; iter++) {
            temp.set(heightmap);

            // Thermal erosion - smooth steep slopes
            this.applyThermalErosion(heightmap, temp, size);

            // Hydraulic erosion - simulate water flow and sediment transport
            if (iter % 3 === 0) {
                // Apply hydraulic erosion every 3rd iteration
                this.applyHydraulicErosion(heightmap, sediment, velocity, size);
            }
        }
    }

    /**
     * Thermal erosion - simulates rock weathering and gravity-driven material transport
     */
    private applyThermalErosion(heightmap: Float32Array, temp: Float32Array, size: number): void {
        const talusAngle = 0.7; // Maximum stable slope (in radians)

        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const currentHeight = temp[index];

                // Find steepest neighbor
                let maxHeightDiff = 0;
                let steepestNeighbor = -1;

                const neighbors = [
                    { di: -1, dj: 0 },
                    { di: 1, dj: 0 },
                    { di: 0, dj: -1 },
                    { di: 0, dj: 1 },
                    { di: -1, dj: -1 },
                    { di: -1, dj: 1 },
                    { di: 1, dj: -1 },
                    { di: 1, dj: 1 },
                ];

                for (let n = 0; n < neighbors.length; n++) {
                    const ni = i + neighbors[n].di;
                    const nj = j + neighbors[n].dj;
                    const nIndex = ni * size + nj;

                    const heightDiff = currentHeight - temp[nIndex];
                    const distance = Math.sqrt(
                        neighbors[n].di * neighbors[n].di + neighbors[n].dj * neighbors[n].dj
                    );
                    const slope = heightDiff / distance;

                    if (slope > maxHeightDiff && slope > talusAngle) {
                        maxHeightDiff = slope;
                        steepestNeighbor = nIndex;
                    }
                }

                // Transport material if slope is too steep
                if (steepestNeighbor >= 0) {
                    const erosionAmount = (maxHeightDiff - talusAngle) * 0.1;
                    heightmap[index] -= erosionAmount;
                    heightmap[steepestNeighbor] += erosionAmount;
                }
            }
        }
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
     * Generate realistic water bodies with proper drainage patterns
     */
    private generateWaterBodies(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Create drainage network
        const drainageMap = this.createDrainageNetwork(heightmap, size);

        // Generate rivers from drainage network
        this.generateRiversFromDrainage(heightmap, waterMask, drainageMap, size);

        // Generate lakes in natural depressions
        this.generateNaturalLakes(heightmap, waterMask, size);

        // Create coastal features
        this.generateCoastalFeatures(heightmap, waterMask, size);
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
     * Generate rivers based on drainage network
     */
    private generateRiversFromDrainage(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        drainageMap: Float32Array,
        size: number
    ): void {
        const riverThreshold = size * size * 0.0008; // Minimum drainage area for rivers

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const drainageArea = drainageMap[index];

                if (drainageArea > riverThreshold && heightmap[index] > 0) {
                    // Create river width based on drainage area
                    const riverWidth = Math.min(
                        3,
                        Math.max(1, Math.sqrt(drainageArea / riverThreshold))
                    );

                    // Mark river cells
                    for (let di = -Math.floor(riverWidth); di <= Math.floor(riverWidth); di++) {
                        for (let dj = -Math.floor(riverWidth); dj <= Math.floor(riverWidth); dj++) {
                            const ni = i + di;
                            const nj = j + dj;

                            if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                                const nIndex = ni * size + nj;
                                const distance = Math.sqrt(di * di + dj * dj);

                                if (distance <= riverWidth) {
                                    waterMask[nIndex] = 255;
                                    // Slightly lower the terrain for river channel
                                    heightmap[nIndex] -= 2 * (1 - distance / riverWidth);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Generate natural lakes in terrain depressions
     */
    private generateNaturalLakes(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Find natural depressions for lakes
        const depressions: Array<{ x: number; z: number; elevation: number; area: number }> = [];

        for (let i = 5; i < size - 5; i++) {
            for (let j = 5; j < size - 5; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Skip if too high, too low, or already water
                if (elevation < 10 || elevation > 800 || waterMask[index] > 0) continue;

                // Check if this could be a lake center
                const depression = this.analyzeDepression(i, j, heightmap, size);

                if (depression.isValid && depression.depth > 5 && depression.area > 20) {
                    depressions.push({
                        x: j,
                        z: i,
                        elevation: elevation,
                        area: depression.area,
                    });
                }
            }
        }

        // Create lakes at valid depressions
        for (const dep of depressions) {
            this.createLake(dep.x, dep.z, dep.elevation, dep.area, heightmap, waterMask, size);
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

                    if (terrainElevation <= waterLevel) {
                        waterMask[index] = 255;
                        heightmap[index] = Math.min(terrainElevation, waterLevel - lakeDepth);
                    }
                }
            }
        }
    }

    /**
     * Generate coastal features like bays and peninsulas
     */
    private generateCoastalFeatures(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        for (let i = 1; i < size - 1; i++) {
            for (let j = 1; j < size - 1; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Create coastal features near sea level
                if (elevation > -5 && elevation < 25) {
                    const coastalNoise = this.fbm(j * 0.02, i * 0.02, 3, 2.5, 0.6);

                    // Create bays and inlets
                    if (coastalNoise < -0.3 && elevation > 0) {
                        const bayDepth = Math.abs(coastalNoise) * 15;
                        heightmap[index] = Math.max(-10, elevation - bayDepth);

                        if (heightmap[index] < 2) {
                            waterMask[index] = 255;
                        }
                    }

                    // Create small peninsulas and headlands
                    else if (coastalNoise > 0.4 && elevation < 15) {
                        heightmap[index] += coastalNoise * 12;
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
                    if (elevation < 5) {
                        biomeMaps.get(0)![index] = 1.0; // Ocean
                    } else if (elevation < 300) {
                        biomeMaps.get(11)![index] = 1.0; // River
                    } else {
                        biomeMaps.get(10)![index] = 1.0; // Lake
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
     * Calculate suitability scores for each biome type
     */
    private calculateBiomeSuitability(
        elevation: number,
        slope: number,
        temperature: number,
        moisture: number
    ): { [biomeId: number]: number } {
        const scores: { [biomeId: number]: number } = {};

        // Ocean (0) - below sea level
        scores[0] = elevation < 15 ? Math.max(0, 15 - elevation) / 15 : 0;

        // Beach (1) - low elevation, near water, low slope
        scores[1] =
            elevation < 50 && elevation > 5 ? (((1 - slope) * (50 - elevation)) / 45) * 0.8 : 0;

        // Grassland (2) - moderate elevation, temperature, moisture
        const grasslandTemp = Math.max(0, 1 - Math.abs(temperature - 15) / 20);
        const grasslandMoisture = Math.max(0, 1 - Math.abs(moisture - 0.6) / 0.6);
        const grasslandElevation =
            elevation > 20 && elevation < 800
                ? Math.max(0, 1 - Math.abs(elevation - 200) / 600)
                : 0;
        scores[2] = grasslandTemp * grasslandMoisture * grasslandElevation * (1 - slope * 0.8);

        // Forest (3) - moderate elevation, high moisture, mild temperature
        const forestTemp =
            temperature > 5 && temperature < 25
                ? Math.max(0, 1 - Math.abs(temperature - 15) / 15)
                : 0;
        const forestMoisture = moisture > 0.4 ? (moisture - 0.4) / 0.6 : 0;
        const forestElevation =
            elevation > 50 && elevation < 1200
                ? Math.max(0, 1 - Math.abs(elevation - 400) / 800)
                : 0;
        scores[3] = forestTemp * forestMoisture * forestElevation * (1 - slope * 0.6);

        // Desert (4) - low moisture, high temperature
        const desertTemp = temperature > 20 ? Math.min(1, (temperature - 20) / 20) : 0;
        const desertMoisture = moisture < 0.3 ? (0.3 - moisture) / 0.3 : 0;
        const desertElevation =
            elevation > 0 && elevation < 1000 ? Math.max(0, 1 - elevation / 1000) : 0;
        scores[4] = desertTemp * desertMoisture * desertElevation;

        // Mountain/Rock (5) - high elevation or steep slope
        const mountainElevation = elevation > 600 ? Math.min(1, (elevation - 600) / 1000) : 0;
        const mountainSlope = slope > 0.5 ? Math.min(1, (slope - 0.5) / 0.5) : 0;
        scores[5] = Math.max(mountainElevation, mountainSlope * 0.8);

        // Snow (6) - very high elevation or very cold
        const snowElevation = elevation > 1500 ? Math.min(1, (elevation - 1500) / 1000) : 0;
        const snowTemp = temperature < -5 ? Math.min(1, (-5 - temperature) / 20) : 0;
        scores[6] = Math.max(snowElevation, snowTemp);

        // Tundra (7) - cold temperature, low moisture
        const tundraTemp =
            temperature < 5 && temperature > -15
                ? Math.max(0, 1 - Math.abs(temperature + 5) / 15)
                : 0;
        const tundraMoisture = moisture < 0.4 ? (0.4 - moisture) / 0.4 : 0;
        const tundraElevation =
            elevation > 100 && elevation < 800
                ? Math.max(0, 1 - Math.abs(elevation - 300) / 500)
                : 0;
        scores[7] = tundraTemp * tundraMoisture * tundraElevation;

        // Wetland (8) - high moisture, low elevation, low slope
        const wetlandMoisture = moisture > 0.7 ? (moisture - 0.7) / 0.3 : 0;
        const wetlandElevation = elevation < 100 ? (100 - elevation) / 100 : 0;
        scores[8] = wetlandMoisture * wetlandElevation * (1 - slope);

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

                    const neighborScores = this.calculateBiomeSuitability(
                        heightmap[nIndex],
                        slopes[nIndex],
                        temperatureMap[nIndex],
                        moistureMap[nIndex]
                    );

                    for (const [biomeId, score] of Object.entries(neighborScores)) {
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
}
