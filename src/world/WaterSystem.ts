import { Vector3 } from '../core/math';
import { WATER_CONFIG, TERRAIN_CONFIG } from './WorldConstants';
import type { TerrainTile } from './TerrainTile';

/**
 * Water body types
 */
export enum WaterType {
    OCEAN = 'ocean',
    LAKE = 'lake',
    RIVER = 'river',
    STREAM = 'stream',
    POND = 'pond',
}

/**
 * Water surface properties
 */
export interface WaterSurface {
    id: string;
    type: WaterType;
    center: Vector3;
    bounds: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    averageDepth: number;
    maxDepth: number;
    flowDirection?: Vector3; // For rivers and streams
    flowSpeed?: number; // m/s
    temperature: number; // Celsius
    salinity: number; // 0-1 (0 = fresh water, 1 = very salty)
    clarity: number; // 0-1 (0 = murky, 1 = crystal clear)
    waveHeight: number;
    windDirection: Vector3;
    windSpeed: number;
}

/**
 * Wave simulation parameters
 */
export interface WaveParams {
    amplitude: number;
    frequency: number;
    phase: number;
    speed: number;
    direction: Vector3;
    steepness: number;
}

/**
 * Water rendering properties
 */
export interface WaterRenderData {
    vertices: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
    uvs: Float32Array;
    waveData: Float32Array; // Wave parameters per vertex
    depthData: Float32Array; // Depth information
    foamMask: Uint8Array; // Where to render foam
    vertexCount: number;
    triangleCount: number;
}

/**
 * Shore detection result
 */
export interface ShoreData {
    isShore: boolean;
    distanceToShore: number;
    shoreNormal: Vector3;
    foamIntensity: number;
    waveBreaking: boolean;
}

/**
 * Water physics simulation state
 */
interface WaterPhysics {
    wavePhase: number;
    currentTime: number;
    windDirection: Vector3;
    windSpeed: number;
    waveComponents: WaveParams[];
}

/**
 * Water system statistics
 */
export interface WaterStats {
    activeSurfaces: number;
    totalVertices: number;
    simulatedWaves: number;
    renderDistance: number;
    memoryUsage: number;
    simulationTime: number;
    foamParticles: number;
}

/**
 * Advanced water rendering and simulation system
 */
export class WaterSystem {
    private waterSurfaces: Map<string, WaterSurface> = new Map();
    private renderData: Map<string, WaterRenderData> = new Map();
    private physics: WaterPhysics;

    private waterTiles: Map<string, TerrainTile[]> = new Map();
    private shoreCache: Map<string, ShoreData> = new Map();

    private stats: WaterStats = {
        activeSurfaces: 0,
        totalVertices: 0,
        simulatedWaves: 0,
        renderDistance: 0,
        memoryUsage: 0,
        simulationTime: 0,
        foamParticles: 0,
    };

    constructor() {
        this.physics = {
            wavePhase: 0,
            currentTime: 0,
            windDirection: new Vector3(...WATER_CONFIG.WAVES.direction).normalize(),
            windSpeed: WATER_CONFIG.WAVES.windSpeed,
            waveComponents: this.generateWaveComponents(),
        };
    }

    /**
     * Update water system for current frame
     */
    public update(deltaTime: number, cameraPosition: Vector3): void {
        const startTime = performance.now();

        this.physics.currentTime += deltaTime;
        this.physics.wavePhase += deltaTime * WATER_CONFIG.WAVES.speed;

        // Update wave simulation
        this.updateWavePhysics(deltaTime);

        // Update water surfaces based on camera position
        this.updateActiveSurfaces(cameraPosition);

        // Generate water geometry for visible surfaces
        this.updateWaterGeometry(cameraPosition);

        this.stats.simulationTime = performance.now() - startTime;
    }

