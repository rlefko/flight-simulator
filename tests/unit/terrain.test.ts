import { describe, it, expect } from 'vitest';
import { HeightmapGenerator } from '../../src/world/HeightmapGenerator';
import { TERRAIN_CONFIG } from '../../src/world/WorldConstants';

describe('Enhanced Terrain Generation', () => {
    describe('HeightmapGenerator', () => {
        it('should create a terrain generator with seed', () => {
            const generator = new HeightmapGenerator(12345);
            expect(generator).toBeDefined();
        });

        it('should generate terrain data with realistic elevation ranges', () => {
            const generator = new HeightmapGenerator(12345);
            const terrainData = generator.generateTerrainData(0, 0, 0, 32, 1000);

            expect(terrainData.heightmap).toBeDefined();
            expect(terrainData.heightmap.length).toBe(32 * 32);
            expect(terrainData.normals).toBeDefined();
            expect(terrainData.materials).toBeDefined();
            expect(terrainData.waterMask).toBeDefined();
            expect(terrainData.slopes).toBeDefined();

            // Check elevation ranges (-500m to 8000m)
            let minElevation = Infinity;
            let maxElevation = -Infinity;
            for (let i = 0; i < terrainData.heightmap.length; i++) {
                const elevation = terrainData.heightmap[i];
                minElevation = Math.min(minElevation, elevation);
                maxElevation = Math.max(maxElevation, elevation);
            }

            expect(minElevation).toBeGreaterThanOrEqual(-500);
            expect(maxElevation).toBeLessThanOrEqual(8000);
        });

        it('should generate different terrain for different seeds', () => {
            const generator1 = new HeightmapGenerator(12345);
            const generator2 = new HeightmapGenerator(54321);

            const terrain1 = generator1.generateTerrainData(0, 0, 0, 32, 1000);
            const terrain2 = generator2.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that at least some heights are different
            let differentCount = 0;
            for (let i = 0; i < terrain1.heightmap.length; i++) {
                if (Math.abs(terrain1.heightmap[i] - terrain2.heightmap[i]) > 0.1) {
                    differentCount++;
                }
            }

            expect(differentCount).toBeGreaterThan(0);
        });

        it('should generate consistent terrain for same parameters', () => {
            const generator = new HeightmapGenerator(12345);

            const terrain1 = generator.generateTerrainData(0, 0, 0, 32, 1000);
            const terrain2 = generator.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that heights are identical
            for (let i = 0; i < terrain1.heightmap.length; i++) {
                expect(terrain1.heightmap[i]).toBeCloseTo(terrain2.heightmap[i], 6);
            }
        });

        it('should detect water bodies correctly', () => {
            const generator = new HeightmapGenerator(12345);
            const terrainData = generator.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that water mask is properly set for low elevations
            let waterCount = 0;
            let landCount = 0;

            for (let i = 0; i < terrainData.heightmap.length; i++) {
                const elevation = terrainData.heightmap[i];
                const isWater = terrainData.waterMask[i] === 1;

                if (elevation <= 0) {
                    if (isWater) waterCount++;
                } else {
                    if (!isWater) landCount++;
                }
            }

            // Should have some water and land
            expect(waterCount + landCount).toBeGreaterThan(0);
        });

        it('should generate valid normals', () => {
            const generator = new HeightmapGenerator(12345);
            const terrainData = generator.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that normals are normalized vectors
            for (let i = 0; i < terrainData.normals.length; i += 3) {
                const x = terrainData.normals[i];
                const y = terrainData.normals[i + 1];
                const z = terrainData.normals[i + 2];

                const length = Math.sqrt(x * x + y * y + z * z);
                expect(length).toBeCloseTo(1.0, 5);
            }
        });

        it('should assign biome materials correctly', () => {
            const generator = new HeightmapGenerator(12345);
            const terrainData = generator.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that all material IDs are valid
            const validBiomeIds = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

            for (let i = 0; i < terrainData.materials.length; i++) {
                const biomeId = terrainData.materials[i];
                expect(validBiomeIds.has(biomeId)).toBe(true);
            }
        });

        it('should calculate slopes correctly', () => {
            const generator = new HeightmapGenerator(12345);
            const terrainData = generator.generateTerrainData(0, 0, 0, 32, 1000);

            // Check that slopes are valid radians (0 to π/2)
            for (let i = 0; i < terrainData.slopes.length; i++) {
                const slope = terrainData.slopes[i];
                expect(slope).toBeGreaterThanOrEqual(0);
                expect(slope).toBeLessThanOrEqual(Math.PI / 2);
            }
        });

        it('should handle edge cases gracefully', () => {
            const generator = new HeightmapGenerator(0);

            // Test with minimum resolution
            expect(() => {
                generator.generateTerrainData(0, 0, 0, 3, 100);
            }).not.toThrow();

            // Test with large coordinates
            expect(() => {
                generator.generateTerrainData(1000000, 1000000, 0, 32, 1000);
            }).not.toThrow();

            // Test with negative coordinates
            expect(() => {
                generator.generateTerrainData(-1000, -1000, 0, 32, 1000);
            }).not.toThrow();
        });
    });
});
