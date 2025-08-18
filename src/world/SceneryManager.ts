import { Vector3 } from '../core/math';
import { SCENERY_CONFIG, BIOME_CONFIG } from './WorldConstants';
import type { TerrainTile } from './TerrainTile';

/**
 * Types of scenery objects
 */
export enum SceneryType {
    TREE = 'tree',
    BUILDING = 'building',
    ROCK = 'rock',
    ROAD = 'road',
    LANDMARK = 'landmark',
    AIRPORT = 'airport',
    WATER_FEATURE = 'water_feature',
    VEGETATION_PATCH = 'vegetation_patch'
}

/**
 * Scenery object definition
 */
export interface SceneryObject {
    id: string;
    type: SceneryType;
    position: Vector3;
    rotation: Vector3; // Euler angles in radians
    scale: Vector3;
    modelPath?: string;
    lodLevel: number;
    biomeMask: number; // Bitfield of compatible biomes
    elevationRange: [number, number]; // Min/max elevation
    slopeRange: [number, number]; // Min/max slope in radians
    density: number; // Objects per square kilometer
    clusterSize?: number; // For grouped objects like forests
    metadata: Record<string, any>;
}

/**
 * Object instance for rendering
 */
export interface SceneryInstance {
    objectId: string;
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
    distance: number;
    lodLevel: number;
    visible: boolean;
    lastUpdate: number;
}

/**
 * Autogen rules for procedural object placement
 */
export interface AutogenRule {
    id: string;
    objectType: SceneryType;
    biomes: number[]; // Compatible biome IDs
    density: number; // Base density per km²
    minElevation: number;
    maxElevation: number;
    minSlope: number; // In radians
    maxSlope: number;
    avoidWater: boolean;
    clusterProbability: number; // 0-1
    clusterSize: [number, number]; // Min/max objects per cluster
    scaleVariation: [number, number]; // Min/max scale multiplier
    rotationVariation: boolean; // Random rotation
    priority: number; // Higher priority rules override lower
}

/**
 * Scenery generation statistics
 */
export interface SceneryStats {
    totalObjects: number;
    visibleObjects: number;
    instancedObjects: number;
    billboardObjects: number;
    drawCalls: number;
    memoryUsage: number;
    generationTime: number;
}

/**
 * Scenery LOD configuration
 */
interface SceneryLOD {
    distance: number;
    renderMode: 'full' | 'simplified' | 'billboard' | 'culled';
    meshComplexity: number; // 0-1
    textureResolution: number;
    instanceBatching: boolean;
}

/**
 * Advanced scenery management system with procedural generation and LOD
 */
export class SceneryManager {
    private sceneryObjects: Map<string, SceneryObject> = new Map();
    private sceneInstances: Map<string, SceneryInstance[]> = new Map();
    private autogenRules: AutogenRule[] = [];
    private generatedTiles: Set<string> = new Set();
    
    private lodLevels: SceneryLOD[] = [
        { distance: 0, renderMode: 'full', meshComplexity: 1.0, textureResolution: 1024, instanceBatching: false },
        { distance: 500, renderMode: 'simplified', meshComplexity: 0.7, textureResolution: 512, instanceBatching: true },
        { distance: 2000, renderMode: 'billboard', meshComplexity: 0.1, textureResolution: 128, instanceBatching: true },
        { distance: 10000, renderMode: 'culled', meshComplexity: 0, textureResolution: 0, instanceBatching: false }
    ];
    
    private stats: SceneryStats = {
        totalObjects: 0,
        visibleObjects: 0,
        instancedObjects: 0,
        billboardObjects: 0,
        drawCalls: 0,
        memoryUsage: 0,
        generationTime: 0
    };

    constructor() {
        this.initializeDefaultObjects();
        this.initializeAutogenRules();
    }

    /**
     * Generate scenery for a terrain tile
     */
    public generateSceneryForTile(tile: TerrainTile): void {
        if (this.generatedTiles.has(tile.id) || !tile.terrainData) {
            return;
        }

        const startTime = performance.now();
        const instances: SceneryInstance[] = [];

        // Generate objects based on autogen rules
        for (const rule of this.autogenRules) {
            const ruleInstances = this.applyAutogenRule(tile, rule);
            instances.push(...ruleInstances);
        }

        // Add manual placement objects if any
        const manualObjects = this.getManualObjectsForTile(tile);
        instances.push(...manualObjects);

        // Store instances
        this.sceneInstances.set(tile.id, instances);
        this.generatedTiles.add(tile.id);

        this.stats.generationTime += performance.now() - startTime;
        this.stats.totalObjects += instances.length;
    }