    /**
     * Detect and extract water surfaces from terrain tiles
     */
    public extractWaterFromTerrain(tiles: TerrainTile[]): void {
        let waterBodiesFound = 0;
        for (const tile of tiles) {
            if (!tile.terrainData?.waterMask) continue;

            const waterBodies = this.findWaterBodies(tile);
            waterBodiesFound += waterBodies.length;

            for (const waterBody of waterBodies) {
                console.log(
                    'WaterSystem: Found water body',
                    waterBody.id,
                    'type:',
                    waterBody.type,
                    'center:',
                    waterBody.center.x.toFixed(0),
                    waterBody.center.z.toFixed(0)
                );
                this.waterSurfaces.set(waterBody.id, waterBody);

                if (!this.waterTiles.has(waterBody.id)) {
                    this.waterTiles.set(waterBody.id, []);
                }
                this.waterTiles.get(waterBody.id)!.push(tile);
            }
        }

        if (waterBodiesFound > 0) {
            console.log('WaterSystem: Total water surfaces:', this.waterSurfaces.size);
        }
    }

    /**
     * Get water height at specific world coordinates
     */
    public getWaterHeightAt(x: number, z: number, time?: number): number {
        const currentTime = time ?? this.physics.currentTime;
        let waterLevel = WATER_CONFIG.SEA_LEVEL;
        let waveHeight = 0;

        // Find water surface at this location
        const waterSurface = this.findWaterSurfaceAt(x, z);
        if (!waterSurface) {
            return waterLevel; // Return sea level if no water body found
        }

        // Calculate wave displacement
        for (const wave of this.physics.waveComponents) {
            const phaseShift = wave.direction.x * x + wave.direction.z * z;
            const wavePhase = wave.frequency * currentTime + wave.phase + phaseShift;
            waveHeight += wave.amplitude * Math.sin(wavePhase);
        }

        return waterLevel + waveHeight * waterSurface.waveHeight;
    }

    /**
     * Get water surface normal for lighting and reflections
     */
    public getWaterNormalAt(x: number, z: number, time?: number): Vector3 {
        const currentTime = time ?? this.physics.currentTime;
        const epsilon = 1.0; // Sample distance for gradient calculation

        // Calculate gradient using finite differences
        const heightCenter = this.getWaterHeightAt(x, z, currentTime);
        const heightRight = this.getWaterHeightAt(x + epsilon, z, currentTime);
        const heightFront = this.getWaterHeightAt(x, z + epsilon, currentTime);

        // Calculate normal from gradient
        const dx = (heightRight - heightCenter) / epsilon;
        const dz = (heightFront - heightCenter) / epsilon;

        return new Vector3(-dx, 1, -dz).normalize();
    }

    /**
     * Check if point is underwater
     */
    public isUnderwater(x: number, z: number, y: number, time?: number): boolean {
        const waterHeight = this.getWaterHeightAt(x, z, time);
        return y < waterHeight;
    }

    /**
     * Get shore data for foam and wave breaking effects
     */
    public getShoreDataAt(x: number, z: number): ShoreData {
        const cacheKey = `${Math.floor(x / 10)}_${Math.floor(z / 10)}`; // 10m resolution cache

        if (this.shoreCache.has(cacheKey)) {
            return this.shoreCache.get(cacheKey)!;
        }

        const shoreData = this.calculateShoreData(x, z);
        this.shoreCache.set(cacheKey, shoreData);

        // Limit cache size
        if (this.shoreCache.size > 10000) {
            const firstKey = this.shoreCache.keys().next().value;
            this.shoreCache.delete(firstKey);
        }

        return shoreData;
    }

    /**
     * Get water render data for a specific surface
     */
    public getWaterRenderData(surfaceId: string): WaterRenderData | null {
        return this.renderData.get(surfaceId) || null;
    }

    /**
     * Get all visible water surfaces
     */
    public getVisibleSurfaces(cameraPosition: Vector3, viewDistance: number): WaterSurface[] {
        const visibleSurfaces: WaterSurface[] = [];

        for (const surface of this.waterSurfaces.values()) {
            const distance = surface.center.distanceTo(cameraPosition);
            if (distance <= viewDistance) {
                visibleSurfaces.push(surface);
            }
        }

        return visibleSurfaces;
    }

    /**
     * Add custom water surface
     */
    public addWaterSurface(surface: WaterSurface): void {
        this.waterSurfaces.set(surface.id, surface);
    }

    /**
     * Remove water surface
     */
    public removeWaterSurface(surfaceId: string): void {
        this.waterSurfaces.delete(surfaceId);
        this.renderData.delete(surfaceId);
        this.waterTiles.delete(surfaceId);
    }

    /**
     * Get system statistics
     */
    public getStats(): WaterStats {
        return { ...this.stats };
    }

