import { Vector3 } from '../core/math';
import {
    TERRAIN_CONFIG,
    LOD_CONFIG,
    PERFORMANCE_CONFIG,
    worldToTileCoord,
    getTileSizeForLOD,
} from './WorldConstants';
import { TerrainTile, TerrainTileState } from './TerrainTile';
import { TerrainStreaming, TilePriority } from './TerrainStreaming';
import { PhotorealisticHeightmapGenerator } from './PhotorealisticHeightmapGenerator';

/**
 * Camera frustum for culling calculations
 */
export interface Frustum {
    planes: Vector3[]; // 6 frustum planes as normal vectors
    nearDistance: number;
    farDistance: number;
}

/**
 * Terrain generation configuration
 */
export interface TerrainConfig {
    seed: number;
    maxLODLevels: number;
    viewDistance: number;
    errorThreshold: number;
    enableFrustumCulling: boolean;
    enablePredictiveLoading: boolean;
    adaptiveLOD: boolean;
}

/**
 * Terrain system statistics
 */
export interface TerrainStats {
    totalTiles: number;
    visibleTiles: number;
    loadingTiles: number;
    triangleCount: number;
    memoryUsage: number;
    frameTime: number;
    lodTransitions: number;
}

/**
 * Quadtree node for hierarchical terrain management
 */
class QuadTreeNode {
    public tile: TerrainTile;
    public children: QuadTreeNode[] | null = null;
    public parent: QuadTreeNode | null = null;
    public isLeaf: boolean = true;
    public lastUpdateFrame: number = 0;

    constructor(tile: TerrainTile, parent: QuadTreeNode | null = null) {
        this.tile = tile;
        this.parent = parent;
    }

    /**
     * Subdivide node into 4 children
     */
    subdivide(): QuadTreeNode[] {
        if (this.children) {
            return this.children;
        }

        const childTiles = this.tile.subdivide();
        this.children = childTiles.map((childTile) => new QuadTreeNode(childTile, this));
        this.isLeaf = false;

        return this.children;
    }

    /**
     * Collapse children and become leaf
     */
    collapse(): void {
        if (this.children) {
            this.children.forEach((child) => {
                child.dispose();
            });
            this.children = null;
        }
        this.tile.collapse();
        this.isLeaf = true;
    }

    /**
     * Get all leaf nodes recursively
     */
    getLeaves(): QuadTreeNode[] {
        if (this.isLeaf) {
            return [this];
        }

        const leaves: QuadTreeNode[] = [];
        if (this.children) {
            this.children.forEach((child) => {
                leaves.push(...child.getLeaves());
            });
        }
        return leaves;
    }

    /**
     * Dispose of node and all children
     */
    dispose(): void {
        if (this.children) {
            this.children.forEach((child) => child.dispose());
            this.children = null;
        }
        this.tile.dispose();
    }
}

/**
 * Advanced terrain generation system with quadtree LOD and streaming
 */
export class TerrainGenerator {
    private config: TerrainConfig;
    private streaming: TerrainStreaming;
    private heightmapGenerator: PhotorealisticHeightmapGenerator;

    private quadTree: QuadTreeNode;
    private visibleNodes: QuadTreeNode[] = [];
    private renderableNodes: QuadTreeNode[] = [];

    private cameraPosition: Vector3 = new Vector3();
    private cameraVelocity: Vector3 = new Vector3();
    private lastCameraPosition: Vector3 = new Vector3();

    private frustum: Frustum | null = null;
    private currentFrame: number = 0;
    private errorThreshold: number = 1.0;

    private stats: TerrainStats = {
        totalTiles: 0,
        visibleTiles: 0,
        loadingTiles: 0,
        triangleCount: 0,
        memoryUsage: 0,
        frameTime: 0,
        lodTransitions: 0,
    };

