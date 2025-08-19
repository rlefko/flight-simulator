import { Matrix4, Vector3 } from '../core/math';
import { Camera } from './Camera';
import type { GrassCluster } from '../world/GrassDistribution';
import type { GrassType } from '../world/VegetationSystem';
import type { TerrainTile } from '../world/TerrainTile';

/**
 * Grass overlay data for terrain integration
 */
export interface GrassOverlay {
    textureId: number;
    blendFactor: number;
    tileCoords: { x: number; z: number };
    worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    grassDensityMap: Float32Array;
    grassTypeMap: Uint8Array;
}

/**
 * Grass overlay texture parameters
 */
export interface GrassTextureLayer {
    grassType: number;
    density: number;
    scale: number;
    rotation: number;
    color: { r: number; g: number; b: number; a: number };
    windResponsiveness: number;
}

/**
 * Grass texture overlay system for mid to long-range grass rendering
 * Integrates with terrain rendering to provide seamless grass appearance
 */
export class GrassOverlayRenderer {
    private device: GPUDevice;
    private grassOverlayTexture: GPUTexture | null = null;
    private grassDensityTexture: GPUTexture | null = null;
    private grassTypeTexture: GPUTexture | null = null;
    private sampler: GPUSampler | null = null;

    // Texture generation pipeline
    private overlayPipeline: GPUComputePipeline | null = null;
    private overlayBindGroupLayout: GPUBindGroupLayout | null = null;
    private overlayUniformBuffer: GPUBuffer | null = null;

    // Texture atlas for different grass patterns
    private grassPatternAtlas: GPUTexture | null = null;
    private readonly ATLAS_SIZE = 2048;
    private readonly PATTERN_SIZE = 256; // 8x8 patterns in atlas

    // Overlay data management
    private overlays: Map<string, GrassOverlay> = new Map();
    private grassTextureLayers: Map<number, GrassTextureLayer> = new Map();

    // Performance settings
    private readonly OVERLAY_RESOLUTION = 512; // Resolution of overlay textures
    private readonly MAX_OVERLAYS = 100;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    /**
     * Initialize the grass overlay renderer
     */
    public async initialize(): Promise<void> {
        console.log('GrassOverlayRenderer: Initializing...');

        // Create grass pattern atlas
        await this.createGrassPatternAtlas();

        // Create overlay textures
        this.createOverlayTextures();

        // Create compute pipeline for overlay generation
        await this.createComputePipeline();

        // Initialize grass texture layers
        this.initializeGrassTextureLayers();

        console.log('GrassOverlayRenderer: Initialization complete');
    }