    /**
     * Clear all water data
     */
    public clear(): void {
        this.waterSurfaces.clear();
        this.renderData.clear();
        this.waterTiles.clear();
        this.shoreCache.clear();
        this.stats.activeSurfaces = 0;
    }

    // Private methods

    private generateWaveComponents(): WaveParams[] {
        const components: WaveParams[] = [];
        const baseFrequency = WATER_CONFIG.WAVES.frequency;
        const baseAmplitude = WATER_CONFIG.WAVES.amplitude;

        // Generate multiple wave components for realistic water
        const waveCount = 4;
        for (let i = 0; i < waveCount; i++) {
            const frequency = baseFrequency * Math.pow(2, i);
            const amplitude = baseAmplitude / Math.pow(2, i);
            const angle = (Math.PI * 2 * i) / waveCount + Math.random() * 0.5;

            components.push({
                amplitude,
                frequency,
                phase: Math.random() * Math.PI * 2,
                speed: WATER_CONFIG.WAVES.speed,
                direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize(),
                steepness: WATER_CONFIG.WAVES.choppy / (frequency * amplitude * waveCount),
            });
        }

        return components;
    }

    private updateWavePhysics(deltaTime: number): void {
        // Update wind-driven waves
        for (const wave of this.physics.waveComponents) {
            wave.phase += wave.frequency * deltaTime;

            // Modulate amplitude based on wind speed
            const windEffect = Math.min(1, this.physics.windSpeed / 20); // Normalize wind speed
            wave.amplitude *= 0.9 + 0.2 * windEffect; // Subtle wind influence
        }

        this.stats.simulatedWaves = this.physics.waveComponents.length;
    }

    private updateActiveSurfaces(cameraPosition: Vector3): void {
        this.stats.activeSurfaces = 0;
        const maxDistance = 50000; // 50km visibility

        for (const [surfaceId, surface] of this.waterSurfaces) {
            const distance = surface.center.distanceTo(cameraPosition);

            if (distance <= maxDistance) {
                this.stats.activeSurfaces++;
            }
        }
    }

    private updateWaterGeometry(cameraPosition: Vector3): void {
        this.stats.totalVertices = 0;

        for (const [surfaceId, surface] of this.waterSurfaces) {
            const distance = surface.center.distanceTo(cameraPosition);
            const maxDistance = 10000; // 10km for detailed water mesh

            if (distance <= maxDistance) {
                const renderData = this.generateWaterMesh(surface, distance);
                this.renderData.set(surfaceId, renderData);
                this.stats.totalVertices += renderData.vertexCount;
            }
        }
    }

