import { Matrix4, Vector3 } from '../core/math';
import { ShaderManager } from './pipeline/ShaderManager';
import type {
    VegetationInstance,
    VegetationPlacement,
    TreeSpecies,
    GrassType,
} from '../world/VegetationSystem';

/**
 * Instance data for GPU rendering
 */
export interface VegetationInstanceData {
    modelMatrix: Float32Array; // 16 floats
    normalMatrix: Float32Array; // 9 floats
    lodLevel: number;
    speciesId: number;
    windPhase: number; // For wind animation
    padding: Float32Array; // Align to 16-byte boundaries
}

/**
 * Render batch for instanced rendering
 */
export interface VegetationBatch {
    speciesId: number;
    type: 'tree' | 'grass';
    instances: VegetationInstance[];
    instanceBuffer: GPUBuffer | null;
    instanceData: Float32Array | null;
    vertexBuffer: GPUBuffer | null;
    indexBuffer: GPUBuffer | null;
    bindGroup: GPUBindGroup | null;
    pipeline: GPURenderPipeline | null;
    needsUpdate: boolean;
    vertexCount: number;
    indexCount: number;
}

/**
 * Wind simulation parameters
 */
export interface WindParams {
    direction: Vector3;
    strength: number;
    frequency: number;
    time: number;
}

/**
 * GPU-accelerated vegetation rendering system with instancing
 */
export class VegetationRenderer {
    private device: GPUDevice;
    private shaderManager: ShaderManager;
    private batches: Map<string, VegetationBatch> = new Map();

    // Shared resources
    private cameraUniformBuffer: GPUBuffer | null = null;
    private windUniformBuffer: GPUBuffer | null = null;
    private textureAtlas: GPUTexture | null = null;
    private sampler: GPUSampler | null = null;

    // Pipeline layouts
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private pipelineLayout: GPUPipelineLayout | null = null;

    // Wind simulation
    private wind: WindParams = {
        direction: new Vector3(1, 0, 0.5).normalize(),
        strength: 2.0,
        frequency: 0.5,
        time: 0,
    };

    // Performance tracking
    private stats = {
        batchCount: 0,
        instanceCount: 0,
        drawCalls: 0,
        triangles: 0,
    };

    constructor(device: GPUDevice, shaderManager: ShaderManager) {
        this.device = device;
        this.shaderManager = shaderManager;
    }

    /**
     * Initialize the vegetation renderer
     */
    public async initialize(): Promise<void> {
        console.log('VegetationRenderer: Initializing...');

        // Create shared resources
        await this.createSharedResources();

        // Create pipeline layouts
        this.createPipelineLayouts();

        // Create basic tree and grass geometry
        await this.createBasicGeometry();

        console.log('VegetationRenderer: Initialization complete');
    }

    /**
     * Create shared GPU resources
     */
    private async createSharedResources(): Promise<void> {
        // Camera uniform buffer
        this.cameraUniformBuffer = this.device.createBuffer({
            size: 64 * 4, // 4x4 view-projection matrix
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'vegetation-camera-uniforms',
        });

        // Wind uniform buffer
        this.windUniformBuffer = this.device.createBuffer({
            size: 8 * 4, // direction (vec3) + strength + frequency + time + padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'vegetation-wind-uniforms',
        });

        // Create a basic texture atlas (placeholder for now)
        this.textureAtlas = this.device.createTexture({
            size: { width: 512, height: 512, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: 'vegetation-texture-atlas',
        });

        // Create sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            maxAnisotropy: 4,
        });

