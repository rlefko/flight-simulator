import { Vector3 } from '../core/math';
import {
    PERFORMANCE_CONFIG,
    STREAMING_CONFIG,
    worldToTileCoord,
    getTileSizeForLOD,
} from './WorldConstants';
import { TerrainTile, TerrainTileState, type TerrainData } from './TerrainTile';
import { HeightmapGenerator } from './HeightmapGenerator';
import { TerrainMesh } from './TerrainMesh';

/**
 * Tile request priority levels
 */
export enum TilePriority {
    IMMEDIATE = 0,
    HIGH = 1,
    MEDIUM = 2,
    LOW = 3,
    IDLE = 4,
}

/**
 * Tile request configuration
 */
export interface TileRequest {
    tile: TerrainTile;
    priority: TilePriority;
    requestTime: number;
    retryCount: number;
    callback?: (tile: TerrainTile) => void;
    errorCallback?: (tile: TerrainTile, error: Error) => void;
}

/**
 * Streaming statistics for performance monitoring
 */
export interface StreamingStats {
    tilesInMemory: number;
    tilesLoading: number;
    tilesReady: number;
    memoryUsage: number;
    cacheHitRate: number;
    averageLoadTime: number;
    loadedThisFrame: number;
    generatedThisFrame: number;
}

/**
 * Cache entry for tile data
 */
interface CacheEntry {
    tile: TerrainTile;
    data: TerrainData;
    timestamp: number;
    accessCount: number;
    lastAccess: number;
}

/**
 * Worker message types for terrain generation
 */
interface WorkerMessage {
    type: 'generate' | 'result' | 'error';
    tileId: string;
    x?: number;
    z?: number;
    level?: number;
    terrainData?: any;
    error?: string;
}

/**
 * Advanced terrain streaming system with predictive loading and caching
 */
export class TerrainStreaming {
    private requestQueue: Map<string, TileRequest> = new Map();
    private activeRequests: Map<string, TileRequest> = new Map();
    private tileCache: Map<string, CacheEntry> = new Map();
    private loadedTiles: Map<string, TerrainTile> = new Map();

    private workers: Worker[] = [];
    private workerQueue: (() => void)[] = [];
    private heightmapGenerator: HeightmapGenerator;

    private stats: StreamingStats = {
        tilesInMemory: 0,
        tilesLoading: 0,
        tilesReady: 0,
        memoryUsage: 0,
        cacheHitRate: 0,
        averageLoadTime: 0,
        loadedThisFrame: 0,
        generatedThisFrame: 0,
    };

    private frameStartTime: number = 0;
    private totalLoadTimes: number[] = [];
    private cacheHits: number = 0;
    private cacheMisses: number = 0;
    private frameCount: number = 0;

    constructor(seed: number = 12345) {
        this.heightmapGenerator = new HeightmapGenerator(seed);
        this.initializeWorkers();
        this.startFrameTimer();
    }

    /**
     * Initialize Web Workers for background terrain generation
     */
    private initializeWorkers(): void {
        // In a real implementation, you would create actual Web Workers
        // For now, we'll simulate the worker pattern
        const workerCount = PERFORMANCE_CONFIG.WORKER_THREAD_COUNT;

        for (let i = 0; i < workerCount; i++) {
            // Simulate worker creation
            const worker = {
                postMessage: this.simulateWorkerMessage.bind(this),
                onmessage: null as ((event: { data: WorkerMessage }) => void) | null,
                terminate: () => {},
            } as any as Worker;

            this.workers.push(worker);
        }
    }

    /**
     * Simulate worker message handling (in real implementation, this would be actual Web Worker)
     */
    private simulateWorkerMessage(message: WorkerMessage): void {
        // Simulate async terrain generation
        setTimeout(
            () => {
                if (
                    message.type === 'generate' &&
                    message.x !== undefined &&
                    message.z !== undefined &&
                    message.level !== undefined
                ) {
                    try {
                        const terrainData = this.heightmapGenerator.generateTerrainData(
                            message.x,
                            message.z,
                            message.level
                        );

                        // Send result back
                        this.handleWorkerMessage({
                            data: {
                                type: 'result',
                                tileId: message.tileId!,
                                terrainData,
                            },
                        });
                    } catch (error) {
                        this.handleWorkerMessage({
                            data: {
                                type: 'error',
                                tileId: message.tileId!,
                                error: error instanceof Error ? error.message : 'Unknown error',
                            },
                        });
                    }
                }
            },
            Math.random() * 50 + 10
        ); // Simulate 10-60ms generation time
    }

    /**
     * Handle messages from workers
     */
    private handleWorkerMessage(event: { data: WorkerMessage }): void {
        const { data } = event;

        switch (data.type) {
            case 'result':
                this.handleTerrainGenerated(data.tileId!, data.terrainData!);
                break;

            case 'error':
                this.handleGenerationError(data.tileId!, new Error(data.error));
                break;
        }
    }