    private findWaterBodies(tile: TerrainTile): WaterSurface[] {
        if (!tile.terrainData?.waterMask || !tile.terrainData.heightmap) {
            return [];
        }

        const waterBodies: WaterSurface[] = [];
        const resolution = Math.sqrt(tile.terrainData.waterMask.length);
        const waterMask = tile.terrainData.waterMask;
        const heightmap = tile.terrainData.heightmap;

        // Find connected water regions using flood fill
        const visited = new Set<number>();

        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const index = i * resolution + j;

                if (waterMask[index] && !visited.has(index)) {
                    const waterRegion = this.floodFillWater(waterMask, visited, j, i, resolution);

                    if (waterRegion.length > 10) {
                        // Minimum size threshold
                        const waterBody = this.createWaterSurfaceFromRegion(
                            tile,
                            waterRegion,
                            heightmap,
                            resolution
                        );
                        waterBodies.push(waterBody);
                    }
                }
            }
        }

        return waterBodies;
    }

    private floodFillWater(
        waterMask: Uint8Array,
        visited: Set<number>,
        startX: number,
        startZ: number,
        resolution: number
    ): number[] {
        const region: number[] = [];
        const stack: [number, number][] = [[startX, startZ]];

        while (stack.length > 0) {
            const [x, z] = stack.pop()!;

            if (x < 0 || x >= resolution || z < 0 || z >= resolution) continue;

            const index = z * resolution + x;

            if (visited.has(index) || !waterMask[index]) continue;

            visited.add(index);
            region.push(index);

            // Add neighboring cells
            stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
        }

        return region;
    }

    private createWaterSurfaceFromRegion(
        tile: TerrainTile,
        region: number[],
        heightmap: Float32Array,
        resolution: number
    ): WaterSurface {
        let minX = Infinity,
            maxX = -Infinity;
        let minZ = Infinity,
            maxZ = -Infinity;
        let totalDepth = 0;
        let maxDepth = 0;
        let centerX = 0,
            centerZ = 0;

        // Calculate bounds and properties
        for (const index of region) {
            const localX = index % resolution;
            const localZ = Math.floor(index / resolution);

            const worldX = tile.worldBounds.minX + (localX / (resolution - 1)) * tile.size;
            const worldZ = tile.worldBounds.minZ + (localZ / (resolution - 1)) * tile.size;
            const height = heightmap[index];
            const depth = Math.max(0, -height); // Depth below water level

            minX = Math.min(minX, worldX);
            maxX = Math.max(maxX, worldX);
            minZ = Math.min(minZ, worldZ);
            maxZ = Math.max(maxZ, worldZ);

            centerX += worldX;
            centerZ += worldZ;
            totalDepth += depth;
            maxDepth = Math.max(maxDepth, depth);
        }

        centerX /= region.length;
        centerZ /= region.length;

        const averageDepth = totalDepth / region.length;
        const area = (maxX - minX) * (maxZ - minZ);

        // Determine water type based on size and characteristics
        let waterType: WaterType;
        if (area > 1000000) {
            // > 1 km²
            waterType = WaterType.OCEAN;
        } else if (area > 10000) {
            // > 1 hectare
            waterType = WaterType.LAKE;
        } else {
            waterType = WaterType.POND;
        }

        return {
            id: `water_${tile.id}_${Date.now()}`,
            type: waterType,
            center: new Vector3(centerX, WATER_CONFIG.SEA_LEVEL, centerZ),
            bounds: { minX, maxX, minZ, maxZ },
            averageDepth,
            maxDepth,
            temperature: 15, // Default temperature
            salinity: waterType === WaterType.OCEAN ? 0.35 : 0, // Ocean vs fresh water
            clarity: 0.8,
            waveHeight: waterType === WaterType.OCEAN ? 1.0 : 0.3,
            windDirection: new Vector3(...WATER_CONFIG.WAVES.direction).normalize(),
            windSpeed: WATER_CONFIG.WAVES.windSpeed,
        };
    }

    private findWaterSurfaceAt(x: number, z: number): WaterSurface | null {
        for (const surface of this.waterSurfaces.values()) {
            if (
                x >= surface.bounds.minX &&
                x <= surface.bounds.maxX &&
                z >= surface.bounds.minZ &&
                z <= surface.bounds.maxZ
            ) {
                return surface;
            }
        }
        return null;
    }

    private calculateShoreData(x: number, z: number): ShoreData {
        const searchRadius = WATER_CONFIG.SHORE.detectionRadius;
        let nearestShoreDistance = Infinity;
        let shoreNormal = new Vector3(0, 1, 0);
        let isShore = false;

        // Sample points around the position to find shore
        const samples = 8;
        for (let i = 0; i < samples; i++) {
            const angle = (i / samples) * Math.PI * 2;
            const sampleX = x + Math.cos(angle) * searchRadius;
            const sampleZ = z + Math.sin(angle) * searchRadius;

            const centerWaterHeight = this.getWaterHeightAt(x, z);
            const sampleWaterHeight = this.getWaterHeightAt(sampleX, sampleZ);

            // Check for water-land transition
            const hasWaterCenter = centerWaterHeight > WATER_CONFIG.SEA_LEVEL - 0.5;
            const hasWaterSample = sampleWaterHeight > WATER_CONFIG.SEA_LEVEL - 0.5;

            if (hasWaterCenter !== hasWaterSample) {
                isShore = true;
                const distance = Math.sqrt((sampleX - x) ** 2 + (sampleZ - z) ** 2);
                if (distance < nearestShoreDistance) {
                    nearestShoreDistance = distance;
                    // Calculate shore normal (points from water to land)
                    if (hasWaterCenter) {
                        shoreNormal.set(sampleX - x, 0, sampleZ - z).normalize();
                    } else {
                        shoreNormal.set(x - sampleX, 0, z - sampleZ).normalize();
                    }
                }
            }
        }

        const foamIntensity = isShore
            ? Math.max(0, 1 - nearestShoreDistance / WATER_CONFIG.SHORE.foamWidth)
            : 0;
        const waveBreaking = foamIntensity > 0.5;

        return {
            isShore,
            distanceToShore: nearestShoreDistance,
            shoreNormal,
            foamIntensity,
            waveBreaking,
        };
    }

    private generateWaterMesh(surface: WaterSurface, distance: number): WaterRenderData {
        // Adaptive resolution based on distance
        let resolution = 64; // High detail
        if (distance > 1000) resolution = 32;
        if (distance > 5000) resolution = 16;

        const vertices: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const waveData: number[] = [];
        const depthData: number[] = [];
        const foamMask: number[] = [];

        const { minX, maxX, minZ, maxZ } = surface.bounds;
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        const stepX = sizeX / (resolution - 1);
        const stepZ = sizeZ / (resolution - 1);

        console.log(
            `WaterSystem: Generating mesh for surface ${surface.id} with ${resolution}x${resolution} resolution`
        );
        console.log(`WaterSystem: Bounds: ${minX}-${maxX} x ${minZ}-${maxZ}`);

        // Generate vertices
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = minX + j * stepX;
                const z = minZ + i * stepZ;

                // Use a completely fixed water level for stability
                const baseWaterLevel = WATER_CONFIG.SEA_LEVEL;
                const waveOffset = 0; // Disabled wave offset for stability
                const y = baseWaterLevel; // Flat water surface

                vertices.push(x, y, z);

                // Calculate normal with wave displacement
                const normal = this.getWaterNormalAt(x, z);
                normals.push(normal.x, normal.y, normal.z);

                // UV coordinates
                uvs.push(j / (resolution - 1), i / (resolution - 1));

                // Wave parameters for shader
                waveData.push(
                    surface.waveHeight,
                    this.physics.windSpeed,
                    this.physics.wavePhase,
                    waveOffset // Use the wave offset as the 4th component
                );

                // Depth information - use a reasonable default depth
                const depth = 5.0 + Math.random() * 10.0; // 5-15m depth variation
                depthData.push(depth);

                // Foam intensity - add some shore foam
                const distanceToCenter = Math.sqrt(
                    (x - surface.center.x) ** 2 + (z - surface.center.z) ** 2
                );
                const maxDistance = Math.max(sizeX, sizeZ) * 0.5;
                const foamIntensity = Math.max(0, 1 - (distanceToCenter / maxDistance) * 0.8); // More foam near edges
                foamMask.push(foamIntensity * 128); // Moderate foam intensity
            }
        }

        // Generate indices
        for (let i = 0; i < resolution - 1; i++) {
            for (let j = 0; j < resolution - 1; j++) {
                const topLeft = i * resolution + j;
                const topRight = topLeft + 1;
                const bottomLeft = (i + 1) * resolution + j;
                const bottomRight = bottomLeft + 1;

                // First triangle
                indices.push(topLeft, bottomLeft, topRight);
                // Second triangle
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        console.log(
            `WaterSystem: Generated mesh with ${vertices.length / 3} vertices and ${indices.length / 3} triangles`
        );

        return {
            vertices: new Float32Array(vertices),
            indices: new Uint32Array(indices),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            waveData: new Float32Array(waveData),
            depthData: new Float32Array(depthData),
            foamMask: new Uint8Array(foamMask),
            vertexCount: vertices.length / 3,
            triangleCount: indices.length / 3,
        };
    }

    /**
     * Calculate simple wave height for mesh generation
     */
    private calculateSimpleWaveHeight(x: number, z: number, time: number): number {
        // DISABLED: Return 0 for completely flat water to ensure stability
        return 0;

        // Original wave calculation (currently disabled for stability)
        /*
        let height = 0;

        // Use the existing wave components to calculate height
        for (const wave of this.physics.waveComponents) {
            const phaseShift = wave.direction.x * x * 0.01 + wave.direction.z * z * 0.01; // Scale down for reasonable waves
            const wavePhase = wave.frequency * time + wave.phase + phaseShift;
            height += wave.amplitude * Math.sin(wavePhase);
        }

        return height * 0.5; // Scale down wave amplitude for visibility
        */
    }

    private getTerrainHeightAt(x: number, z: number): number {
        // This would need to query the terrain system
        // For now, return sea level as a placeholder
        return WATER_CONFIG.SEA_LEVEL;
    }
}