        // Initialize texture with basic pattern
        await this.initializeTextureAtlas();
    }

    /**
     * Create pipeline layouts
     */
    private createPipelineLayouts(): void {
        // Bind group layout for vegetation rendering
        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }, // Camera uniforms
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' }, // Wind uniforms
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}, // Texture atlas
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}, // Sampler
                },
            ],
            label: 'vegetation-bind-group-layout',
        });

        // Pipeline layout
        this.pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
            label: 'vegetation-pipeline-layout',
        });
    }

    /**
     * Create basic geometry for trees and grass
     */
    private async createBasicGeometry(): Promise<void> {
        // Create tree geometry (simple billboarded quad for now)
        await this.createTreeGeometry();

        // Create grass geometry (cross-shaped billboards)
        await this.createGrassGeometry();
    }

    /**
     * Create tree geometry
     */
    private async createTreeGeometry(): Promise<void> {
        // Simple billboard quad for trees
        const vertices = new Float32Array([
            // Position (x, y, z), Normal (x, y, z), UV (u, v)
            -0.5,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            1.0, // Bottom left
            0.5,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0, // Bottom right
            0.5,
            1.0,
            0.0,
            0.0,
            0.0,
            1.0,
            1.0,
            0.0, // Top right
            -0.5,
            1.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.0, // Top left
        ]);

        const indices = new Uint16Array([
            0,
            1,
            2,
            0,
            2,
            3, // Two triangles for quad
        ]);

        // Create vertex buffer for tree geometry
        const treeVertexBuffer = this.device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
            label: 'tree-vertex-buffer',
        });
        new Float32Array(treeVertexBuffer.getMappedRange()).set(vertices);
        treeVertexBuffer.unmap();

        // Create index buffer for tree geometry
        const treeIndexBuffer = this.device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true,
            label: 'tree-index-buffer',
        });
        new Uint16Array(treeIndexBuffer.getMappedRange()).set(indices);
        treeIndexBuffer.unmap();

        // Store tree geometry (will be used by all tree species)
        this.storeGeometry(
            'tree',
            treeVertexBuffer,
            treeIndexBuffer,
            vertices.length / 8,
            indices.length
        );
    }

    /**
     * Create grass geometry (cross-shaped billboards)
     */
    private async createGrassGeometry(): Promise<void> {
        // Cross-shaped billboards for better grass appearance
        const vertices = new Float32Array([
            // First quad (facing front/back)
            -0.5, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.5,
            0.3, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, -0.5, 0.3, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,

            // Second quad (facing left/right)
            0.0, 0.0, -0.5, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0,
            0.3, 0.5, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.3, -0.5, 1.0, 0.0, 0.0, 0.0, 0.0,
        ]);

        const indices = new Uint16Array([
            // First quad
            0, 1, 2, 0, 2, 3,
            // Second quad
            4, 5, 6, 4, 6, 7,
        ]);

        // Create vertex buffer for grass geometry
        const grassVertexBuffer = this.device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
            label: 'grass-vertex-buffer',
        });
        new Float32Array(grassVertexBuffer.getMappedRange()).set(vertices);
        grassVertexBuffer.unmap();

        // Create index buffer for grass geometry
        const grassIndexBuffer = this.device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true,
            label: 'grass-index-buffer',
        });
        new Uint16Array(grassIndexBuffer.getMappedRange()).set(indices);
        grassIndexBuffer.unmap();

        // Store grass geometry
        this.storeGeometry(
            'grass',
            grassVertexBuffer,
            grassIndexBuffer,
            vertices.length / 8,
            indices.length
        );
    }

    /**
     * Store geometry for reuse
     */
    private storeGeometry(
        type: string,
        vertexBuffer: GPUBuffer,
        indexBuffer: GPUBuffer,
        vertexCount: number,
        indexCount: number
    ): void {
        // Store in a way that can be retrieved later for batch creation
        (this as any)[`${type}VertexBuffer`] = vertexBuffer;
        (this as any)[`${type}IndexBuffer`] = indexBuffer;
        (this as any)[`${type}VertexCount`] = vertexCount;
        (this as any)[`${type}IndexCount`] = indexCount;
    }

    /**
     * Update vegetation batches from placement data
     */
    public updateBatches(placements: Map<string, VegetationPlacement>): void {
        // Clear existing batches
        this.clearBatches();

        // Group all instances by type and species
        const allTreeInstances = new Map<number, VegetationInstance[]>();
        const allGrassInstances = new Map<number, VegetationInstance[]>();

        for (const placement of placements.values()) {
            // Process tree batches
            for (const [speciesId, instances] of placement.treeBatches) {
                if (!allTreeInstances.has(speciesId)) {
                    allTreeInstances.set(speciesId, []);
                }
                allTreeInstances.get(speciesId)!.push(...instances.filter((i) => i.visible));
            }

            // Process grass batches
            for (const [speciesId, instances] of placement.grassBatches) {
                if (!allGrassInstances.has(speciesId)) {
                    allGrassInstances.set(speciesId, []);
                }
                allGrassInstances.get(speciesId)!.push(...instances.filter((i) => i.visible));
            }
        }

        // Create batches for trees
        for (const [speciesId, instances] of allTreeInstances) {
            if (instances.length > 0) {
                this.createBatch(`tree_${speciesId}`, 'tree', speciesId, instances);
            }
        }

        // Create batches for grass
        for (const [speciesId, instances] of allGrassInstances) {
            if (instances.length > 0) {
                this.createBatch(`grass_${speciesId}`, 'grass', speciesId, instances);
            }
        }

        this.updateStats();
    }

    /**
     * Create a render batch for a specific species
     */
    private createBatch(
        batchId: string,
        type: 'tree' | 'grass',
        speciesId: number,
        instances: VegetationInstance[]
    ): void {
        const batch: VegetationBatch = {
            speciesId,
            type,
            instances: [...instances],
            instanceBuffer: null,
            instanceData: null,
            vertexBuffer: (this as any)[`${type}VertexBuffer`],
            indexBuffer: (this as any)[`${type}IndexBuffer`],
            bindGroup: null,
            pipeline: null,
            needsUpdate: true,
            vertexCount: (this as any)[`${type}VertexCount`],
            indexCount: (this as any)[`${type}IndexCount`],
        };

        // Create instance data
        this.updateBatchInstanceData(batch);

        // Create render pipeline for this batch
        this.createBatchPipeline(batch);

        // Create bind group
        this.createBatchBindGroup(batch);

        this.batches.set(batchId, batch);
    }

    /**
     * Update instance data for a batch
     */
    private updateBatchInstanceData(batch: VegetationBatch): void {
        const instanceCount = batch.instances.length;
        const instanceStride = 32; // 16 floats for model matrix + 16 for additional data

        batch.instanceData = new Float32Array(instanceCount * instanceStride);

        for (let i = 0; i < instanceCount; i++) {
            const instance = batch.instances[i];
            const offset = i * instanceStride;

            // Create model matrix
            const modelMatrix = new Matrix4();
            modelMatrix.makeTranslation(
                instance.position.x,
                instance.position.y,
                instance.position.z
            );

            // Apply rotation
            const rotationMatrix = new Matrix4();
            rotationMatrix.makeRotationY(instance.rotation);
            modelMatrix.multiply(rotationMatrix);

            // Apply scale
            const scaleMatrix = new Matrix4();
            scaleMatrix.makeScale(instance.scale.x, instance.scale.y, instance.scale.z);
            modelMatrix.multiply(scaleMatrix);

            // Set model matrix (16 floats)
            batch.instanceData.set(modelMatrix.elements, offset);

            // Set additional instance data
            batch.instanceData[offset + 16] = instance.lodLevel;
            batch.instanceData[offset + 17] = instance.speciesId;
            batch.instanceData[offset + 18] = Math.random() * Math.PI * 2; // Wind phase
            // Remaining floats are padding for alignment
        }

        // Create/update instance buffer
        if (batch.instanceBuffer) {
            batch.instanceBuffer.destroy();
        }

        batch.instanceBuffer = this.device.createBuffer({
            size: batch.instanceData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
            label: `${batch.type}-${batch.speciesId}-instances`,
        });

        new Float32Array(batch.instanceBuffer.getMappedRange()).set(batch.instanceData);
        batch.instanceBuffer.unmap();

        batch.needsUpdate = false;
    }

    /**
     * Create render pipeline for a batch
     */
    private createBatchPipeline(batch: VegetationBatch): void {
        // Get or create shader module
        const shaderModule = this.shaderManager.getShader('vegetation');
        if (!shaderModule) {
            console.error('Vegetation shader not found');
            return;
        }

        // Vertex buffer layout
        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 8 * 4, // 8 floats per vertex (pos + normal + uv)
            attributes: [
                { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                { format: 'float32x3', offset: 3 * 4, shaderLocation: 1 }, // normal
                { format: 'float32x2', offset: 6 * 4, shaderLocation: 2 }, // uv
            ],
        };

        // Instance buffer layout
        const instanceBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 32 * 4, // 32 floats per instance
            stepMode: 'instance',
            attributes: [
                // Model matrix (4x4)
                { format: 'float32x4', offset: 0, shaderLocation: 3 },
                { format: 'float32x4', offset: 4 * 4, shaderLocation: 4 },
                { format: 'float32x4', offset: 8 * 4, shaderLocation: 5 },
                { format: 'float32x4', offset: 12 * 4, shaderLocation: 6 },
                // Instance data
                { format: 'float32x4', offset: 16 * 4, shaderLocation: 7 }, // lod, species, windPhase, padding
            ],
        };

        // Create render pipeline
        batch.pipeline = this.device.createRenderPipeline({
            layout: this.pipelineLayout!,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [vertexBufferLayout, instanceBufferLayout],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'bgra8unorm' }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Don't cull for billboards
            },
            depthStencil: {
                format: 'depth24plus-stencil8',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
            label: `vegetation-pipeline-${batch.type}-${batch.speciesId}`,
        });
    }

    /**
     * Create bind group for a batch
     */
    private createBatchBindGroup(batch: VegetationBatch): void {
        if (!this.bindGroupLayout) return;

        batch.bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.cameraUniformBuffer! } },
                { binding: 1, resource: { buffer: this.windUniformBuffer! } },
                { binding: 2, resource: this.textureAtlas!.createView() },
                { binding: 3, resource: this.sampler! },
            ],
            label: `vegetation-bind-group-${batch.type}-${batch.speciesId}`,
        });
    }

    /**
     * Update camera uniforms
     */
    public updateCameraUniforms(viewProjectionMatrix: Matrix4): void {
        if (!this.cameraUniformBuffer) return;

        this.device.queue.writeBuffer(
            this.cameraUniformBuffer,
            0,
            viewProjectionMatrix.elements.buffer,
            viewProjectionMatrix.elements.byteOffset,
            viewProjectionMatrix.elements.byteLength
        );
    }

    /**
     * Update wind simulation
     */
    public updateWind(deltaTime: number): void {
        this.wind.time += deltaTime;

        if (!this.windUniformBuffer) return;

        const windData = new Float32Array([
            this.wind.direction.x,
            this.wind.direction.y,
            this.wind.direction.z,
            this.wind.strength,
            this.wind.frequency,
            this.wind.time,
            0,
            0, // padding
        ]);

        this.device.queue.writeBuffer(this.windUniformBuffer, 0, windData);
    }

    /**
     * Render all vegetation batches
     */
    public render(renderPass: GPURenderPassEncoder): void {
        this.stats.drawCalls = 0;
        this.stats.triangles = 0;

        for (const batch of this.batches.values()) {
            if (batch.instances.length === 0 || !batch.pipeline || !batch.bindGroup) {
                continue;
            }

            // Update instance data if needed
            if (batch.needsUpdate) {
                this.updateBatchInstanceData(batch);
            }

            // Set pipeline and bind group
            renderPass.setPipeline(batch.pipeline);
            renderPass.setBindGroup(0, batch.bindGroup);

            // Set vertex and instance buffers
            renderPass.setVertexBuffer(0, batch.vertexBuffer!);
            renderPass.setVertexBuffer(1, batch.instanceBuffer!);
            renderPass.setIndexBuffer(batch.indexBuffer!, 'uint16');

            // Draw instances
            renderPass.drawIndexed(batch.indexCount, batch.instances.length, 0, 0, 0);

            this.stats.drawCalls++;
            this.stats.triangles += (batch.indexCount / 3) * batch.instances.length;
        }
    }

    /**
     * Initialize texture atlas with basic patterns
     */
    private async initializeTextureAtlas(): Promise<void> {
        const size = 512;
        const data = new Uint8Array(size * size * 4);

        // Create simple patterns for different vegetation types
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;

                // Create a simple green texture with some variation
                const noise = Math.random() * 0.3;
                data[index] = Math.floor((0.2 + noise) * 255); // R
                data[index + 1] = Math.floor((0.6 + noise) * 255); // G
                data[index + 2] = Math.floor((0.1 + noise) * 255); // B
                data[index + 3] = 255; // A
            }
        }

        this.device.queue.writeTexture(
            { texture: this.textureAtlas! },
            data,
            { bytesPerRow: size * 4 },
            { width: size, height: size }
        );
    }

    /**
     * Set wind parameters
     */
    public setWind(direction: Vector3, strength: number, frequency: number): void {
        this.wind.direction = direction.normalize();
        this.wind.strength = strength;
        this.wind.frequency = frequency;
    }

    /**
     * Clear all batches
     */
    private clearBatches(): void {
        for (const batch of this.batches.values()) {
            if (batch.instanceBuffer) {
                batch.instanceBuffer.destroy();
            }
        }
        this.batches.clear();
    }

    /**
     * Update performance statistics
     */
    private updateStats(): void {
        this.stats.batchCount = this.batches.size;
        this.stats.instanceCount = 0;

        for (const batch of this.batches.values()) {
            this.stats.instanceCount += batch.instances.length;
        }
    }

    /**
     * Get rendering statistics
     */
    public getStats() {
        return { ...this.stats };
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.clearBatches();

        if (this.cameraUniformBuffer) {
            this.cameraUniformBuffer.destroy();
            this.cameraUniformBuffer = null;
        }

        if (this.windUniformBuffer) {
            this.windUniformBuffer.destroy();
            this.windUniformBuffer = null;
        }

        if (this.textureAtlas) {
            this.textureAtlas.destroy();
            this.textureAtlas = null;
        }

        // Clean up stored geometry
        const geometryTypes = ['tree', 'grass'];
        for (const type of geometryTypes) {
            const vertexBuffer = (this as any)[`${type}VertexBuffer`];
            const indexBuffer = (this as any)[`${type}IndexBuffer`];

            if (vertexBuffer) vertexBuffer.destroy();
            if (indexBuffer) indexBuffer.destroy();
        }
    }
}
