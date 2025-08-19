import { Matrix4, Vector3 } from '../core/math';
import { ShaderManager } from './pipeline/ShaderManager';
import { Camera } from './Camera';
import type { TerrainTile } from '../world/TerrainTile';
import type { GrassType } from '../world/VegetationSystem';

/**
 * Grass blade instance data for GPU rendering
 */
export interface GrassInstance {
    position: Vector3;
    rotation: number;
    scale: Vector2;
    windPhase: number;
    grassType: number;
    height: number;
    density: number;
}

/**
 * Grass patch data for mid-range rendering
 */
export interface GrassPatch {
    position: Vector3;
    size: number;
    density: number;
    grassType: number;
    distance: number;
    visible: boolean;
    lodLevel: number;
}

/**
 * Wind simulation parameters for grass animation
 */
export interface GrassWindParams {
    direction: Vector3;
    strength: number;
    frequency: number;
    gustStrength: number;
    time: number;
}

/**
 * Advanced grass rendering system with multiple LOD levels
 * - LOD 0: Individual instanced grass blades for close-up detail
 * - LOD 1: Grass patches with detailed textures
 * - LOD 2: Grass overlay textures on terrain
 */
export class GrassRenderer {
    private device: GPUDevice;
    private shaderManager: ShaderManager;

    // Render resources
    private grassBladeVertexBuffer: GPUBuffer | null = null;
    private grassBladeIndexBuffer: GPUBuffer | null = null;
    private grassInstanceBuffer: GPUBuffer | null = null;
    private grassPatchBuffer: GPUBuffer | null = null;

    // Pipelines for different LOD levels
    private grassBladePipeline: GPURenderPipeline | null = null;
    private grassPatchPipeline: GPURenderPipeline | null = null;
    private grassOverlayPipeline: GPURenderPipeline | null = null;

    // Bind group layouts and resources
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private grassTextureAtlas: GPUTexture | null = null;
    private grassSampler: GPUSampler | null = null;
    private bindGroup: GPUBindGroup | null = null;

    // Grass data management
    private grassInstances: GrassInstance[] = [];
    private grassPatches: GrassPatch[] = [];
    private grassTypes: Map<number, GrassType> = new Map();
    private needsUpdate: boolean = true;

    // Wind simulation
    private wind: GrassWindParams = {
        direction: new Vector3(1, 0, 0.3).normalize(),
        strength: 1.5,
        frequency: 2.0,
        gustStrength: 0.5,
        time: 0,
    };

    // LOD thresholds (meters)
    private readonly LOD_DISTANCES = {
        BLADE_DETAIL: 50, // Individual blades visible up to 50m
        PATCH_DETAIL: 200, // Grass patches visible up to 200m
        OVERLAY_DETAIL: 1000, // Grass overlay visible up to 1000m
    };

    // Performance settings
    private readonly MAX_BLADE_INSTANCES = 50000;
    private readonly MAX_PATCH_INSTANCES = 10000;
    private readonly BLADES_PER_PATCH = 100;

    constructor(device: GPUDevice, shaderManager: ShaderManager) {
        this.device = device;
        this.shaderManager = shaderManager;
    }

    /**
     * Initialize the grass rendering system
     */
    public async initialize(): Promise<void> {
        console.log('GrassRenderer: Initializing...');

        // Create grass geometry
        await this.createGrassGeometry();

        // Create uniform buffer and bind group layout
        this.createUniformResources();

        // Create grass texture atlas
        await this.createGrassTextures();

        // Create rendering pipelines
        await this.createRenderPipelines();

        // Create bind group
        this.createBindGroup();

        console.log('GrassRenderer: Initialization complete');
    }