    /**
     * Request tile loading with priority
     */
    public requestTile(
        tile: TerrainTile,
        priority: TilePriority = TilePriority.MEDIUM,
        callback?: (tile: TerrainTile) => void,
        errorCallback?: (tile: TerrainTile, error: Error) => void
    ): void {
        const tileId = tile.id;

        // Check if tile is already loaded or loading
        if (this.loadedTiles.has(tileId) || this.activeRequests.has(tileId)) {
            return;
        }

        // Check cache first
        if (this.tileCache.has(tileId)) {
            const cacheEntry = this.tileCache.get(tileId)!;
            tile.setTerrainData(cacheEntry.data);
            tile.state = TerrainTileState.LOADED;
            this.loadedTiles.set(tileId, tile);

            // Generate mesh
            this.generateMeshAsync(tile);

            cacheEntry.lastAccess = Date.now();
            cacheEntry.accessCount++;
            this.cacheHits++;

            callback?.(tile);
            return;
        }

        this.cacheMisses++;

        // Add to request queue
        const request: TileRequest = {
            tile,
            priority,
            requestTime: Date.now(),
            retryCount: 0,
            callback,
            errorCallback,
        };

        // Limit queue size to prevent memory exhaustion
        const MAX_QUEUE_SIZE = 500;
        if (this.requestQueue.size >= MAX_QUEUE_SIZE) {
            // Silently skip - this is normal during initial load
            return;
        }

        // Replace existing request if new one has higher priority
        const existing = this.requestQueue.get(tileId);
        if (!existing || priority < existing.priority) {
            this.requestQueue.set(tileId, request);
            // Only log if queue is getting large
            if (this.requestQueue.size > 50 && this.requestQueue.size % 50 === 0) {
                console.log('Request queue size:', this.requestQueue.size);
            }
        }

        tile.state = TerrainTileState.LOADING;
    }

    /**
     * Cancel tile request
     */
    public cancelRequest(tileId: string): void {
        this.requestQueue.delete(tileId);
        this.activeRequests.delete(tileId);
    }

    /**
     * Process tile requests based on priority and frame budget
     */
    public update(deltaTime: number): void {
        this.frameStartTime = performance.now();
        this.frameCount++;
        this.stats.loadedThisFrame = 0;
        this.stats.generatedThisFrame = 0;

        // Process active requests
        this.processActiveRequests();

        // Start new requests based on frame budget
        this.processRequestQueue();

        // Clean up old cache entries
        this.cleanupCache();

        // Update statistics
        this.updateStatistics();
    }