    /**
     * Update scenery LOD based on camera position
     */
    public updateSceneryLOD(cameraPosition: Vector3, visibleTiles: TerrainTile[]): void {
        this.stats.visibleObjects = 0;
        this.stats.instancedObjects = 0;
        this.stats.billboardObjects = 0;

        for (const tile of visibleTiles) {
            const instances = this.sceneInstances.get(tile.id);
            if (!instances) continue;

            for (const instance of instances) {
                // Calculate distance to camera
                instance.distance = instance.position.distanceTo(cameraPosition);
                
                // Determine LOD level
                instance.lodLevel = this.calculateLOD(instance.distance);
                const lod = this.lodLevels[instance.lodLevel];
                
                // Update visibility
                instance.visible = lod.renderMode !== 'culled';
                instance.lastUpdate = Date.now();

                if (instance.visible) {
                    this.stats.visibleObjects++;
                    
                    if (lod.instanceBatching) {
                        this.stats.instancedObjects++;
                    }
                    
                    if (lod.renderMode === 'billboard') {
                        this.stats.billboardObjects++;
                    }
                }
            }
        }
    }

    /**
     * Get visible instances for rendering
     */
    public getVisibleInstances(cameraPosition: Vector3): Map<SceneryType, SceneryInstance[]> {
        const visibleByType = new Map<SceneryType, SceneryInstance[]>();

        for (const instances of this.sceneInstances.values()) {
            for (const instance of instances) {
                if (!instance.visible) continue;

                const object = this.sceneryObjects.get(instance.objectId);
                if (!object) continue;

                if (!visibleByType.has(object.type)) {
                    visibleByType.set(object.type, []);
                }
                
                visibleByType.get(object.type)!.push(instance);
            }
        }

        return visibleByType;
    }

    /**
     * Get instances for instanced rendering
     */
    public getInstancedBatches(): Map<string, SceneryInstance[]> {
        const batches = new Map<string, SceneryInstance[]>();

        for (const instances of this.sceneInstances.values()) {
            for (const instance of instances) {
                if (!instance.visible) continue;

                const lod = this.lodLevels[instance.lodLevel];
                if (!lod.instanceBatching) continue;

                const object = this.sceneryObjects.get(instance.objectId);
                if (!object) continue;

                const batchKey = `${object.type}_${instance.lodLevel}`;
                if (!batches.has(batchKey)) {
                    batches.set(batchKey, []);
                }

                batches.get(batchKey)!.push(instance);
            }
        }

        return batches;
    }

    /**
     * Clear scenery for a tile
     */
    public clearTileScenery(tileId: string): void {
        const instances = this.sceneInstances.get(tileId);
        if (instances) {
            this.stats.totalObjects -= instances.length;
        }
        
        this.sceneInstances.delete(tileId);
        this.generatedTiles.delete(tileId);
    }

    /**
     * Add custom scenery object definition
     */
    public addSceneryObject(object: SceneryObject): void {
        this.sceneryObjects.set(object.id, object);
    }

    /**
     * Add autogen rule
     */
    public addAutogenRule(rule: AutogenRule): void {
        this.autogenRules.push(rule);
        this.autogenRules.sort((a, b) => b.priority - a.priority); // Sort by priority
    }

    /**
     * Get scenery statistics
     */
    public getStats(): SceneryStats {
        return { ...this.stats };
    }

    /**
     * Dispose of all scenery data
     */
    public dispose(): void {
        this.sceneInstances.clear();
        this.generatedTiles.clear();
        this.stats.totalObjects = 0;
    }

    // Private methods