    /**
     * Create grass blade geometry for close-up detail
     */
    private async createGrassGeometry(): Promise<void> {
        // Create a realistic grass blade shape with multiple segments for wind bending
        const segments = 4; // Number of vertical segments for bending
        const width = 0.02; // 2cm wide blade
        const vertices: number[] = [];
        const indices: number[] = [];

        // Create grass blade vertices (position, normal, uv, segment)
        for (let i = 0; i <= segments; i++) {
            const y = i / segments; // Height from 0 to 1
            const segmentWidth = width * (1.0 - y * 0.3); // Taper towards tip

            // Left vertex
            vertices.push(
                -segmentWidth / 2,
                y,
                0, // position
                0,
                0,
                1, // normal (facing forward)
                0,
                y, // uv
                i // segment index for wind bending
            );

            // Right vertex
            vertices.push(
                segmentWidth / 2,
                y,
                0, // position
                0,
                0,
                1, // normal
                1,
                y, // uv
                i // segment index
            );
        }

        // Create triangle indices
        for (let i = 0; i < segments; i++) {
            const base = i * 2;
            // Triangle 1
            indices.push(base, base + 1, base + 2);
            // Triangle 2
            indices.push(base + 1, base + 3, base + 2);
        }

        const vertexData = new Float32Array(vertices);
        const indexData = new Uint16Array(indices);

        // Create vertex buffer
        this.grassBladeVertexBuffer = this.device.createBuffer({
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
            label: 'grass-blade-vertices',
        });
        new Float32Array(this.grassBladeVertexBuffer.getMappedRange()).set(vertexData);
        this.grassBladeVertexBuffer.unmap();

        // Create index buffer
        this.grassBladeIndexBuffer = this.device.createBuffer({
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true,
            label: 'grass-blade-indices',
        });
        new Uint16Array(this.grassBladeIndexBuffer.getMappedRange()).set(indexData);
        this.grassBladeIndexBuffer.unmap();
    }

