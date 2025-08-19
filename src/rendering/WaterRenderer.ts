import { Camera } from './Camera';
import { Vector3, Matrix4 } from '../core/math';
import { WaterSystem, WaterSurface, WaterRenderData } from '../world/WaterSystem';

/**
 * Water reflection configuration
 */
export interface ReflectionConfig {
    enabled: boolean;
    resolution: number;
    maxDistance: number;
    downscaleFactor: number;
    updateFrequency: number;
    planarReflections: boolean;
    screenSpaceReflections: boolean;
}

/**
 * Water refraction configuration
 */
export interface RefractionConfig {
    enabled: boolean;
    resolution: number;
    distortionStrength: number;
    refractionIndex: number;
    underwaterFogDensity: number;
    underwaterColor: Vector3;
}

/**
 * Water rendering configuration
 */
export interface WaterRenderConfig {
    reflection: ReflectionConfig;
    refraction: RefractionConfig;
    foamEnabled: boolean;
    normalMapScale: number;
    roughness: number;
    transparency: number;
    fresnelPower: number;
    waveScale: number;
    waveSpeed: number;
    shoreBlendDistance: number;
}

/**
 * Water material properties
 */
export interface WaterMaterial {
    albedo: Vector3;
    roughness: number;
    metallic: number;
    transparency: number;
    refractionIndex: number;
    scatteringColor: Vector3;
    absorptionColor: Vector3;
    foamColor: Vector3;
    deepWaterColor: Vector3;
    shallowWaterColor: Vector3;
}

/**
 * Water render data for GPU
 */
interface WaterMeshData {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    bindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer;
    surface: WaterSurface;
}

/**
 * Water rendering statistics
 */
export interface WaterRenderStats {
    surfacesRendered: number;
    verticesRendered: number;
    reflectionUpdates: number;
    refractionUpdates: number;
    renderTime: number;
    memoryUsage: number;
}

/**
 * Advanced water renderer with realistic reflections and refraction
 */
export class WaterRenderer {
    private device: GPUDevice;
    private waterSystem: WaterSystem;
    private config: WaterRenderConfig;
    private material: WaterMaterial;

    // Rendering resources
    private pipeline: GPURenderPipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout;
    private pipelineLayout: GPUPipelineLayout;
    private meshCache: Map<string, WaterMeshData> = new Map();

    // Reflection resources
    private reflectionTexture: GPUTexture | null = null;
    private reflectionFramebuffer: GPUTexture | null = null;
    private reflectionDepthTexture: GPUTexture | null = null;
    private reflectionCamera: Camera | null = null;
    private lastReflectionUpdate: number = 0;

    // Refraction resources
    private refractionTexture: GPUTexture | null = null;
    private refractionFramebuffer: GPUTexture | null = null;
    private refractionDepthTexture: GPUTexture | null = null;

    // Samplers and textures
    private linearSampler: GPUSampler;
    private normalMapTexture: GPUTexture | null = null;
    private foamTexture: GPUTexture | null = null;

    // Uniform buffers
    private globalUniformBuffer: GPUBuffer;
    private materialUniformBuffer: GPUBuffer;

    private stats: WaterRenderStats;

    constructor(device: GPUDevice, waterSystem: WaterSystem, config?: Partial<WaterRenderConfig>) {
        this.device = device;
        this.waterSystem = waterSystem;

        // Default configuration
        this.config = {
            reflection: {
                enabled: true,
                resolution: 1024,
                maxDistance: 10000,
                downscaleFactor: 0.5,
                updateFrequency: 30, // FPS
                planarReflections: true,
                screenSpaceReflections: false,
            },
            refraction: {
                enabled: true,
                resolution: 1024,
                distortionStrength: 0.1,
                refractionIndex: 1.33,
                underwaterFogDensity: 0.02,
                underwaterColor: new Vector3(0.1, 0.3, 0.4),
            },
            foamEnabled: true,
            normalMapScale: 1.0,
            roughness: 0.02,
            transparency: 0.8,
            fresnelPower: 5.0,
            waveScale: 1.0,
            waveSpeed: 1.0,
            shoreBlendDistance: 10.0,
            ...config,
        };

        // Default water material
        this.material = {
            albedo: new Vector3(0.1, 0.3, 0.5),
            roughness: this.config.roughness,
            metallic: 0.0,
            transparency: this.config.transparency,
            refractionIndex: this.config.refraction.refractionIndex,
            scatteringColor: new Vector3(0.0, 0.1, 0.2),
            absorptionColor: new Vector3(0.45, 0.029, 0.018),
            foamColor: new Vector3(1.0, 1.0, 1.0),
            deepWaterColor: new Vector3(0.0, 0.1, 0.2),
            shallowWaterColor: new Vector3(0.2, 0.6, 0.8),
        };

        this.stats = {
            surfacesRendered: 0,
            verticesRendered: 0,
            reflectionUpdates: 0,
            refractionUpdates: 0,
            renderTime: 0,
            memoryUsage: 0,
        };

        this.createResources();
        this.createPipeline();
    }

