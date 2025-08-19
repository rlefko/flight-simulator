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
     * Generate the main heightmap using layered noise
     */
    private generateHeightmap(
        heightmap: Float32Array,
        worldX: number,
        worldZ: number,
        step: number,
        size: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const x = worldX + j * step;
                const z = worldZ + i * step;
                const index = i * size + j;

                // Layer 1: Continental shelf (very large scale) - INCREASED for visible continents
                const continental = this.fbm(x * 0.000008, z * 0.000008, 4, 2.0, 0.5) * 1500;

                // Layer 2: Mountain ranges (medium scale) - INCREASED for tall peaks
                const mountains = this.ridgedNoise(x * 0.00003, z * 0.00003, 4) * 2500;

                // Layer 3: Hills and valleys (smaller scale) - INCREASED for visible features
                const hills = this.fbm(x * 0.0001, z * 0.0001, 4, 2.2, 0.45) * 500;

                // Layer 4: Small details - INCREASED for better surface variation
                const details = this.fbm(x * 0.0005, z * 0.0005, 3, 2.0, 0.5) * 100;

                // Combine layers with proper weighting for dramatic terrain
                let elevation = continental * 0.3 + mountains * 0.4 + hills * 0.2 + details * 0.1;

                // Apply a curve to create more interesting terrain distribution
                elevation = this.terrainCurve(elevation);

                // Clamp to reasonable values - INCREASED for taller mountains
                elevation = Math.max(-500, Math.min(3500, elevation));

                heightmap[index] = elevation;
            }
        }
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
     * Apply terrain curve for more realistic elevation distribution
     */
    private terrainCurve(elevation: number): number {
        // Create more dramatic elevation changes for visibility
        const normalized = elevation / 2000; // Normalize to roughly -1 to 1

        if (normalized < -0.1) {
            // Deep ocean - keep deeper
            return elevation * 0.8;
        } else if (normalized < 0.05) {
            // Coastal areas and plains - keep flatter near sea level
            return elevation * 0.4;
        } else if (normalized < 0.3) {
            // Hills - more pronounced
            return elevation * 1.2;
        } else {
            // Mountains - much taller for visibility
            return elevation * 1.5 + 200; // Add base height to mountains
        }
    }

    /**
     * Simple erosion simulation
     */
    private applySimpleErosion(heightmap: Float32Array, size: number, iterations: number): void {
        const temp = new Float32Array(heightmap.length);

        for (let iter = 0; iter < iterations; iter++) {
            // Copy current heightmap
            temp.set(heightmap);

            // Apply smoothing kernel
            for (let i = 1; i < size - 1; i++) {
                for (let j = 1; j < size - 1; j++) {
                    const index = i * size + j;

                    // 3x3 averaging kernel
                    let sum = 0;
                    let count = 0;

                    for (let di = -1; di <= 1; di++) {
                        for (let dj = -1; dj <= 1; dj++) {
                            const ni = i + di;
                            const nj = j + dj;

                            if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
                                sum += temp[ni * size + nj];
                                count++;
                            }
                        }
                    }

                    // Blend original with smoothed (thermal erosion effect)
                    const smoothed = sum / count;
                    const diff = temp[index] - smoothed;

                    // Erode steep areas more
                    const erosionFactor = Math.min(1, Math.abs(diff) / 100) * 0.1;
                    heightmap[index] = temp[index] * (1 - erosionFactor) + smoothed * erosionFactor;
                }
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
     * Generate water bodies (lakes and rivers) based on terrain
     */
    private generateWaterBodies(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Create a temporary array to store local minima (potential lake centers)
        const localMinima: Array<{ x: number; z: number; elevation: number }> = [];

        // Find local minima that could be lakes
        for (let i = 2; i < size - 2; i++) {
            for (let j = 2; j < size - 2; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // Skip areas that are too high or already below sea level
                if (elevation < -2 || elevation > 500) continue;

                // Check if this is a local minimum
                let isMinimum = true;
                let minNeighborElevation = Infinity;

                for (let di = -2; di <= 2 && isMinimum; di++) {
                    for (let dj = -2; dj <= 2 && isMinimum; dj++) {
                        if (di === 0 && dj === 0) continue;

                        const ni = i + di;
                        const nj = j + dj;
                        const nIndex = ni * size + nj;
                        const nElevation = heightmap[nIndex];

                        minNeighborElevation = Math.min(minNeighborElevation, nElevation);

                        // Must be lower than neighbors to be a minimum
                        if (nElevation <= elevation) {
                            isMinimum = false;
                        }
                    }
                }

                // If it's a minimum and the depression is significant enough
                if (isMinimum && minNeighborElevation - elevation > 5) {
                    localMinima.push({ x: j, z: i, elevation });
                }
            }
        }

        // Generate lakes at local minima
        for (const minimum of localMinima) {
            const lakeRadius = 3 + Math.random() * 8; // Random lake size 3-11 cells
            const waterLevel = minimum.elevation + 2; // Water slightly above minimum

            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    const dx = j - minimum.x;
                    const dz = i - minimum.z;
                    const distance = Math.sqrt(dx * dx + dz * dz);

                    if (distance <= lakeRadius) {
                        const index = i * size + j;
                        const elevation = heightmap[index];

                        // Only create water if the terrain is below the water level
                        if (elevation <= waterLevel) {
                            waterMask[index] = 255;
                        }
                    }
                }
            }
        }

        // Generate some rivers by connecting low areas
        this.generateSimpleRivers(heightmap, waterMask, size);
    }

    /**
     * Generate simple rivers connecting low areas
     */
    private generateSimpleRivers(
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        // Find potential river start points (high areas)
        const riverSources: Array<{ x: number; z: number }> = [];

        for (let i = 10; i < size - 10; i += 20) {
            for (let j = 10; j < size - 10; j += 20) {
                const index = i * size + j;
                const elevation = heightmap[index];

                // High elevation areas can be river sources
                if (elevation > 100 && elevation < 800 && Math.random() < 0.3) {
                    riverSources.push({ x: j, z: i });
                }
            }
        }

        // Generate rivers from sources
        for (const source of riverSources) {
            this.generateRiverPath(source.x, source.z, heightmap, waterMask, size);
        }
    }

    /**
     * Generate a single river path using flow direction
     */
    private generateRiverPath(
        startX: number,
        startZ: number,
        heightmap: Float32Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        let currentX = startX;
        let currentZ = startZ;
        const maxLength = 100; // Maximum river length

        for (let step = 0; step < maxLength; step++) {
            const currentIndex = Math.floor(currentZ) * size + Math.floor(currentX);

            // Stop if we're out of bounds
            if (currentX < 1 || currentX >= size - 1 || currentZ < 1 || currentZ >= size - 1) break;

            const currentElevation = heightmap[currentIndex];

            // Stop if we hit existing water or reach sea level
            if (waterMask[currentIndex] > 0 || currentElevation < 1) break;

            // Mark current position as water (river)
            waterMask[currentIndex] = 255;

            // Find steepest descent direction
            let bestDirection = { x: 0, z: 0 };
            let steepestSlope = 0;

            const directions = [
                { x: -1, z: 0 },
                { x: 1, z: 0 },
                { x: 0, z: -1 },
                { x: 0, z: 1 },
                { x: -1, z: -1 },
                { x: 1, z: -1 },
                { x: -1, z: 1 },
                { x: 1, z: 1 },
            ];

            for (const dir of directions) {
                const newX = currentX + dir.x;
                const newZ = currentZ + dir.z;

                if (newX < 0 || newX >= size || newZ < 0 || newZ >= size) continue;

                const newIndex = Math.floor(newZ) * size + Math.floor(newX);
                const newElevation = heightmap[newIndex];
                const slope = currentElevation - newElevation;

                if (slope > steepestSlope) {
                    steepestSlope = slope;
                    bestDirection = dir;
                }
            }

            // If no downward slope found, stop
            if (steepestSlope <= 0) break;

            // Move in the steepest direction
            currentX += bestDirection.x;
            currentZ += bestDirection.z;
        }
    }

    /**
     * Assign biomes based on elevation and slope
     */
    private assignBiomes(
        heightmap: Float32Array,
        slopes: Float32Array,
        materials: Uint8Array,
        waterMask: Uint8Array,
        size: number
    ): void {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const index = i * size + j;
                const elevation = heightmap[index];
                const slope = slopes[index];

                // Determine biome based on elevation and slope
                // Check if already marked as water from rivers/lakes
                if (waterMask[index] > 0) {
                    // Water body (ocean, lake, or river)
                    if (elevation < 0) {
                        materials[index] = 0; // Ocean
                    } else if (elevation < 300) {
                        materials[index] = 11; // River
                    } else {
                        materials[index] = 10; // Lake
                    }
                } else if (elevation < 0) {
                    // Ocean
                    materials[index] = 0;
                    waterMask[index] = 255;
                } else if (elevation < 5) {
                    // Beach
                    materials[index] = 1;
                    waterMask[index] = 0;
                } else if (elevation < 100 && slope < 0.3) {
                    // Grassland
                    materials[index] = 2;
                    waterMask[index] = 0;
                } else if (elevation < 300 && slope < 0.5) {
                    // Forest
                    materials[index] = 3;
                    waterMask[index] = 0;
                } else if (elevation < 600 || slope > 0.7) {
                    // Mountain/Rock
                    materials[index] = 5;
                    waterMask[index] = 0;
                } else if (elevation > 1500) {
                    // Snow
                    materials[index] = 6;
                    waterMask[index] = 0;
                } else {
                    // Default to grassland
                    materials[index] = 2;
                    waterMask[index] = 0;
                }
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