    private initializeDefaultObjects(): void {
        // Define basic scenery objects
        
        // Trees
        this.addSceneryObject({
            id: 'pine_tree',
            type: SceneryType.TREE,
            position: new Vector3(),
            rotation: new Vector3(),
            scale: new Vector3(1, 1, 1),
            lodLevel: 0,
            biomeMask: this.createBiomeMask([BIOME_CONFIG.BIOMES.FOREST.id, BIOME_CONFIG.BIOMES.TUNDRA.id]),
            elevationRange: [0, 3000],
            slopeRange: [0, Math.PI / 4], // Up to 45 degrees
            density: 1000,
            clusterSize: 50,
            metadata: { windSway: true, seasonal: true }
        });

        this.addSceneryObject({
            id: 'oak_tree',
            type: SceneryType.TREE,
            position: new Vector3(),
            rotation: new Vector3(),
            scale: new Vector3(1, 1, 1),
            lodLevel: 0,
            biomeMask: this.createBiomeMask([BIOME_CONFIG.BIOMES.FOREST.id, BIOME_CONFIG.BIOMES.GRASSLAND.id]),
            elevationRange: [0, 1500],
            slopeRange: [0, Math.PI / 6], // Up to 30 degrees
            density: 800,
            clusterSize: 30,
            metadata: { windSway: true, seasonal: true }
        });

        // Buildings
        this.addSceneryObject({
            id: 'house_suburban',
            type: SceneryType.BUILDING,
            position: new Vector3(),
            rotation: new Vector3(),
            scale: new Vector3(1, 1, 1),
            lodLevel: 0,
            biomeMask: this.createBiomeMask([BIOME_CONFIG.BIOMES.GRASSLAND.id, BIOME_CONFIG.BIOMES.URBAN.id]),
            elevationRange: [0, 1000],
            slopeRange: [0, Math.PI / 8], // Up to 22.5 degrees
            density: 5,
            metadata: { hasLights: true, seasonal: false }
        });

        // Rocks
        this.addSceneryObject({
            id: 'boulder_granite',
            type: SceneryType.ROCK,
            position: new Vector3(),
            rotation: new Vector3(),
            scale: new Vector3(1, 1, 1),
            lodLevel: 0,
            biomeMask: this.createBiomeMask([
                BIOME_CONFIG.BIOMES.MOUNTAIN.id, 
                BIOME_CONFIG.BIOMES.DESERT.id,
                BIOME_CONFIG.BIOMES.TUNDRA.id
            ]),
            elevationRange: [500, 5000],
            slopeRange: [Math.PI / 8, Math.PI / 2], // 22.5 to 90 degrees
            density: 20,
            clusterSize: 5,
            metadata: { weathering: true }
        });
    }

    private initializeAutogenRules(): void {
        // Forest generation
        this.addAutogenRule({
            id: 'forest_dense',
            objectType: SceneryType.TREE,
            biomes: [BIOME_CONFIG.BIOMES.FOREST.id],
            density: 1500,
            minElevation: 0,
            maxElevation: 3000,
            minSlope: 0,
            maxSlope: Math.PI / 4,
            avoidWater: true,
            clusterProbability: 0.8,
            clusterSize: [30, 80],
            scaleVariation: [0.8, 1.3],
            rotationVariation: true,
            priority: 100
        });

        // Sparse trees in grassland
        this.addAutogenRule({
            id: 'grassland_scattered',
            objectType: SceneryType.TREE,
            biomes: [BIOME_CONFIG.BIOMES.GRASSLAND.id],
            density: 100,
            minElevation: 0,
            maxElevation: 2000,
            minSlope: 0,
            maxSlope: Math.PI / 6,
            avoidWater: true,
            clusterProbability: 0.3,
            clusterSize: [5, 15],
            scaleVariation: [0.7, 1.2],
            rotationVariation: true,
            priority: 80
        });

        // Mountain rocks
        this.addAutogenRule({
            id: 'mountain_rocks',
            objectType: SceneryType.ROCK,
            biomes: [BIOME_CONFIG.BIOMES.MOUNTAIN.id],
            density: 50,
            minElevation: 1000,
            maxElevation: 5000,
            minSlope: Math.PI / 8,
            maxSlope: Math.PI / 2,
            avoidWater: false,
            clusterProbability: 0.4,
            clusterSize: [3, 8],
            scaleVariation: [0.5, 2.0],
            rotationVariation: true,
            priority: 70
        });

        // Suburban buildings
        this.addAutogenRule({
            id: 'suburban_houses',
            objectType: SceneryType.BUILDING,
            biomes: [BIOME_CONFIG.BIOMES.GRASSLAND.id],
            density: 2,
            minElevation: 0,
            maxElevation: 500,
            minSlope: 0,
            maxSlope: Math.PI / 12, // Up to 15 degrees
            avoidWater: true,
            clusterProbability: 0.6,
            clusterSize: [4, 12],
            scaleVariation: [0.9, 1.1],
            rotationVariation: true,
            priority: 60
        });
    }

    private applyAutogenRule(tile: TerrainTile, rule: AutogenRule): SceneryInstance[] {
        if (!tile.terrainData || !tile.terrainData.materials) {
            return [];
        }

        const instances: SceneryInstance[] = [];
        const tileArea = tile.size * tile.size; // m²
        const kmArea = tileArea / 1000000; // Convert to km²
        
        // Calculate expected number of objects
        let expectedCount = Math.floor(rule.density * kmArea);
        
        // Use Poisson distribution for more natural distribution
        const actualCount = this.poissonRandom(expectedCount);
        
        for (let i = 0; i < actualCount; i++) {
            const instance = this.generateInstanceFromRule(tile, rule);
            if (instance) {
                instances.push(instance);
            }
        }

        return instances;
    }