    constructor(config: Partial<TerrainConfig> = {}) {
        this.config = {
            seed: 12345,
            maxLODLevels: 3, // Limit to 3 levels to prevent infinite subdivision
            viewDistance: LOD_CONFIG.CULL_DISTANCE,
            errorThreshold: 1.0,
            enableFrustumCulling: false, // Disabled - was causing flickering
            enablePredictiveLoading: false, // Disabled to prevent excessive tile requests
            adaptiveLOD: false, // Use simple distance-based LOD for debugging
            ...config,
        };

        this.heightmapGenerator = new PhotorealisticHeightmapGenerator(this.config.seed);
        this.streaming = new TerrainStreaming(this.config.seed);

        // Initialize with a smaller grid for better performance
        // Create a 3x3 grid of root tiles
        const gridSize = 3; // 3x3 grid for better performance
        const centerOffset = Math.floor(gridSize / 2);

        // Create a virtual root that holds our tile grid
        const virtualRoot = new TerrainTile(0, 0, 0);
        this.quadTree = new QuadTreeNode(virtualRoot);
        this.quadTree.children = [];
        this.quadTree.isLeaf = false;

        // Create the grid of root tiles
        for (let x = -centerOffset; x <= centerOffset; x++) {
            for (let z = -centerOffset; z <= centerOffset; z++) {
                const tile = new TerrainTile(x, z, 0);
                const node = new QuadTreeNode(tile, this.quadTree);
                this.quadTree.children.push(node);

                // Log tile bounds to debug positioning
                console.log(
                    `Tile (${x},${z}) bounds: X[${tile.worldBounds.minX}, ${tile.worldBounds.maxX}] Z[${tile.worldBounds.minZ}, ${tile.worldBounds.maxZ}]`
                );

                // Update LOD properly with initial camera position
                const initialCameraPos = new Vector3(4096, 500, 4096);
                tile.updateLOD(initialCameraPos, null);
                console.log(
                    `Tile (${x},${z}) distance to camera: ${tile.distanceToCamera.toFixed(0)}`
                );

                // Request generation for all tiles in the initial grid
                console.log('TerrainGenerator: Requesting tile generation for', tile.id);
                this.streaming.requestTile(tile, TilePriority.IMMEDIATE, (loadedTile) => {
                    console.log('Tile loaded:', loadedTile.id, 'state:', loadedTile.state);
                });
            }
        }

        console.log(`TerrainGenerator: Created ${gridSize}x${gridSize} grid of root tiles`);
        this.errorThreshold = this.config.errorThreshold;
    }

    /**
     * Update terrain system for current frame
     */
    public update(
        cameraPosition: Vector3,
        frustum: Frustum | null = null,
        deltaTime: number = 0.016
    ): void {
        const frameStart = performance.now();
        this.currentFrame++;

        // Debug logging
        if (this.currentFrame % 60 === 0) {
            console.log(
                'TerrainGenerator.update - Frame:',
                this.currentFrame,
                'Camera:',
                cameraPosition.x.toFixed(0),
                cameraPosition.y.toFixed(0),
                cameraPosition.z.toFixed(0)
            );
        }

        // Update camera tracking
        this.updateCameraTracking(cameraPosition, deltaTime);

        // Update frustum
        this.frustum = frustum;

        // Update streaming system
        this.streaming.update(deltaTime);

        // Update quadtree LOD based on camera position
        this.updateQuadTreeLOD();

        // Update visible nodes
        this.updateVisibility();

        if (this.currentFrame % 60 === 0) {
            console.log(
                'Visible nodes:',
                this.visibleNodes.length,
                'Renderable nodes:',
                this.renderableNodes.length
            );
        }

        // Update predictive loading if enabled (only after initial tiles are loaded)
        if (this.config.enablePredictiveLoading && this.currentFrame > 60) {
            this.streaming.updatePredictiveLoading(
                this.cameraPosition,
                this.cameraVelocity,
                Math.min(10000, this.config.viewDistance) // Limit predictive loading distance
            );
        }

        // Update statistics
        this.updateStatistics(performance.now() - frameStart);
    }

    /**
     * Get tiles ready for rendering
     */
    public getRenderableTiles(): TerrainTile[] {
        const readyTiles = this.renderableNodes
            .filter((node) => node.tile.isReadyForRender())
            .map((node) => node.tile);

        // Debug logging
        if (this.currentFrame % 60 === 0 && readyTiles.length > 0) {
            console.log('Renderable tiles:', readyTiles.length);
        }

        return readyTiles;
    }