    /**
     * Create grass pattern atlas with procedural patterns
     */
    private async createGrassPatternAtlas(): Promise<void> {
        const textureData = new Uint8Array(this.ATLAS_SIZE * this.ATLAS_SIZE * 4);
        const patternsPerRow = this.ATLAS_SIZE / this.PATTERN_SIZE;

        console.log(
            `GrassOverlayRenderer: Creating pattern atlas with ${patternsPerRow}x${patternsPerRow} patterns`
        );

        // Generate different grass patterns
        for (let patternY = 0; patternY < patternsPerRow; patternY++) {
            for (let patternX = 0; patternX < patternsPerRow; patternX++) {
                const patternId = patternY * patternsPerRow + patternX;
                this.generateGrassPattern(textureData, patternX, patternY, patternId);
            }
        }

        // Create texture
        this.grassPatternAtlas = this.device.createTexture({
            size: { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: 'grass-pattern-atlas',
        });

        this.device.queue.writeTexture(
            { texture: this.grassPatternAtlas },
            textureData,
            { bytesPerRow: this.ATLAS_SIZE * 4 },
            { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE }
        );
    }

    /**
     * Generate a specific grass pattern
     */
    private generateGrassPattern(
        textureData: Uint8Array,
        patternX: number,
        patternY: number,
        patternId: number
    ): void {
        const startX = patternX * this.PATTERN_SIZE;
        const startY = patternY * this.PATTERN_SIZE;

        // Different pattern types based on ID
        const patternType = patternId % 8;

        for (let y = 0; y < this.PATTERN_SIZE; y++) {
            for (let x = 0; x < this.PATTERN_SIZE; x++) {
                const atlasX = startX + x;
                const atlasY = startY + y;
                const index = (atlasY * this.ATLAS_SIZE + atlasX) * 4;

                const u = x / this.PATTERN_SIZE;
                const v = y / this.PATTERN_SIZE;

                const color = this.generatePixelColor(u, v, patternType);
                textureData[index] = color.r;
                textureData[index + 1] = color.g;
                textureData[index + 2] = color.b;
                textureData[index + 3] = color.a;
            }
        }
    }

    /**
     * Generate color for a specific pattern type
     */
    private generatePixelColor(
        u: number,
        v: number,
        patternType: number
    ): { r: number; g: number; b: number; a: number } {
        let grassDensity = 0;
        let grassColor = { r: 0.2, g: 0.6, b: 0.1 };

        switch (patternType) {
            case 0: // Dense uniform grass
                grassDensity = this.noise2D(u * 8, v * 8) * 0.3 + 0.7;
                break;

            case 1: // Patchy grass
                grassDensity = Math.max(0, this.noise2D(u * 4, v * 4) - 0.3) * 1.4;
                break;

            case 2: // Sparse grass
                grassDensity = Math.max(0, this.noise2D(u * 6, v * 6) - 0.5) * 2.0;
                break;

            case 3: // Clumpy grass
                const clumpNoise = this.noise2D(u * 2, v * 2);
                if (clumpNoise > 0.3) {
                    grassDensity = this.noise2D(u * 10, v * 10) * 0.5 + 0.5;
                }
                break;

            case 4: // Linear grass (rows)
                const rowPattern = Math.sin(v * 20) * 0.3 + 0.7;
                grassDensity = this.noise2D(u * 6, v * 6) * rowPattern;
                break;

            case 5: // Dry grass pattern
                grassDensity = this.noise2D(u * 5, v * 5) * 0.4 + 0.3;
                grassColor = { r: 0.5, g: 0.4, b: 0.1 };
                break;

            case 6: // Lush grass pattern
                grassDensity = this.noise2D(u * 7, v * 7) * 0.4 + 0.6;
                grassColor = { r: 0.1, g: 0.8, b: 0.2 };
                break;

            case 7: // Alpine grass pattern
                grassDensity = Math.max(0, this.noise2D(u * 4, v * 4) - 0.4) * 1.6;
                grassColor = { r: 0.3, g: 0.5, b: 0.2 };
                break;
        }

        // Add some noise variation to color
        const colorNoise = this.noise2D(u * 16, v * 16) * 0.1 - 0.05;

        return {
            r: Math.floor(Math.max(0, Math.min(1, grassColor.r + colorNoise)) * 255),
            g: Math.floor(Math.max(0, Math.min(1, grassColor.g + colorNoise)) * 255),
            b: Math.floor(Math.max(0, Math.min(1, grassColor.b + colorNoise)) * 255),
            a: Math.floor(Math.max(0, Math.min(1, grassDensity)) * 255),
        };
    }

    /**
     * Create overlay textures
     */
    private createOverlayTextures(): void {
        // Main grass overlay texture (RGBA)
        this.grassOverlayTexture = this.device.createTexture({
            size: { width: this.OVERLAY_RESOLUTION, height: this.OVERLAY_RESOLUTION },
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.STORAGE_BINDING |
                GPUTextureUsage.COPY_DST,
            label: 'grass-overlay-texture',
        });

        // Grass density texture (single channel)
        this.grassDensityTexture = this.device.createTexture({
            size: { width: this.OVERLAY_RESOLUTION, height: this.OVERLAY_RESOLUTION },
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            label: 'grass-density-texture',
        });

        // Grass type texture (single channel)
        this.grassTypeTexture = this.device.createTexture({
            size: { width: this.OVERLAY_RESOLUTION, height: this.OVERLAY_RESOLUTION },
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            label: 'grass-type-texture',
        });

        // Create sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
    }

    /**
     * Create compute pipeline for generating overlays
     */
    private async createComputePipeline(): Promise<void> {
        const computeShaderSource = `
            struct Uniforms {
                tile_world_x: f32,
                tile_world_z: f32,
                tile_size: f32,
                time: f32,
                wind_direction_x: f32,
                wind_direction_z: f32,
                wind_strength: f32,
                cluster_count: i32,
                clusters: array<GrassCluster, 64>,
            }
            
            struct GrassCluster {
                center_x: f32,
                center_y: f32,
                center_z: f32,
                radius: f32,
                density: f32,
                grass_type: f32,
                health_factor: f32,
                padding: f32,
            }
            
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var pattern_atlas: texture_2d<f32>;
            @group(0) @binding(2) var overlay_texture: texture_storage_2d<rgba8unorm, write>;
            @group(0) @binding(3) var density_texture: texture_storage_2d<r8unorm, write>;
            @group(0) @binding(4) var type_texture: texture_storage_2d<r8unorm, write>;
            
            @compute @workgroup_size(8, 8)
            fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let resolution = 512u;
                if (global_id.x >= resolution || global_id.y >= resolution) {
                    return;
                }
                
                let uv = vec2<f32>(f32(global_id.x), f32(global_id.y)) / f32(resolution);
                let world_pos = vec2<f32>(
                    uniforms.tile_world_x + uv.x * uniforms.tile_size,
                    uniforms.tile_world_z + uv.y * uniforms.tile_size
                );
                
                var total_density = 0.0;
                var weighted_color = vec3<f32>(0.0);
                var dominant_type = 0.0;
                var max_influence = 0.0;
                
                // Sample all grass clusters affecting this pixel
                for (var i = 0; i < uniforms.cluster_count; i = i + 1) {
                    let cluster = uniforms.clusters[i];
                    let distance = distance(world_pos, vec2<f32>(cluster.center_x, cluster.center_z));
                    
                    if (distance < cluster.radius) {
                        let influence = (1.0 - distance / cluster.radius) * cluster.density * cluster.health_factor;
                        
                        if (influence > max_influence) {
                            max_influence = influence;
                            dominant_type = cluster.grass_type;
                        }
                        
                        total_density += influence;
                        
                        // Get pattern color from atlas
                        let pattern_uv = get_pattern_uv(uv, i32(cluster.grass_type));
                        let pattern_color = textureSampleLevel(pattern_atlas, pattern_uv, 0.0);
                        weighted_color += pattern_color.rgb * influence;
                    }
                }
                
                if (total_density > 0.0) {
                    weighted_color /= total_density;
                }
                
                // Clamp density
                total_density = min(total_density, 1.0);
                
                // Write results
                let coord = vec2<i32>(global_id.xy);
                textureStore(overlay_texture, coord, vec4<f32>(weighted_color, total_density));
                textureStore(density_texture, coord, vec4<f32>(total_density));
                textureStore(type_texture, coord, vec4<f32>(dominant_type / 8.0));
            }
            
            fn get_pattern_uv(base_uv: vec2<f32>, grass_type: i32) -> vec2<f32> {
                let patterns_per_row = 8;
                let pattern_x = grass_type % patterns_per_row;
                let pattern_y = grass_type / patterns_per_row;
                let pattern_size = 1.0 / f32(patterns_per_row);
                
                return vec2<f32>(
                    f32(pattern_x) * pattern_size + base_uv.x * pattern_size,
                    f32(pattern_y) * pattern_size + base_uv.y * pattern_size
                );
            }
        `;

        const computeShader = this.device.createShaderModule({
            code: computeShaderSource,
            label: 'grass-overlay-compute-shader',
        });

        this.overlayBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: 'rgba8unorm' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: 'r8unorm' },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: 'r8unorm' },
                },
            ],
            label: 'grass-overlay-bind-group-layout',
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.overlayBindGroupLayout],
            label: 'grass-overlay-pipeline-layout',
        });

        this.overlayPipeline = this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: computeShader,
                entryPoint: 'cs_main',
            },
            label: 'grass-overlay-pipeline',
        });

        // Create uniform buffer
        this.overlayUniformBuffer = this.device.createBuffer({
            size: 1024, // Large enough for uniforms + cluster data
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'grass-overlay-uniforms',
        });
    }

    /**
     * Initialize grass texture layers
     */
    private initializeGrassTextureLayers(): void {
        // Temperate grass
        this.grassTextureLayers.set(0, {
            grassType: 0,
            density: 0.8,
            scale: 1.0,
            rotation: 0,
            color: { r: 0.2, g: 0.6, b: 0.1, a: 1.0 },
            windResponsiveness: 1.0,
        });

        // Dry grass
        this.grassTextureLayers.set(1, {
            grassType: 1,
            density: 0.6,
            scale: 0.8,
            rotation: 0,
            color: { r: 0.5, g: 0.4, b: 0.1, a: 1.0 },
            windResponsiveness: 0.7,
        });

        // Lush grass
        this.grassTextureLayers.set(2, {
            grassType: 2,
            density: 1.0,
            scale: 1.2,
            rotation: 0,
            color: { r: 0.1, g: 0.8, b: 0.2, a: 1.0 },
            windResponsiveness: 1.2,
        });

        // Alpine grass
        this.grassTextureLayers.set(3, {
            grassType: 3,
            density: 0.5,
            scale: 0.6,
            rotation: 0,
            color: { r: 0.3, g: 0.5, b: 0.2, a: 1.0 },
            windResponsiveness: 0.8,
        });
    }

    /**
     * Generate grass overlay for a terrain tile
     */
    public generateOverlayForTile(
        tile: TerrainTile,
        grassClusters: GrassCluster[],
        windDirection: Vector3 = new Vector3(1, 0, 0),
        windStrength: number = 1.0,
        time: number = 0
    ): GrassOverlay {
        if (!this.overlayPipeline || !this.overlayBindGroupLayout || !this.overlayUniformBuffer) {
            throw new Error('GrassOverlayRenderer not properly initialized');
        }

        console.log(
            `GrassOverlayRenderer: Generating overlay for tile ${tile.id} with ${grassClusters.length} clusters`
        );

        // Prepare uniform data
        const uniformData = new Float32Array(256); // 1024 bytes / 4 = 256 floats
        let offset = 0;

        // Basic uniforms
        uniformData[offset++] = tile.worldBounds.minX;
        uniformData[offset++] = tile.worldBounds.minZ;
        uniformData[offset++] = tile.size;
        uniformData[offset++] = time;
        uniformData[offset++] = windDirection.x;
        uniformData[offset++] = windDirection.z;
        uniformData[offset++] = windStrength;
        uniformData[offset++] = Math.min(grassClusters.length, 64); // Max clusters

        // Cluster data (8 floats per cluster)
        for (let i = 0; i < Math.min(grassClusters.length, 64); i++) {
            const cluster = grassClusters[i];
            uniformData[offset++] = cluster.center.x;
            uniformData[offset++] = cluster.center.y;
            uniformData[offset++] = cluster.center.z;
            uniformData[offset++] = cluster.radius;
            uniformData[offset++] = cluster.density;
            uniformData[offset++] = cluster.grassType;
            uniformData[offset++] = cluster.healthFactor;
            uniformData[offset++] = 0; // padding
        }

        // Update uniform buffer
        this.device.queue.writeBuffer(this.overlayUniformBuffer, 0, uniformData);

        // Create bind group for compute pass
        const bindGroup = this.device.createBindGroup({
            layout: this.overlayBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.overlayUniformBuffer } },
                { binding: 1, resource: this.grassPatternAtlas!.createView() },
                { binding: 2, resource: this.grassOverlayTexture!.createView() },
                { binding: 3, resource: this.grassDensityTexture!.createView() },
                { binding: 4, resource: this.grassTypeTexture!.createView() },
            ],
            label: 'grass-overlay-bind-group',
        });

        // Run compute pass
        const commandEncoder = this.device.createCommandEncoder({ label: 'grass-overlay-compute' });
        const computePass = commandEncoder.beginComputePass({ label: 'grass-overlay-pass' });

        computePass.setPipeline(this.overlayPipeline);
        computePass.setBindGroup(0, bindGroup);

        const workgroupsX = Math.ceil(this.OVERLAY_RESOLUTION / 8);
        const workgroupsY = Math.ceil(this.OVERLAY_RESOLUTION / 8);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

        computePass.end();
        this.device.queue.submit([commandEncoder.finish()]);

        // Create overlay data
        const overlay: GrassOverlay = {
            textureId: 0, // Will be assigned by texture manager
            blendFactor: 1.0,
            tileCoords: { x: tile.x, z: tile.z },
            worldBounds: tile.worldBounds,
            grassDensityMap: new Float32Array(this.OVERLAY_RESOLUTION * this.OVERLAY_RESOLUTION),
            grassTypeMap: new Uint8Array(this.OVERLAY_RESOLUTION * this.OVERLAY_RESOLUTION),
        };

        this.overlays.set(tile.id, overlay);
        return overlay;
    }

    /**
     * Get grass overlay textures for terrain integration
     */
    public getOverlayTextures() {
        return {
            overlayTexture: this.grassOverlayTexture,
            densityTexture: this.grassDensityTexture,
            typeTexture: this.grassTypeTexture,
            sampler: this.sampler,
        };
    }

    /**
     * Simple 2D noise function
     */
    private noise2D(x: number, y: number): number {
        const p = Math.floor(x * 43.0 + y * 17.0);
        const hash = Math.sin(p * 0.01234) * 43758.5453;
        return (hash - Math.floor(hash)) * 2.0 - 1.0;
    }

    /**
     * Get grass overlay for a specific tile
     */
    public getOverlayForTile(tileId: string): GrassOverlay | null {
        return this.overlays.get(tileId) || null;
    }

    /**
     * Clear overlay for a specific tile
     */
    public clearOverlayForTile(tileId: string): void {
        this.overlays.delete(tileId);
    }

    /**
     * Clear all overlays
     */
    public clearAll(): void {
        this.overlays.clear();
    }

    /**
     * Get rendering statistics
     */
    public getStats() {
        return {
            activeOverlays: this.overlays.size,
            overlayResolution: this.OVERLAY_RESOLUTION,
            atlasSize: this.ATLAS_SIZE,
            memoryUsage: this.overlays.size * this.OVERLAY_RESOLUTION * this.OVERLAY_RESOLUTION * 4,
        };
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.grassOverlayTexture?.destroy();
        this.grassDensityTexture?.destroy();
        this.grassTypeTexture?.destroy();
        this.grassPatternAtlas?.destroy();
        this.overlayUniformBuffer?.destroy();
        this.overlays.clear();
    }
}
