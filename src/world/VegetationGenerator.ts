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

    constructor(seed: number = 12345) {
        this.seed = seed;
        this.initializeTreeConfigs();
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
                density: 50,
                clusterProbability: 0.7,
                color: [0.2, 0.4, 0.1],
            },
            {
                type: VegetationType.BIRCH_TREE,
                minHeight: 12,
                maxHeight: 20,
                minRadius: 2,
                maxRadius: 4,
                density: 30,
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
                density: 5,
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
                density: 20,
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
                density: 3,
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
                density: 2,
                clusterProbability: 0.1,
                color: [0.3, 0.5, 0.2],
            },
        ]);
    }

    /**
     * Generate vegetation instances for a terrain tile
     */
    public generateVegetation(
        terrainData: TerrainData,
        tileSize: number,
        worldX: number,
        worldZ: number
    ): SceneryInstance[] {
        const instances: SceneryInstance[] = [];
        const resolution = Math.sqrt(terrainData.heightmap.length);
        const cellSize = tileSize / resolution;

        // Sample vegetation at regular intervals
        const sampleInterval = 5; // Sample every 5 cells

        for (let i = 0; i < resolution; i += sampleInterval) {
            for (let j = 0; j < resolution; j += sampleInterval) {
                const index = i * resolution + j;
                const biomeId = terrainData.materials[index];
                const elevation = terrainData.heightmap[index];
                const slope = terrainData.slopes ? terrainData.slopes[index] : 0;
                const isWater = terrainData.waterMask[index] > 0;

                // Skip water areas
                if (isWater || elevation < 1) continue;

                // Skip very steep slopes
                if (slope > 0.7) continue;

                // Get tree configs for this biome
                const configs = this.treeConfigs.get(biomeId);
                if (!configs || configs.length === 0) continue;

                // Generate trees based on density
                for (const config of configs) {
                    // Use seeded random for deterministic placement
                    const random = this.seededRandom(
                        worldX + j * cellSize,
                        worldZ + i * cellSize,
                        this.seed
                    );

                    // Check if we should place a tree here based on density
                    const placementChance = config.density / 1000; // Convert to probability
                    if (random > placementChance) continue;

                    // Calculate world position with some random offset
                    const offsetX = (this.seededRandom(j, i, this.seed + 1) - 0.5) * cellSize;
                    const offsetZ = (this.seededRandom(j, i, this.seed + 2) - 0.5) * cellSize;

                    const position = new Vector3(
                        worldX + j * cellSize + offsetX,
                        elevation,
                        worldZ + i * cellSize + offsetZ
                    );

                    // Random height and scale
                    const heightVar = this.seededRandom(j, i, this.seed + 3);
                    const height =
                        config.minHeight + (config.maxHeight - config.minHeight) * heightVar;
                    const radius =
                        config.minRadius + (config.maxRadius - config.minRadius) * heightVar;

                    // Random rotation
                    const rotation = new Vector3(
                        0,
                        this.seededRandom(j, i, this.seed + 4) * Math.PI * 2,
                        0
                    );

                    // Create instance
                    instances.push({
                        objectId: config.type,
                        position,
                        rotation,
                        scale: new Vector3(radius, height, radius),
                        distance: 0,
                        lodLevel: 0,
                        visible: true,
                        lastUpdate: Date.now(),
                    });

                    // Add cluster of trees if configured
                    if (random < config.clusterProbability) {
                        const clusterSize = 3 + Math.floor(random * 5);
                        for (let c = 0; c < clusterSize; c++) {
                            const clusterAngle = (c / clusterSize) * Math.PI * 2;
                            const clusterDist = 5 + random * 10;
                            const clusterPos = new Vector3(
                                position.x + Math.cos(clusterAngle) * clusterDist,
                                elevation,
                                position.z + Math.sin(clusterAngle) * clusterDist
                            );

                            instances.push({
                                objectId: config.type,
                                position: clusterPos,
                                rotation: new Vector3(0, random * Math.PI * 2, 0),
                                scale: new Vector3(radius * 0.8, height * 0.9, radius * 0.8),
                                distance: 0,
                                lodLevel: 0,
                                visible: true,
                                lastUpdate: Date.now(),
                            });
                        }
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