    /**
     * Get all visible tiles (including loading ones)
     */
    public getVisibleTiles(): TerrainTile[] {
        return this.visibleNodes.map((node) => node.tile);
    }

    /**
     * Get height at world coordinates
     */
    public getHeightAt(x: number, z: number): number {
        // Find the most appropriate tile for this position
        const node = this.findBestNodeForPosition(x, z);
        if (node && node.tile.terrainData) {
            return node.tile.getHeightAt(x, z);
        }

        // Fallback to procedural generation
        return this.heightmapGenerator.generateTerrainData(
            Math.floor(x / TERRAIN_CONFIG.BASE_TILE_SIZE),
            Math.floor(z / TERRAIN_CONFIG.BASE_TILE_SIZE),
            0,
            2, // Small sample for height query
            TERRAIN_CONFIG.BASE_TILE_SIZE
        ).heightmap[0];
    }

    /**
     * Set terrain configuration
     */
    public setConfig(config: Partial<TerrainConfig>): void {
        this.config = { ...this.config, ...config };
        this.errorThreshold = this.config.errorThreshold;

        if (config.seed !== undefined) {
            this.heightmapGenerator = new PhotorealisticHeightmapGenerator(config.seed);
            this.streaming = new TerrainStreaming(config.seed);
            this.clearTerrain();
        }
    }

    /**
     * Get terrain system statistics
     */
    public getStats(): TerrainStats {
        return { ...this.stats };
    }

    /**
     * Get streaming statistics
     */
    public getStreamingStats() {
        return this.streaming.getStats();
    }

    /**
     * Clear all terrain data
     */
    public clearTerrain(): void {
        this.quadTree.dispose();
        this.streaming.clear();

        const rootTile = new TerrainTile(0, 0, 0);
        this.quadTree = new QuadTreeNode(rootTile);

        this.visibleNodes = [];
        this.renderableNodes = [];
    }

    /**
     * Dispose of terrain system
     */
    public dispose(): void {
        this.clearTerrain();
        this.streaming.dispose();
    }

    // Private methods

    private updateCameraTracking(cameraPosition: Vector3, deltaTime: number): void {
        // Calculate camera velocity
        this.cameraVelocity
            .copy(cameraPosition)
            .sub(this.lastCameraPosition)
            .multiplyScalar(1 / deltaTime);

        // Update positions
        this.lastCameraPosition.copy(this.cameraPosition);
        this.cameraPosition.copy(cameraPosition);
    }

    private updateQuadTreeLOD(): void {
        const lodBudget = PERFORMANCE_CONFIG.TERRAIN_FRAME_BUDGET;
        const startTime = performance.now();

        // If we have a grid of tiles, traverse each one
        if (this.quadTree.children) {
            for (const child of this.quadTree.children) {
                this.traverseAndUpdateLOD(child, lodBudget, startTime);
            }
        } else {
            this.traverseAndUpdateLOD(this.quadTree, lodBudget, startTime);
        }
    }