    private generateInstanceFromRule(tile: TerrainTile, rule: AutogenRule): SceneryInstance | null {
        // Random position within tile
        const x = tile.worldBounds.minX + Math.random() * tile.size;
        const z = tile.worldBounds.minZ + Math.random() * tile.size;
        
        // Sample terrain data at this position
        const height = tile.getHeightAt(x, z);
        const materialId = this.sampleMaterial(tile, x, z);
        const slope = this.sampleSlope(tile, x, z);
        
        // Check biome compatibility
        if (!rule.biomes.includes(materialId)) {
            return null;
        }
        
        // Check elevation range
        if (height < rule.minElevation || height > rule.maxElevation) {
            return null;
        }
        
        // Check slope range
        if (slope < rule.minSlope || slope > rule.maxSlope) {
            return null;
        }
        
        // Check water avoidance
        if (rule.avoidWater && height <= 0) {
            return null;
        }
        
        // Find appropriate object for this rule
        const objectId = this.selectObjectForRule(rule);
        if (!objectId) {
            return null;
        }
        
        // Generate instance
        const position = new Vector3(x, height, z);
        
        const rotation = new Vector3(
            0,
            rule.rotationVariation ? Math.random() * Math.PI * 2 : 0,
            0
        );
        
        const scaleMultiplier = rule.scaleVariation[0] + 
            Math.random() * (rule.scaleVariation[1] - rule.scaleVariation[0]);
        const scale = new Vector3(scaleMultiplier, scaleMultiplier, scaleMultiplier);
        
        return {
            objectId,
            position,
            rotation,
            scale,
            distance: 0,
            lodLevel: 0,
            visible: false,
            lastUpdate: Date.now()
        };
    }

    private selectObjectForRule(rule: AutogenRule): string | null {
        // Find compatible objects
        const compatibleObjects = Array.from(this.sceneryObjects.values())
            .filter(obj => obj.type === rule.objectType);
        
        if (compatibleObjects.length === 0) {
            return null;
        }
        
        // Simple random selection - could be weighted based on preferences
        const randomIndex = Math.floor(Math.random() * compatibleObjects.length);
        return compatibleObjects[randomIndex].id;
    }

    private getManualObjectsForTile(tile: TerrainTile): SceneryInstance[] {
        // TODO: Load manual placement data from external files
        // This would include airports, landmarks, specific buildings, etc.
        return [];
    }

    private calculateLOD(distance: number): number {
        for (let i = 0; i < this.lodLevels.length - 1; i++) {
            if (distance < this.lodLevels[i + 1].distance) {
                return i;
            }
        }
        return this.lodLevels.length - 1;
    }

    private createBiomeMask(biomeIds: number[]): number {
        let mask = 0;
        for (const id of biomeIds) {
            mask |= (1 << id);
        }
        return mask;
    }

    private sampleMaterial(tile: TerrainTile, x: number, z: number): number {
        if (!tile.terrainData?.materials) return 0;
        
        // Convert world coordinates to tile-local coordinates
        const localX = (x - tile.worldBounds.minX) / tile.size;
        const localZ = (z - tile.worldBounds.minZ) / tile.size;
        
        const resolution = Math.sqrt(tile.terrainData.materials.length);
        const sampleX = Math.floor(localX * (resolution - 1));
        const sampleZ = Math.floor(localZ * (resolution - 1));
        
        const index = Math.min(sampleZ * resolution + sampleX, tile.terrainData.materials.length - 1);
        return tile.terrainData.materials[index];
    }

    private sampleSlope(tile: TerrainTile, x: number, z: number): number {
        if (!tile.terrainData?.slopes) return 0;
        
        // Convert world coordinates to tile-local coordinates
        const localX = (x - tile.worldBounds.minX) / tile.size;
        const localZ = (z - tile.worldBounds.minZ) / tile.size;
        
        const resolution = Math.sqrt(tile.terrainData.slopes.length);
        const sampleX = Math.floor(localX * (resolution - 1));
        const sampleZ = Math.floor(localZ * (resolution - 1));
        
        const index = Math.min(sampleZ * resolution + sampleX, tile.terrainData.slopes.length - 1);
        return tile.terrainData.slopes[index];
    }

    private poissonRandom(lambda: number): number {
        // Generate Poisson-distributed random number using Knuth's algorithm
        if (lambda < 30) {
            const L = Math.exp(-lambda);
            let k = 0;
            let p = 1;
            
            do {
                k++;
                p *= Math.random();
            } while (p > L);
            
            return k - 1;
        } else {
            // For large lambda, use normal approximation
            const normal = this.normalRandom(lambda, Math.sqrt(lambda));
            return Math.max(0, Math.round(normal));
        }
    }

    private normalRandom(mean: number, stdDev: number): number {
        // Box-Muller transform for normal distribution
        let u = 0, v = 0;
        while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
        while (v === 0) v = Math.random();
        
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        return z * stdDev + mean;
    }
}