    /**
     * Create uniform buffer and bind group layout
     */
    private createUniformResources(): void {
        // Create uniform buffer for camera, wind, and grass parameters
        // Camera VP matrix (64 bytes) + Wind params (32 bytes) + Grass params (32 bytes) = 128 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 256, // Padded for alignment
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'grass-uniforms',
        });

        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0, // Uniforms
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1, // Grass texture atlas
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {},
                },
                {
                    binding: 2, // Sampler
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {},
                },
            ],
            label: 'grass-bind-group-layout',
        });
    }

    /**
     * Create grass texture atlas with different grass types
     */
    private async createGrassTextures(): Promise<void> {
        const atlasSize = 1024;
        const textureData = new Uint8Array(atlasSize * atlasSize * 4);

        // Create procedural grass textures for different types
        const grassTypeCount = 4;
        const typeSize = atlasSize / grassTypeCount;

        for (let type = 0; type < grassTypeCount; type++) {
            for (let y = 0; y < typeSize; y++) {
                for (let x = 0; x < typeSize; x++) {
                    const atlasX = (type % grassTypeCount) * typeSize + x;
                    const atlasY = Math.floor(type / grassTypeCount) * typeSize + y;
                    const index = (atlasY * atlasSize + atlasX) * 4;

                    // Generate grass blade patterns based on type
                    const grassColor = this.getGrassColorForType(type, x / typeSize, y / typeSize);
                    textureData[index] = grassColor.r;
                    textureData[index + 1] = grassColor.g;
                    textureData[index + 2] = grassColor.b;
                    textureData[index + 3] = grassColor.a;
                }
            }
        }

        // Create texture
        this.grassTextureAtlas = this.device.createTexture({
            size: { width: atlasSize, height: atlasSize },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: 'grass-texture-atlas',
        });

        this.device.queue.writeTexture(
            { texture: this.grassTextureAtlas },
            textureData,
            { bytesPerRow: atlasSize * 4 },
            { width: atlasSize, height: atlasSize }
        );

        // Create sampler
        this.grassSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            maxAnisotropy: 4,
        });
    }

    /**
     * Generate grass color for specific type and position
     */
    private getGrassColorForType(
        type: number,
        u: number,
        v: number
    ): { r: number; g: number; b: number; a: number } {
        const noise = (Math.sin(u * 20) + Math.cos(v * 15)) * 0.1;

        switch (type) {
            case 0: // Temperate grass
                return {
                    r: Math.floor((0.2 + noise) * 255),
                    g: Math.floor((0.6 + noise) * 255),
                    b: Math.floor((0.1 + noise) * 255),
                    a: 255,
                };
            case 1: // Dry grass
                return {
                    r: Math.floor((0.5 + noise) * 255),
                    g: Math.floor((0.4 + noise) * 255),
                    b: Math.floor((0.1 + noise) * 255),
                    a: 255,
                };
            case 2: // Lush grass
                return {
                    r: Math.floor((0.1 + noise) * 255),
                    g: Math.floor((0.8 + noise) * 255),
                    b: Math.floor((0.2 + noise) * 255),
                    a: 255,
                };
            case 3: // Alpine grass
                return {
                    r: Math.floor((0.3 + noise) * 255),
                    g: Math.floor((0.5 + noise) * 255),
                    b: Math.floor((0.2 + noise) * 255),
                    a: 255,
                };
            default:
                return { r: 100, g: 150, b: 50, a: 255 };
        }
    }

    /**
     * Create rendering pipelines for different LOD levels
     */
    private async createRenderPipelines(): Promise<void> {
        const grassShader = this.shaderManager.getShader('grass');
        if (!grassShader) {
            console.error('GrassRenderer: Grass shader not found');
            return;
        }

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout!],
            label: 'grass-pipeline-layout',
        });

        // Grass blade pipeline (LOD 0)
        this.grassBladePipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: grassShader,
                entryPoint: 'vs_blade',
                buffers: [
                    {
                        // Vertex buffer layout (position, normal, uv, segment)
                        arrayStride: 9 * 4, // 9 floats per vertex
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                            { format: 'float32x3', offset: 12, shaderLocation: 1 }, // normal
                            { format: 'float32x2', offset: 24, shaderLocation: 2 }, // uv
                            { format: 'float32', offset: 32, shaderLocation: 3 }, // segment
                        ],
                    },
                    {
                        // Instance buffer layout
                        arrayStride: 8 * 4, // 8 floats per instance
                        stepMode: 'instance',
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 4 }, // instance position
                            { format: 'float32x2', offset: 12, shaderLocation: 5 }, // scale
                            { format: 'float32', offset: 20, shaderLocation: 6 }, // rotation
                            { format: 'float32', offset: 24, shaderLocation: 7 }, // wind phase
                            { format: 'float32', offset: 28, shaderLocation: 8 }, // grass type
                        ],
                    },
                ],
            },
            fragment: {
                module: grassShader,
                entryPoint: 'fs_blade',
                targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Don't cull grass blades
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
            multisample: {
                count: 4,
            },
            label: 'grass-blade-pipeline',
        });

        // Grass patch pipeline (LOD 1) - uses billboard quads
        this.grassPatchPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: grassShader,
                entryPoint: 'vs_patch',
                buffers: [
                    {
                        // Instance buffer for patches
                        arrayStride: 6 * 4, // 6 floats per patch
                        stepMode: 'instance',
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                            { format: 'float32', offset: 12, shaderLocation: 1 }, // size
                            { format: 'float32', offset: 16, shaderLocation: 2 }, // density
                            { format: 'float32', offset: 20, shaderLocation: 3 }, // grass type
                        ],
                    },
                ],
            },
            fragment: {
                module: grassShader,
                entryPoint: 'fs_patch',
                targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
            multisample: {
                count: 4,
            },
            label: 'grass-patch-pipeline',
        });
    }

    /**
     * Create bind group with all resources
     */
    private createBindGroup(): void {
        if (
            !this.bindGroupLayout ||
            !this.uniformBuffer ||
            !this.grassTextureAtlas ||
            !this.grassSampler
        ) {
            return;
        }

        this.bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.grassTextureAtlas.createView() },
                { binding: 2, resource: this.grassSampler },
            ],
            label: 'grass-bind-group',
        });
    }

    /**
     * Generate grass instances for a terrain tile based on biome data
     */
    public generateGrassForTile(
        tile: TerrainTile,
        grassTypes: Map<number, GrassType>,
        cameraPosition: Vector3
    ): void {
        if (!tile.terrainData) {
            return;
        }

        const { heightmap, materials, slopes } = tile.terrainData;
        const resolution = Math.sqrt(heightmap.length);
        const step = tile.size / (resolution - 1);

        // Clear existing grass for this tile
        this.grassInstances = this.grassInstances.filter(
            (g) =>
                g.position.x < tile.worldBounds.minX ||
                g.position.x > tile.worldBounds.maxX ||
                g.position.z < tile.worldBounds.minZ ||
                g.position.z > tile.worldBounds.maxZ
        );

        this.grassPatches = this.grassPatches.filter(
            (g) =>
                g.position.x < tile.worldBounds.minX ||
                g.position.x > tile.worldBounds.maxX ||
                g.position.z < tile.worldBounds.minZ ||
                g.position.z > tile.worldBounds.maxZ
        );

        // Sample points across the tile for grass placement
        const sampleDensity = 32; // Sample every 32 pixels
        for (let z = 0; z < resolution; z += sampleDensity) {
            for (let x = 0; x < resolution; x += sampleDensity) {
                const worldX = tile.worldBounds.minX + (x / (resolution - 1)) * tile.size;
                const worldZ = tile.worldBounds.minZ + (z / (resolution - 1)) * tile.size;
                const worldY = heightmap[z * resolution + x];

                const biome = materials[z * resolution + x];
                const slope = slopes[z * resolution + x];

                // Find suitable grass types for this biome
                for (const [typeId, grassType] of grassTypes) {
                    if (!grassType.biomes.includes(biome)) continue;
                    if (slope > Math.PI / 6) continue; // Skip steep slopes

                    const distanceToCamera = Math.sqrt(
                        (worldX - cameraPosition.x) ** 2 + (worldZ - cameraPosition.z) ** 2
                    );

                    // Generate grass based on distance (LOD)
                    if (distanceToCamera < this.LOD_DISTANCES.BLADE_DETAIL) {
                        // Generate individual grass blades
                        this.generateGrassBlades(worldX, worldY, worldZ, typeId, grassType);
                    } else if (distanceToCamera < this.LOD_DISTANCES.PATCH_DETAIL) {
                        // Generate grass patches
                        this.generateGrassPatches(
                            worldX,
                            worldY,
                            worldZ,
                            typeId,
                            grassType,
                            distanceToCamera
                        );
                    }
                }
            }
        }

        this.needsUpdate = true;
    }

    /**
     * Generate individual grass blades for close-up detail
     */
    private generateGrassBlades(
        x: number,
        y: number,
        z: number,
        typeId: number,
        grassType: GrassType
    ): void {
        if (this.grassInstances.length >= this.MAX_BLADE_INSTANCES) return;

        const bladesCount = Math.floor(grassType.density * 0.01); // Reduce density for performance

        for (let i = 0; i < bladesCount; i++) {
            const offsetX = (Math.random() - 0.5) * grassType.patchSize;
            const offsetZ = (Math.random() - 0.5) * grassType.patchSize;

            this.grassInstances.push({
                position: new Vector3(x + offsetX, y, z + offsetZ),
                rotation: Math.random() * Math.PI * 2,
                scale: new Vector2(
                    0.8 + Math.random() * 0.4, // Width variation
                    grassType.height * (0.7 + Math.random() * 0.6) // Height variation
                ),
                windPhase: Math.random() * Math.PI * 2,
                grassType: typeId,
                height: grassType.height,
                density: grassType.density,
            });
        }
    }

    /**
     * Generate grass patches for mid-range detail
     */
    private generateGrassPatches(
        x: number,
        y: number,
        z: number,
        typeId: number,
        grassType: GrassType,
        distance: number
    ): void {
        if (this.grassPatches.length >= this.MAX_PATCH_INSTANCES) return;

        this.grassPatches.push({
            position: new Vector3(x, y, z),
            size: grassType.patchSize,
            density: grassType.density,
            grassType: typeId,
            distance,
            visible: true,
            lodLevel: 1,
        });
    }

    /**
     * Update grass instances based on camera position
     */
    public updateLOD(cameraPosition: Vector3): void {
        // Update grass instance visibility and LOD based on distance
        for (const instance of this.grassInstances) {
            const distance = cameraPosition.distanceTo(instance.position);
            // Grass blades are culled beyond blade detail distance
            // This is handled during generation
        }

        for (const patch of this.grassPatches) {
            const distance = cameraPosition.distanceTo(patch.position);
            patch.distance = distance;
            patch.visible = distance < this.LOD_DISTANCES.PATCH_DETAIL;

            if (distance < this.LOD_DISTANCES.BLADE_DETAIL) {
                patch.lodLevel = 0; // Could upgrade to blades
            } else if (distance < this.LOD_DISTANCES.PATCH_DETAIL) {
                patch.lodLevel = 1; // Patch detail
            } else {
                patch.lodLevel = 2; // Overlay detail
                patch.visible = distance < this.LOD_DISTANCES.OVERLAY_DETAIL;
            }
        }
    }

    /**
     * Update wind simulation
     */
    public updateWind(deltaTime: number, windDirection?: Vector3, windStrength?: number): void {
        this.wind.time += deltaTime;

        if (windDirection) {
            this.wind.direction = windDirection.normalize();
        }

        if (windStrength !== undefined) {
            this.wind.strength = windStrength;
        }
    }

    /**
     * Update uniform buffer with current camera and wind data
     */
    private updateUniforms(camera: Camera): void {
        const viewProjectionMatrix = new Matrix4().multiplyMatrices(
            camera.getProjectionMatrix(),
            camera.getViewMatrix()
        );

        // Create uniform data array
        const uniformData = new Float32Array(64); // 256 bytes / 4 = 64 floats
        let offset = 0;

        // View-projection matrix (16 floats)
        uniformData.set(viewProjectionMatrix.elements, offset);
        offset += 16;

        // Wind parameters (8 floats)
        uniformData[offset++] = this.wind.direction.x;
        uniformData[offset++] = this.wind.direction.y;
        uniformData[offset++] = this.wind.direction.z;
        uniformData[offset++] = this.wind.strength;
        uniformData[offset++] = this.wind.frequency;
        uniformData[offset++] = this.wind.gustStrength;
        uniformData[offset++] = this.wind.time;
        offset++; // padding

        // Grass parameters (8 floats)
        uniformData[offset++] = this.LOD_DISTANCES.BLADE_DETAIL;
        uniformData[offset++] = this.LOD_DISTANCES.PATCH_DETAIL;
        uniformData[offset++] = this.LOD_DISTANCES.OVERLAY_DETAIL;
        // Remaining slots reserved for future parameters

        this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);
    }

    /**
     * Render grass using appropriate LOD level
     */
    public render(renderPass: GPURenderPassEncoder, camera: Camera): void {
        if (!this.bindGroup) return;

        // Update uniforms
        this.updateUniforms(camera);

        // Update instance buffers if needed
        if (this.needsUpdate) {
            this.updateInstanceBuffers();
            this.needsUpdate = false;
        }

        renderPass.setBindGroup(0, this.bindGroup);

        // Render grass blades (LOD 0)
        if (this.grassBladePipeline && this.grassInstanceBuffer && this.grassInstances.length > 0) {
            this.renderGrassBlades(renderPass);
        }

        // Render grass patches (LOD 1)
        if (this.grassPatchPipeline && this.grassPatches.length > 0) {
            this.renderGrassPatches(renderPass);
        }
    }

    /**
     * Render individual grass blades
     */
    private renderGrassBlades(renderPass: GPURenderPassEncoder): void {
        renderPass.setPipeline(this.grassBladePipeline!);
        renderPass.setVertexBuffer(0, this.grassBladeVertexBuffer!);
        renderPass.setVertexBuffer(1, this.grassInstanceBuffer!);
        renderPass.setIndexBuffer(this.grassBladeIndexBuffer!, 'uint16');

        // Draw instanced grass blades
        renderPass.drawIndexed(24, this.grassInstances.length); // 8 triangles per blade
    }

    /**
     * Render grass patches as billboards
     */
    private renderGrassPatches(renderPass: GPURenderPassEncoder): void {
        renderPass.setPipeline(this.grassPatchPipeline!);
        renderPass.setVertexBuffer(0, this.grassPatchBuffer!);

        // Draw instanced patches (each patch is a billboard quad)
        const visiblePatches = this.grassPatches.filter((p) => p.visible);
        renderPass.draw(6, visiblePatches.length); // 2 triangles per patch
    }

    /**
     * Update instance buffers with current grass data
     */
    private updateInstanceBuffers(): void {
        // Update grass blade instance buffer
        if (this.grassInstances.length > 0) {
            const instanceData = new Float32Array(this.grassInstances.length * 8);

            for (let i = 0; i < this.grassInstances.length; i++) {
                const instance = this.grassInstances[i];
                const offset = i * 8;

                instanceData[offset] = instance.position.x;
                instanceData[offset + 1] = instance.position.y;
                instanceData[offset + 2] = instance.position.z;
                instanceData[offset + 3] = instance.scale.x;
                instanceData[offset + 4] = instance.scale.y;
                instanceData[offset + 5] = instance.rotation;
                instanceData[offset + 6] = instance.windPhase;
                instanceData[offset + 7] = instance.grassType;
            }

            // Create or update instance buffer
            if (this.grassInstanceBuffer) {
                this.grassInstanceBuffer.destroy();
            }

            this.grassInstanceBuffer = this.device.createBuffer({
                size: instanceData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
                label: 'grass-instance-buffer',
            });

            new Float32Array(this.grassInstanceBuffer.getMappedRange()).set(instanceData);
            this.grassInstanceBuffer.unmap();
        }

        // Update grass patch buffer
        if (this.grassPatches.length > 0) {
            const patchData = new Float32Array(this.grassPatches.length * 6);

            for (let i = 0; i < this.grassPatches.length; i++) {
                const patch = this.grassPatches[i];
                const offset = i * 6;

                patchData[offset] = patch.position.x;
                patchData[offset + 1] = patch.position.y;
                patchData[offset + 2] = patch.position.z;
                patchData[offset + 3] = patch.size;
                patchData[offset + 4] = patch.density;
                patchData[offset + 5] = patch.grassType;
            }

            if (this.grassPatchBuffer) {
                this.grassPatchBuffer.destroy();
            }

            this.grassPatchBuffer = this.device.createBuffer({
                size: patchData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
                label: 'grass-patch-buffer',
            });

            new Float32Array(this.grassPatchBuffer.getMappedRange()).set(patchData);
            this.grassPatchBuffer.unmap();
        }
    }

    /**
     * Get grass rendering statistics
     */
    public getStats() {
        return {
            grassBlades: this.grassInstances.length,
            grassPatches: this.grassPatches.length,
            memoryUsage: this.grassInstances.length * 32 + this.grassPatches.length * 24,
        };
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.grassBladeVertexBuffer?.destroy();
        this.grassBladeIndexBuffer?.destroy();
        this.grassInstanceBuffer?.destroy();
        this.grassPatchBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.grassTextureAtlas?.destroy();
    }
}

// Vector2 helper class (if not already defined)
class Vector2 {
    constructor(
        public x: number,
        public y: number
    ) {}
}