    private traverseAndUpdateLOD(node: QuadTreeNode, budget: number, startTime: number): void {
        if (performance.now() - startTime > budget) {
            return; // Exceeded frame budget
        }

        const tile = node.tile;

        // Validate tile coordinates before proceeding
        if (!isFinite(tile.x) || !isFinite(tile.z) || !isFinite(tile.level)) {
            console.error('Invalid tile coordinates in traversal:', tile.id);
            return;
        }

        // Update tile's distance to camera
        tile.updateLOD(this.cameraPosition, this.frustum);

        // Skip if tile is too far or not visible
        if (!tile.isVisible) {
            if (!node.isLeaf) {
                node.collapse();
                this.stats.lodTransitions++;
            }
            return;
        }

        // Check if tile should be subdivided
        const shouldSubdivide = this.shouldSubdivideTile(tile);
        const shouldCollapse = this.shouldCollapseTile(node);

        if (shouldSubdivide && node.isLeaf && tile.level < this.config.maxLODLevels - 1) {
            // Subdivide
            const children = node.subdivide();
            this.stats.lodTransitions++;

            // Recursively process children
            children.forEach((child) => {
                this.traverseAndUpdateLOD(child, budget, startTime);
            });
        } else if (shouldCollapse && !node.isLeaf) {
            // Collapse
            node.collapse();
            this.stats.lodTransitions++;
        } else if (!node.isLeaf) {
            // Continue traversing children
            node.children?.forEach((child) => {
                this.traverseAndUpdateLOD(child, budget, startTime);
            });
        }

        // Request tile data if needed (only for visible, close tiles)
        if (
            node.isLeaf &&
            tile.state === TerrainTileState.UNLOADED &&
            tile.distanceToCamera < 500000 // Increased from 50000
        ) {
            const priority = this.calculateTilePriority(tile);
            console.log(
                'Requesting tile:',
                tile.id,
                'priority:',
                priority,
                'distance:',
                tile.distanceToCamera.toFixed(0),
                'state:',
                tile.state
            );

            this.streaming.requestTile(tile, priority, (loadedTile) => {
                node.lastUpdateFrame = this.currentFrame;
                console.log('Tile loaded callback:', loadedTile.id, 'state:', loadedTile.state);
            });
        }
    }

    private shouldSubdivideTile(tile: TerrainTile): boolean {
        // DISABLED SUBDIVISION TEMPORARILY
        return false;

        // Never subdivide beyond level 2 to prevent infinite subdivision
        if (tile.level >= 2) {
            return false;
        }

        if (!this.config.adaptiveLOD) {
            // Use simple distance-based LOD
            const lodDistance = LOD_CONFIG.TERRAIN_DISTANCES[tile.level + 1] || Infinity;
            const shouldSubdivide = tile.distanceToCamera < lodDistance;

            if (this.currentFrame % 120 === 0 && tile.level === 0) {
                console.log(
                    'Should subdivide root tile?',
                    shouldSubdivide,
                    'distance:',
                    tile.distanceToCamera.toFixed(0),
                    'threshold:',
                    lodDistance
                );
            }

            return shouldSubdivide;
        }

        // Adaptive LOD based on terrain complexity and viewing angle
        const baseDistance = LOD_CONFIG.TERRAIN_DISTANCES[tile.level + 1] || Infinity;
        const complexityFactor = tile.metadata.roughness / 100; // Normalize roughness
        const adjustedDistance = baseDistance * (1 + complexityFactor);

        return (
            tile.distanceToCamera < adjustedDistance && tile.calculateError() > this.errorThreshold
        );
    }

    private shouldCollapseTile(node: QuadTreeNode): boolean {
        if (node.isLeaf) return false;

        // Check if all children are far enough to collapse
        const childrenCanCollapse = node.children?.every((child) => {
            const tile = child.tile;
            const lodDistance = LOD_CONFIG.TERRAIN_DISTANCES[tile.level] || 0;
            return tile.distanceToCamera > lodDistance * 1.5; // Hysteresis to prevent flickering
        });

        return childrenCanCollapse || false;
    }

    private calculateTilePriority(tile: TerrainTile): TilePriority {
        const distance = tile.distanceToCamera;
        const level = tile.level;

        // Higher priority for closer tiles and higher detail levels
        if (distance < 1000 && level <= 2) return TilePriority.IMMEDIATE;
        if (distance < 5000 && level <= 3) return TilePriority.HIGH;
        if (distance < 20000 && level <= 4) return TilePriority.MEDIUM;
        return TilePriority.LOW;
    }

    private updateVisibility(): void {
        this.visibleNodes = [];
        this.renderableNodes = [];

        this.collectVisibleNodes(this.quadTree);

        // Update tile neighbor information for seamless LOD
        this.updateTileNeighbors();
    }