    /**
     * Predictive loading based on camera movement
     */
    public updatePredictiveLoading(
        cameraPosition: Vector3,
        cameraVelocity: Vector3,
        viewingDistance: number
    ): void {
        // Validate inputs
        if (!cameraPosition || !isFinite(cameraPosition.x) || !isFinite(cameraPosition.z)) {
            console.warn('Invalid camera position for predictive loading');
            return;
        }

        if (!isFinite(viewingDistance) || viewingDistance <= 0) {
            console.warn('Invalid viewing distance:', viewingDistance);
            return;
        }

        // Predict future camera position
        const lookAheadTime = 5.0; // seconds
        const futurePosition = new Vector3()
            .copy(cameraPosition)
            .add(new Vector3().copy(cameraVelocity).multiplyScalar(lookAheadTime));

        // Validate future position
        if (!isFinite(futurePosition.x) || !isFinite(futurePosition.z)) {
            console.warn('Invalid future position calculated');
            futurePosition.copy(cameraPosition); // Fallback to current position
        }

        // Calculate required tiles around predicted position
        const maxLevel = 3; // Reduced LOD level for predictive loading to prevent excessive requests

        for (let level = 0; level <= maxLevel; level++) {
            const tileSize = getTileSizeForLOD(level);

            // Validate tile size
            if (!isFinite(tileSize) || tileSize <= 0) {
                console.error('Invalid tile size for level', level, ':', tileSize);
                continue;
            }

            const radius = Math.min(3, Math.ceil(viewingDistance / tileSize / 4)); // Further limit radius to prevent excessive tiles

            const centerCoord = worldToTileCoord(futurePosition.x, futurePosition.z, level);

            // Validate center coordinates
            if (!isFinite(centerCoord.tx) || !isFinite(centerCoord.tz)) {
                console.error('Invalid center coordinates for level', level);
                continue;
            }

            // Request tiles in a circular pattern around predicted position
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    if (distance <= radius) {
                        const tileX = centerCoord.tx + dx;
                        const tileZ = centerCoord.tz + dz;

                        // Validate tile coordinates
                        if (!isFinite(tileX) || !isFinite(tileZ)) {
                            continue;
                        }

                        const tile = new TerrainTile(tileX, tileZ, level);
                        const priority = this.calculatePredictivePriority(distance, level);

                        if (!this.loadedTiles.has(tile.id) && !this.requestQueue.has(tile.id)) {
                            this.requestTile(tile, priority);
                        }
                    }
                }
            }
        }
    }

    /**
     * Get tile if available immediately
     */
    public getTileImmediate(x: number, z: number, level: number): TerrainTile | null {
        const tileId = `tile_${level}_${x}_${z}`;
        return this.loadedTiles.get(tileId) || null;
    }

    /**
     * Unload tile and free memory
     */
    public unloadTile(tileId: string): void {
        const tile = this.loadedTiles.get(tileId);
        if (tile) {
            // Add to cache before unloading
            if (tile.terrainData) {
                const cacheEntry: CacheEntry = {
                    tile,
                    data: tile.terrainData,
                    timestamp: Date.now(),
                    accessCount: 1,
                    lastAccess: Date.now(),
                };
                this.tileCache.set(tileId, cacheEntry);
            }

            tile.dispose();
            this.loadedTiles.delete(tileId);
        }

        this.cancelRequest(tileId);
    }

    /**
     * Get streaming statistics
     */
    public getStats(): StreamingStats {
        return { ...this.stats };
    }

    /**
     * Clear all caches and requests
     */
    public clear(): void {
        // Cancel all active requests
        for (const [tileId] of this.activeRequests) {
            this.cancelRequest(tileId);
        }

        // Clear all caches
        this.tileCache.clear();
        this.requestQueue.clear();
        this.activeRequests.clear();

        // Dispose all loaded tiles
        for (const [tileId, tile] of this.loadedTiles) {
            tile.dispose();
        }
        this.loadedTiles.clear();

        // Reset statistics
        this.stats = {
            tilesInMemory: 0,
            tilesLoading: 0,
            tilesReady: 0,
            memoryUsage: 0,
            cacheHitRate: 0,
            averageLoadTime: 0,
            loadedThisFrame: 0,
            generatedThisFrame: 0,
        };
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.clear();

        // Terminate workers
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers.length = 0;
    }

    // Private methods

    private processActiveRequests(): void {
        const frameBudget = PERFORMANCE_CONFIG.TERRAIN_FRAME_BUDGET;
        const startTime = performance.now();

        for (const [tileId, request] of this.activeRequests) {
            if (performance.now() - startTime > frameBudget) {
                break;
            }

            // Check for timeout
            const elapsed = Date.now() - request.requestTime;
            if (elapsed > STREAMING_CONFIG.REQUEST_CONFIG.timeout) {
                this.handleRequestTimeout(request);
                this.activeRequests.delete(tileId);
            }
        }
    }

    private processRequestQueue(): void {
        const maxNewRequests = PERFORMANCE_CONFIG.TILES_PER_FRAME;
        const maxConcurrent = STREAMING_CONFIG.REQUEST_CONFIG.maxConcurrentRequests;

        if (this.activeRequests.size >= maxConcurrent) {
            return;
        }

        // Sort requests by priority
        const sortedRequests = Array.from(this.requestQueue.entries())
            .sort(([, a], [, b]) => a.priority - b.priority)
            .slice(0, maxNewRequests); // Limit to prevent excessive processing

        let processed = 0;
        for (const [tileId, request] of sortedRequests) {
            if (processed >= maxNewRequests || this.activeRequests.size >= maxConcurrent) {
                break;
            }

            // Validate tile before processing
            const tile = request.tile;
            if (!isFinite(tile.x) || !isFinite(tile.z) || !isFinite(tile.level)) {
                console.error('Skipping invalid tile in request queue:', tileId);
                this.requestQueue.delete(tileId);
                continue;
            }

            this.startTileGeneration(request);
            this.requestQueue.delete(tileId);
            this.activeRequests.set(tileId, request);
            processed++;
        }

        if (processed > 0 && this.frameCount % 60 === 0) {
            console.log(`Processing ${processed} terrain tile requests`);
        }
    }

    private startTileGeneration(request: TileRequest): void {
        const tile = request.tile;

        // Find available worker
        const worker = this.workers[0]; // Simplified worker selection

        const message: WorkerMessage = {
            type: 'generate',
            tileId: tile.id,
            x: tile.x,
            z: tile.z,
            level: tile.level,
        };

        tile.state = TerrainTileState.GENERATING;
        worker.postMessage(message);
    }

    private handleTerrainGenerated(tileId: string, terrainData: any): void {
        const request = this.activeRequests.get(tileId);
        if (!request) return;

        const tile = request.tile;

        // Convert serialized data back to typed arrays
        const convertedData: TerrainData = {
            heightmap: new Float32Array(terrainData.heightmap),
            normals: terrainData.normals ? new Float32Array(terrainData.normals) : undefined,
            materials: terrainData.materials ? new Uint8Array(terrainData.materials) : undefined,
            uvs: terrainData.uvs ? new Float32Array(terrainData.uvs) : undefined,
            waterMask: terrainData.waterMask ? new Uint8Array(terrainData.waterMask) : undefined,
            slopes: terrainData.slopes ? new Float32Array(terrainData.slopes) : undefined,
            textureIndices: terrainData.textureIndices
                ? new Uint8Array(terrainData.textureIndices)
                : undefined,
        };

        tile.setTerrainData(convertedData);
        tile.state = TerrainTileState.LOADED;

        // Generate mesh
        this.generateMeshAsync(tile);

        this.loadedTiles.set(tileId, tile);
        this.activeRequests.delete(tileId);
        this.stats.loadedThisFrame++;

        // Record load time
        const loadTime = Date.now() - request.requestTime;
        this.totalLoadTimes.push(loadTime);
        if (this.totalLoadTimes.length > 100) {
            this.totalLoadTimes.shift();
        }

        request.callback?.(tile);
    }

    private handleGenerationError(tileId: string, error: Error): void {
        const request = this.activeRequests.get(tileId);
        if (!request) return;

        request.tile.state = TerrainTileState.ERROR;
        this.activeRequests.delete(tileId);

        // Retry if under limit
        if (request.retryCount < STREAMING_CONFIG.REQUEST_CONFIG.retryAttempts) {
            request.retryCount++;
            setTimeout(() => {
                this.requestQueue.set(tileId, request);
            }, STREAMING_CONFIG.REQUEST_CONFIG.retryDelay);
        } else {
            request.errorCallback?.(request.tile, error);
        }
    }

    private handleRequestTimeout(request: TileRequest): void {
        request.tile.state = TerrainTileState.ERROR;
        const error = new Error('Request timeout');
        request.errorCallback?.(request.tile, error);
    }

    private generateMeshAsync(tile: TerrainTile): void {
        if (!tile.terrainData) return;

        // Generate mesh data
        const meshData = TerrainMesh.generateMesh(tile.terrainData, tile.size, {
            lodLevel: tile.level,
        });

        tile.setMeshData(meshData);
        this.stats.generatedThisFrame++;
    }

    private calculatePredictivePriority(distance: number, level: number): TilePriority {
        // Closer tiles and higher detail levels get higher priority
        if (distance < 2 && level < 3) return TilePriority.HIGH;
        if (distance < 4 && level < 4) return TilePriority.MEDIUM;
        return TilePriority.LOW;
    }

    private cleanupCache(): void {
        if (this.tileCache.size <= STREAMING_CONFIG.CACHE_CONFIG.maxSize) {
            return;
        }

        const now = Date.now();
        const maxAge = STREAMING_CONFIG.CACHE_CONFIG.maxAge;
        const entries = Array.from(this.tileCache.entries());

        // Remove old entries
        entries.forEach(([tileId, entry]) => {
            if (now - entry.timestamp > maxAge) {
                this.tileCache.delete(tileId);
            }
        });

        // If still over capacity, remove least recently used
        if (this.tileCache.size > STREAMING_CONFIG.CACHE_CONFIG.maxSize) {
            const sortedEntries = entries
                .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
                .slice(0, this.tileCache.size - STREAMING_CONFIG.CACHE_CONFIG.maxSize);

            sortedEntries.forEach(([tileId]) => {
                this.tileCache.delete(tileId);
            });
        }
    }

    private updateStatistics(): void {
        this.stats.tilesInMemory = this.loadedTiles.size;
        this.stats.tilesLoading = this.activeRequests.size;
        this.stats.tilesReady = Array.from(this.loadedTiles.values()).filter((tile) =>
            tile.isReadyForRender()
        ).length;

        // Calculate memory usage
        let memoryUsage = 0;
        for (const tile of this.loadedTiles.values()) {
            memoryUsage += tile.getMemoryUsage();
        }
        this.stats.memoryUsage = memoryUsage;

        // Calculate cache hit rate
        const totalRequests = this.cacheHits + this.cacheMisses;
        this.stats.cacheHitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

        // Calculate average load time
        if (this.totalLoadTimes.length > 0) {
            this.stats.averageLoadTime =
                this.totalLoadTimes.reduce((a, b) => a + b, 0) / this.totalLoadTimes.length;
        }
    }

    private startFrameTimer(): void {
        // Reset frame counters every frame
        const resetFrameStats = () => {
            this.stats.loadedThisFrame = 0;
            this.stats.generatedThisFrame = 0;
            requestAnimationFrame(resetFrameStats);
        };
        requestAnimationFrame(resetFrameStats);
    }
}
