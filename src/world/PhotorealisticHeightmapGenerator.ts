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

                // Layer 1: Continental shelf (very large scale)
                const continental = this.fbm(x * 0.00001, z * 0.00001, 4, 2.0, 0.5) * 600;

                // Layer 2: Mountain ranges (medium scale)
                const mountains = this.ridgedNoise(x * 0.00005, z * 0.00005, 3) * 400;

                // Layer 3: Hills and valleys (smaller scale)
                const hills = this.fbm(x * 0.0002, z * 0.0002, 4, 2.2, 0.45) * 150;

                // Layer 4: Small details
                const details = this.fbm(x * 0.001, z * 0.001, 2, 2.0, 0.5) * 30;

                // Combine layers with proper weighting
                let elevation = continental * 0.4 + mountains * 0.3 + hills * 0.2 + details * 0.1;

                // Apply a curve to create more interesting terrain distribution
                elevation = this.terrainCurve(elevation);

                // Clamp to reasonable values
                elevation = Math.max(-200, Math.min(2000, elevation));

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
        // Create more flat areas at sea level and gentle slopes
        const normalized = elevation / 1000; // Normalize to roughly -1 to 1

        if (normalized < -0.1) {
            // Deep ocean
            return elevation * 0.5;
        } else if (normalized < 0.1) {
            // Coastal areas and plains
            return elevation * 0.3;
        } else if (normalized < 0.5) {
            // Hills
            return elevation * 0.7;
        } else {
            // Mountains
            return elevation;
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
                if (elevation < 0) {
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