    private collectVisibleNodes(node: QuadTreeNode): void {
        // Special handling for our virtual root that contains the grid
        if (node === this.quadTree && node.children) {
            // This is our virtual root, just recurse into children
            node.children.forEach((child) => {
                this.collectVisibleNodes(child);
            });
            return;
        }

        const tile = node.tile;

        // Frustum culling
        if (this.config.enableFrustumCulling && this.frustum && !this.isInFrustum(tile)) {
            return;
        }

        // Distance culling
        if (tile.distanceToCamera > this.config.viewDistance) {
            return;
        }

        if (node.isLeaf) {
            this.visibleNodes.push(node);

            if (tile.isReadyForRender()) {
                this.renderableNodes.push(node);
            } else if (this.currentFrame % 60 === 0) {
                console.log(
                    'Tile not ready:',
                    tile.id,
                    'state:',
                    tile.state,
                    'distance:',
                    tile.distanceToCamera.toFixed(0)
                );
            }
        } else {
            // Recursively collect from children
            node.children?.forEach((child) => {
                this.collectVisibleNodes(child);
            });
        }
    }

    private isInFrustum(tile: TerrainTile): boolean {
        if (!this.frustum) return true;

        // Simple sphere-frustum intersection test
        const center = tile.center;
        const radius = tile.size * 0.866; // Half diagonal of square tile

        for (const plane of this.frustum.planes) {
            const distance = center.dot(plane) + plane.lengthSq(); // Plane.d component
            if (distance < -radius) {
                return false; // Outside this plane
            }
        }

        return true;
    }

    private updateTileNeighbors(): void {
        // Simple neighbor finding - in a full implementation this would be more sophisticated
        for (const node of this.visibleNodes) {
            const tile = node.tile;

            // Clear existing neighbors
            tile.neighbors = {};

            // Find neighbors at same LOD level
            const tileSize = getTileSizeForLOD(tile.level);
            const neighborCoords = [
                { x: tile.x, z: tile.z - 1, dir: 'north' }, // North
                { x: tile.x, z: tile.z + 1, dir: 'south' }, // South
                { x: tile.x + 1, z: tile.z, dir: 'east' }, // East
                { x: tile.x - 1, z: tile.z, dir: 'west' }, // West
            ];

            for (const coord of neighborCoords) {
                const neighborNode = this.findNodeByCoord(coord.x, coord.z, tile.level);
                if (neighborNode) {
                    tile.neighbors[coord.dir as keyof typeof tile.neighbors] = neighborNode.tile;
                }
            }
        }
    }

    private findNodeByCoord(x: number, z: number, level: number): QuadTreeNode | null {
        // Simple linear search - could be optimized with spatial indexing
        for (const node of this.visibleNodes) {
            const tile = node.tile;
            if (tile.x === x && tile.z === z && tile.level === level) {
                return node;
            }
        }
        return null;
    }

    private findBestNodeForPosition(x: number, z: number): QuadTreeNode | null {
        let bestNode: QuadTreeNode | null = null;
        let bestLevel = -1;

        for (const node of this.visibleNodes) {
            const tile = node.tile;
            if (tile.containsPoint(x, z) && tile.level > bestLevel && tile.terrainData) {
                bestNode = node;
                bestLevel = tile.level;
            }
        }

        return bestNode;
    }

    private updateStatistics(frameTime: number): void {
        this.stats.frameTime = frameTime;
        this.stats.totalTiles = this.countAllNodes(this.quadTree);
        this.stats.visibleTiles = this.visibleNodes.length;
        this.stats.loadingTiles = this.visibleNodes.filter(
            (node) =>
                node.tile.state === TerrainTileState.LOADING ||
                node.tile.state === TerrainTileState.GENERATING
        ).length;

        // Count triangles
        this.stats.triangleCount = this.renderableNodes.reduce((total, node) => {
            return total + (node.tile.meshData?.triangleCount || 0);
        }, 0);

        // Calculate memory usage
        this.stats.memoryUsage = this.visibleNodes.reduce((total, node) => {
            return total + node.tile.getMemoryUsage();
        }, 0);
    }

    private countAllNodes(node: QuadTreeNode): number {
        let count = 1;
        if (node.children) {
            count += node.children.reduce((total, child) => total + this.countAllNodes(child), 0);
        }
        return count;
    }
}