    /**
     * Create water rendering resources
     */
    private createResources(): void {
        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Water Bind Group Layout',
            entries: [
                // Global uniforms
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                // Material uniforms
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                // Reflection texture
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Refraction texture
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Normal map
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Foam texture
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Linear sampler
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },
                },
            ],
        });

        this.pipelineLayout = this.device.createPipelineLayout({
            label: 'Water Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Create uniform buffers
        this.globalUniformBuffer = this.device.createBuffer({
            label: 'Water Global Uniform Buffer',
            size: 256, // MVP + view + projection + camera pos + time + wave params
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.materialUniformBuffer = this.device.createBuffer({
            label: 'Water Material Uniform Buffer',
            size: 128, // Material properties
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create samplers
        this.linearSampler = this.device.createSampler({
            label: 'Water Linear Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        // Create reflection and refraction targets
        this.createReflectionTargets();
        this.createRefractionTargets();
        this.createWaterTextures();
        this.updateMaterialUniforms();
    }

    /**
     * Create reflection render targets
     */
    private createReflectionTargets(): void {
        if (!this.config.reflection.enabled) return;

        const resolution = this.config.reflection.resolution;

        this.reflectionTexture = this.device.createTexture({
            label: 'Water Reflection Texture',
            size: [resolution, resolution, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.reflectionDepthTexture = this.device.createTexture({
            label: 'Water Reflection Depth',
            size: [resolution, resolution, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Create reflection camera
        this.reflectionCamera = new Camera(resolution, resolution);
    }

    /**
     * Create refraction render targets
     */
    private createRefractionTargets(): void {
        if (!this.config.refraction.enabled) return;

        const resolution = this.config.refraction.resolution;

        this.refractionTexture = this.device.createTexture({
            label: 'Water Refraction Texture',
            size: [resolution, resolution, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.refractionDepthTexture = this.device.createTexture({
            label: 'Water Refraction Depth',
            size: [resolution, resolution, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    /**
     * Create water textures (normal maps, foam)
     */
    private createWaterTextures(): void {
        // Create procedural normal map texture
        this.createProceduralNormalMap();
        this.createProceduralFoamTexture();
    }

    /**
     * Create procedural normal map
     */
    private createProceduralNormalMap(): void {
        const size = 512;
        const normalData = new Uint8Array(size * size * 4);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;

                // Generate normal map using noise
                const nx = (x / size - 0.5) * 2;
                const ny = (y / size - 0.5) * 2;

                // Simple wave normal
                const normal = this.generateWaveNormal(nx * 10, ny * 10);

                normalData[idx] = Math.floor((normal.x * 0.5 + 0.5) * 255); // R
                normalData[idx + 1] = Math.floor((normal.y * 0.5 + 0.5) * 255); // G
                normalData[idx + 2] = Math.floor((normal.z * 0.5 + 0.5) * 255); // B
                normalData[idx + 3] = 255; // A
            }
        }

        this.normalMapTexture = this.device.createTexture({
            label: 'Water Normal Map',
            size: [size, size, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.device.queue.writeTexture(
            { texture: this.normalMapTexture },
            normalData,
            { bytesPerRow: size * 4 },
            { width: size, height: size }
        );
    }

    /**
     * Create procedural foam texture
     */
    private createProceduralFoamTexture(): void {
        const size = 256;
        const foamData = new Uint8Array(size * size);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;

                // Generate foam pattern using noise
                const nx = x / size;
                const ny = y / size;
                const foam = this.generateFoamPattern(nx * 8, ny * 8);

                foamData[idx] = Math.floor(foam * 255);
            }
        }

        this.foamTexture = this.device.createTexture({
            label: 'Water Foam Texture',
            size: [size, size, 1],
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.device.queue.writeTexture(
            { texture: this.foamTexture },
            foamData,
            { bytesPerRow: size },
            { width: size, height: size }
        );
    }

    /**
     * Generate wave normal for normal map
     */
    private generateWaveNormal(x: number, y: number): Vector3 {
        const amplitude = 0.1;
        const frequency = 1.0;

        // Simple sine wave
        const height = amplitude * Math.sin(x * frequency) * Math.cos(y * frequency);

        // Calculate gradient
        const dx = amplitude * frequency * Math.cos(x * frequency) * Math.cos(y * frequency);
        const dy = amplitude * frequency * Math.sin(x * frequency) * -Math.sin(y * frequency);

        return new Vector3(-dx, 1.0, -dy).normalize();
    }

    /**
     * Generate foam pattern
     */
    private generateFoamPattern(x: number, y: number): number {
        // Simple noise-based foam pattern
        const noise1 = Math.sin(x * 2.3) * Math.cos(y * 1.7);
        const noise2 = Math.sin(x * 4.1 + noise1) * Math.cos(y * 3.9 + noise1);
        const foam = (noise1 + noise2) * 0.5 + 0.5;

        return Math.max(0, Math.min(1, foam));
    }

    /**
     * Create water rendering pipeline
     */
    private createPipeline(): void {
        const shaderModule = this.device.createShaderModule({
            label: 'Water Shader Module',
            code: this.getWaterShaderCode(),
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'Water Render Pipeline',
            layout: this.pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_water',
                buffers: [
                    {
                        arrayStride: 48, // position(12) + normal(12) + uv(8) + wave(16)
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                            { format: 'float32x3', offset: 12, shaderLocation: 1 }, // normal
                            { format: 'float32x2', offset: 24, shaderLocation: 2 }, // uv
                            { format: 'float32x4', offset: 32, shaderLocation: 3 }, // wave data
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_water',
                targets: [
                    {
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Water can be viewed from both sides
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
            multisample: {
                count: 4, // Match MSAA sample count
            },
        });
    }

    /**
     * Get water shader code
     */
    private getWaterShaderCode(): string {
        return `
            struct GlobalUniforms {
                mvpMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                projectionMatrix: mat4x4<f32>,
                cameraPosition: vec3<f32>,
                time: f32,
                waveDirection: vec3<f32>,
                waveAmplitude: f32,
                waveFrequency: f32,
                waveSpeed: f32,
            };
            
            struct MaterialUniforms {
                albedo: vec3<f32>,
                roughness: f32,
                transparency: f32,
                refractionIndex: f32,
                fresnelPower: f32,
                normalScale: f32,
                foamColor: vec3<f32>,
                deepColor: vec3<f32>,
                shallowColor: vec3<f32>,
            };
            
            @group(0) @binding(0) var<uniform> globals: GlobalUniforms;
            @group(0) @binding(1) var<uniform> material: MaterialUniforms;
            @group(0) @binding(2) var reflectionTexture: texture_2d<f32>;
            @group(0) @binding(3) var refractionTexture: texture_2d<f32>;
            @group(0) @binding(4) var normalMap: texture_2d<f32>;
            @group(0) @binding(5) var foamTexture: texture_2d<f32>;
            @group(0) @binding(6) var linearSampler: sampler;
            
            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) waveData: vec4<f32>,
            };
            
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) viewPos: vec3<f32>,
                @location(4) screenPos: vec4<f32>,
                @location(5) waveData: vec4<f32>,
            };
            
            @vertex
            fn vs_water(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                
                // Apply wave displacement
                var worldPos = input.position;
                let waveOffset = calculateWaveOffset(worldPos.xz, globals.time);
                worldPos.y += waveOffset;
                
                output.position = globals.mvpMatrix * vec4<f32>(worldPos, 1.0);
                output.worldPos = worldPos;
                output.normal = calculateWaveNormal(worldPos.xz, globals.time);
                output.uv = input.uv;
                output.viewPos = (globals.viewMatrix * vec4<f32>(worldPos, 1.0)).xyz;
                output.screenPos = output.position;
                output.waveData = input.waveData;
                
                return output;
            }
            
            @fragment
            fn fs_water(input: VertexOutput) -> @location(0) vec4<f32> {
                // Calculate screen coordinates for reflection/refraction sampling
                let screenUV = (input.screenPos.xy / input.screenPos.w) * 0.5 + 0.5;
                let correctedUV = vec2<f32>(screenUV.x, 1.0 - screenUV.y);
                
                // Sample normal map
                let normalMapSample = textureSample(normalMap, linearSampler, input.uv * 8.0 + globals.time * 0.02).xyz;
                let perturbedNormal = normalize(input.normal + (normalMapSample * 2.0 - 1.0) * material.normalScale);
                
                // Calculate view direction
                let viewDir = normalize(globals.cameraPosition - input.worldPos);
                
                // Calculate Fresnel term
                let fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), material.fresnelPower);
                
                // Sample reflection and refraction
                let reflectionUV = correctedUV + perturbedNormal.xz * 0.1;
                let refractionUV = correctedUV + perturbedNormal.xz * 0.05;
                
                let reflectionColor = textureSample(reflectionTexture, linearSampler, reflectionUV).rgb;
                let refractionColor = textureSample(refractionTexture, linearSampler, refractionUV).rgb;
                
                // Water depth and color
                let depth = length(input.viewPos);
                let depthFactor = 1.0 - exp(-depth * 0.001);
                let waterColor = mix(material.shallowColor, material.deepColor, depthFactor);
                
                // Combine reflection and refraction based on Fresnel
                var finalColor = mix(refractionColor * waterColor, reflectionColor, fresnel);
                
                // Add foam
                if (material.foamColor.x > 0.0) {
                    let foamSample = textureSample(foamTexture, linearSampler, input.uv * 4.0 + globals.time * 0.1).r;
                    let foamMask = input.waveData.w; // Foam intensity from vertex data
                    let foam = foamSample * foamMask;
                    finalColor = mix(finalColor, material.foamColor, foam);
                }
                
                // Apply transparency
                let alpha = material.transparency + fresnel * (1.0 - material.transparency);
                
                return vec4<f32>(finalColor, alpha);
            }
            
            fn calculateWaveOffset(pos: vec2<f32>, time: f32) -> f32 {
                // Multiple wave components for realistic water motion
                let wave1 = sin(dot(pos, vec2<f32>(0.7, 0.3)) * 0.02 + time * 2.0) * 0.8;
                let wave2 = sin(dot(pos, vec2<f32>(-0.5, 0.8)) * 0.025 + time * 1.7) * 0.5;
                let wave3 = sin(dot(pos, vec2<f32>(0.2, -0.9)) * 0.03 + time * 2.3) * 0.3;
                let wave4 = sin(dot(pos, vec2<f32>(-0.8, -0.2)) * 0.015 + time * 1.2) * 0.4;
                return (wave1 + wave2 + wave3 + wave4) * globals.waveAmplitude;
            }
            
            fn calculateWaveNormal(pos: vec2<f32>, time: f32) -> vec3<f32> {
                let epsilon = 2.0;
                let heightL = calculateWaveOffset(pos - vec2<f32>(epsilon, 0.0), time);
                let heightR = calculateWaveOffset(pos + vec2<f32>(epsilon, 0.0), time);
                let heightD = calculateWaveOffset(pos - vec2<f32>(0.0, epsilon), time);
                let heightU = calculateWaveOffset(pos + vec2<f32>(0.0, epsilon), time);
                
                let normal = vec3<f32>(
                    (heightL - heightR) / (2.0 * epsilon),
                    1.0,
                    (heightD - heightU) / (2.0 * epsilon)
                );
                
                return normalize(normal);
            }
        `;
    }

    /**
     * Update material uniform buffer
     */
    private updateMaterialUniforms(): void {
        const materialData = new Float32Array(32); // 128 bytes / 4 = 32 floats

        materialData.set([
            this.material.albedo.x,
            this.material.albedo.y,
            this.material.albedo.z,
            this.material.roughness,
            this.material.transparency,
            this.material.refractionIndex,
            this.config.fresnelPower,
            this.config.normalMapScale,
            this.material.foamColor.x,
            this.material.foamColor.y,
            this.material.foamColor.z,
            0,
            this.material.deepWaterColor.x,
            this.material.deepWaterColor.y,
            this.material.deepWaterColor.z,
            0,
            this.material.shallowWaterColor.x,
            this.material.shallowWaterColor.y,
            this.material.shallowWaterColor.z,
            0,
        ]);

        this.device.queue.writeBuffer(this.materialUniformBuffer, 0, materialData);
    }

    /**
     * Create water mesh from render data
     */
    public createWaterMesh(
        surface: WaterSurface,
        renderData: WaterRenderData
    ): WaterMeshData | null {
        // Create interleaved vertex buffer
        const vertexData = new Float32Array(renderData.vertexCount * 12); // 12 floats per vertex
        let offset = 0;

        for (let i = 0; i < renderData.vertexCount; i++) {
            // Position
            vertexData[offset++] = renderData.vertices[i * 3];
            vertexData[offset++] = renderData.vertices[i * 3 + 1];
            vertexData[offset++] = renderData.vertices[i * 3 + 2];

            // Normal
            vertexData[offset++] = renderData.normals[i * 3];
            vertexData[offset++] = renderData.normals[i * 3 + 1];
            vertexData[offset++] = renderData.normals[i * 3 + 2];

            // UV
            vertexData[offset++] = renderData.uvs[i * 2];
            vertexData[offset++] = renderData.uvs[i * 2 + 1];

            // Wave data
            vertexData[offset++] = renderData.waveData[i * 4];
            vertexData[offset++] = renderData.waveData[i * 4 + 1];
            vertexData[offset++] = renderData.waveData[i * 4 + 2];
            vertexData[offset++] = renderData.waveData[i * 4 + 3];
        }

        const vertexBuffer = this.device.createBuffer({
            label: `Water Vertex Buffer ${surface.id}`,
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: `Water Index Buffer ${surface.id}`,
            size: renderData.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(indexBuffer, 0, renderData.indices);

        // Create uniform buffer for this water mesh
        const uniformBuffer = this.device.createBuffer({
            label: `Water Uniform Buffer ${surface.id}`,
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            label: `Water Bind Group ${surface.id}`,
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.globalUniformBuffer } },
                { binding: 1, resource: { buffer: this.materialUniformBuffer } },
                {
                    binding: 2,
                    resource:
                        this.reflectionTexture?.createView() ||
                        this.createDummyTexture().createView(),
                },
                {
                    binding: 3,
                    resource:
                        this.refractionTexture?.createView() ||
                        this.createDummyTexture().createView(),
                },
                { binding: 4, resource: this.normalMapTexture!.createView() },
                { binding: 5, resource: this.foamTexture!.createView() },
                { binding: 6, resource: this.linearSampler },
            ],
        });

        const meshData: WaterMeshData = {
            vertexBuffer,
            indexBuffer,
            indexCount: renderData.indices.length,
            bindGroup,
            uniformBuffer,
            surface,
        };

        this.meshCache.set(surface.id, meshData);
        return meshData;
    }

    /**
     * Create dummy texture for missing reflection/refraction
     */
    private createDummyTexture(): GPUTexture {
        return this.device.createTexture({
            label: 'Dummy Texture',
            size: [1, 1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
    }

    /**
     * Update reflection texture
     */
    public updateReflection(
        commandEncoder: GPUCommandEncoder,
        camera: Camera,
        renderCallback: (camera: Camera, renderPass: GPURenderPassEncoder) => void
    ): void {
        if (!this.config.reflection.enabled || !this.reflectionTexture || !this.reflectionCamera) {
            return;
        }

        const now = performance.now();
        const updateInterval = 1000 / this.config.reflection.updateFrequency;

        if (now - this.lastReflectionUpdate < updateInterval) {
            return;
        }

        // Set up reflection camera (mirror across water plane)
        const waterPlane = new Vector3(0, 1, 0); // Water plane normal
        const waterHeight = 0; // Sea level

        const cameraPos = camera.getPosition();
        const reflectedCameraPos = cameraPos.clone();
        reflectedCameraPos.y = 2 * waterHeight - cameraPos.y;

        this.reflectionCamera.setPosition(reflectedCameraPos);
        this.reflectionCamera.setRotation(camera.getRotation());
        // Flip pitch for reflection
        const rotation = this.reflectionCamera.getRotation();
        rotation.x = -rotation.x;
        this.reflectionCamera.setRotation(rotation);

        // Render reflection
        const renderPass = commandEncoder.beginRenderPass({
            label: 'Water Reflection Pass',
            colorAttachments: [
                {
                    view: this.reflectionTexture.createView(),
                    clearValue: { r: 0.5, g: 0.7, b: 1.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: this.reflectionDepthTexture!.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        renderCallback(this.reflectionCamera, renderPass);
        renderPass.end();

        this.lastReflectionUpdate = now;
        this.stats.reflectionUpdates++;
    }

    /**
     * Render water surfaces
     */
    public render(
        renderPass: GPURenderPassEncoder,
        camera: Camera,
        visibleSurfaces: WaterSurface[],
        time: number
    ): void {
        if (!this.pipeline) {
            console.warn('WaterRenderer: No pipeline available for rendering');
            return;
        }

        // Debug logging every 60 frames
        if (Math.floor(time * 60) % 60 === 0) {
            console.log('WaterRenderer: Rendering', visibleSurfaces.length, 'water surfaces');
        }

        const startTime = performance.now();
        renderPass.setPipeline(this.pipeline);

        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix();
        const cameraPosition = camera.getPosition();

        this.stats.surfacesRendered = 0;
        this.stats.verticesRendered = 0;

        for (const surface of visibleSurfaces) {
            const renderData = this.waterSystem.getWaterRenderData(surface.id);
            if (!renderData) {
                console.warn('WaterRenderer: No render data for surface', surface.id);
                continue;
            }

            let meshData = this.meshCache.get(surface.id);
            if (!meshData) {
                console.log('WaterRenderer: Creating mesh for water surface', surface.id);
                meshData = this.createWaterMesh(surface, renderData);
                if (!meshData) {
                    console.error('WaterRenderer: Failed to create mesh for surface', surface.id);
                    continue;
                }
            }

            // Update global uniforms
            const modelMatrix = new Matrix4().makeTranslation(0, 0, 0); // Water at origin
            const mvpMatrix = new Matrix4()
                .multiplyMatrices(projectionMatrix, viewMatrix)
                .multiply(modelMatrix);

            const globalData = new Float32Array(64); // 256 bytes / 4 = 64 floats
            globalData.set(mvpMatrix.elements, 0);
            globalData.set(viewMatrix.elements, 16);
            globalData.set(projectionMatrix.elements, 32);
            globalData.set([cameraPosition.x, cameraPosition.y, cameraPosition.z], 48);
            globalData[51] = time;
            globalData.set(
                [surface.windDirection.x, surface.windDirection.y, surface.windDirection.z],
                52
            );
            globalData[55] = surface.waveHeight;
            globalData[56] = 0.5; // Wave frequency
            globalData[57] = this.config.waveSpeed; // Wave speed

            this.device.queue.writeBuffer(this.globalUniformBuffer, 0, globalData);

            // Render water mesh
            renderPass.setBindGroup(0, meshData.bindGroup);
            renderPass.setVertexBuffer(0, meshData.vertexBuffer);
            renderPass.setIndexBuffer(meshData.indexBuffer, 'uint32');
            renderPass.drawIndexed(meshData.indexCount);

            this.stats.surfacesRendered++;
            this.stats.verticesRendered += renderData.vertexCount;
        }

        this.stats.renderTime = performance.now() - startTime;
    }

    /**
     * Get water rendering statistics
     */
    public getStats(): WaterRenderStats {
        return { ...this.stats };
    }

    /**
     * Get water rendering configuration
     */
    public getConfig(): WaterRenderConfig {
        return { ...this.config };
    }

    /**
     * Update water material properties
     */
    public updateMaterial(material: Partial<WaterMaterial>): void {
        Object.assign(this.material, material);
        this.updateMaterialUniforms();
    }

    /**
     * Clear water mesh cache
     */
    public clearCache(): void {
        for (const meshData of this.meshCache.values()) {
            meshData.vertexBuffer.destroy();
            meshData.indexBuffer.destroy();
            meshData.uniformBuffer.destroy();
        }
        this.meshCache.clear();
    }

    /**
     * Destroy water renderer resources
     */
    public destroy(): void {
        this.clearCache();

        this.globalUniformBuffer.destroy();
        this.materialUniformBuffer.destroy();

        this.reflectionTexture?.destroy();
        this.reflectionDepthTexture?.destroy();
        this.refractionTexture?.destroy();
        this.refractionDepthTexture?.destroy();
        this.normalMapTexture?.destroy();
        this.foamTexture?.destroy();
    }
}
