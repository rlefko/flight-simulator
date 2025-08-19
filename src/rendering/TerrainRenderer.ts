import { TerrainTile } from '../world/TerrainTile';
import { Camera } from './Camera';
import { Vector3, Matrix4 } from '../core/math';
import { ShadowSystem } from './ShadowSystem';

interface TerrainMeshData {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    bindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer; // Each mesh needs its own uniform buffer
}

interface AtmosphericParams {
    sunDirection: Vector3;
    sunIntensity: number;
    timeOfDay: number; // 0.0 = midnight, 0.5 = noon, 1.0 = midnight
    fogDensity: number;
    fogHeightFalloff: number;
    mieG: number; // Mie scattering asymmetry parameter
    exposure: number;
    rayleighStrength: number;
    mieStrength: number;
}

export class TerrainRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private shadowPipeline: GPURenderPipeline | null = null;
    private meshCache: Map<string, TerrainMeshData> = new Map();
    private uniformBuffer: GPUBuffer;
    private atmosphericBuffer: GPUBuffer;
    private uniformBindGroupLayout: GPUBindGroupLayout;
    private shadowBindGroupLayout: GPUBindGroupLayout | null = null;
    private shadowBindGroup: GPUBindGroup | null = null;
    private pipelineLayout: GPUPipelineLayout;
    private sampleCount: number = 4;
    private atmosphericParams: AtmosphericParams = {
        sunDirection: new Vector3(0.5, 0.5, 0.5).normalize(),
        sunIntensity: 20.0,
        timeOfDay: 0.5, // Noon
        fogDensity: 0.000008,
        fogHeightFalloff: 0.0001,
        mieG: 0.8,
        exposure: 1.0,
        rayleighStrength: 1.0,
        mieStrength: 1.0,
    };

    constructor(device: GPUDevice) {
        this.device = device;

        // Create bind group layout for terrain uniforms (group 0)
        this.uniformBindGroupLayout = device.createBindGroupLayout({
            label: 'Terrain Uniform Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create bind group layout for shadow resources (group 3)
        this.shadowBindGroupLayout = device.createBindGroupLayout({
            label: 'Shadow Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'comparison' },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create pipeline layout with all bind group layouts
        // Note: We need placeholders for groups 1 and 2 to use group 3 for shadows
        const emptyBindGroupLayout = device.createBindGroupLayout({
            label: 'Empty Bind Group Layout',
            entries: [],
        });

        this.pipelineLayout = device.createPipelineLayout({
            label: 'Terrain Pipeline Layout',
            bindGroupLayouts: [
                this.uniformBindGroupLayout, // Group 0: uniforms
                emptyBindGroupLayout, // Group 1: unused (placeholder)
                emptyBindGroupLayout, // Group 2: unused (placeholder)
                this.shadowBindGroupLayout, // Group 3: shadows
            ],
        });

        // Create uniform buffer for matrices and environmental parameters
        // MVP (64) + Model (64) + Normal (64) + Camera pos (12) + time (4) + seasonal params (12) = 220 bytes
        // Round up to 256 for alignment
        this.uniformBuffer = device.createBuffer({
            label: 'Terrain Uniform Buffer',
            size: 256, // MVP + Model + Normal matrices + camera position + time + environmental
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create atmospheric parameters buffer
        // Sun direction (12) + sun intensity (4) + time of day (4) + fog density (4) + fog height falloff (4) +
        // mie G (4) + exposure (4) + rayleigh strength (4) + mie strength (4) + padding = 48 bytes
        // Round up to 64 for alignment
        this.atmosphericBuffer = device.createBuffer({
            label: 'Atmospheric Parameters Buffer',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.createPipeline();
        this.createShadowPipeline();
    }

    /**
     * Update sample count for MSAA
     */
    public setSampleCount(sampleCount: number): void {
        if (this.sampleCount !== sampleCount) {
            this.sampleCount = sampleCount;
            // Recreate pipelines with new sample count
            this.createPipeline();
            this.createShadowPipeline();
        }
    }

    /**
     * Update atmospheric parameters
     */
    public updateAtmosphericParams(params: Partial<AtmosphericParams>): void {
        Object.assign(this.atmosphericParams, params);
        this.updateAtmosphericBuffer();
    }

    /**
     * Set time of day (0.0 = midnight, 0.5 = noon, 1.0 = midnight)
     */
    public setTimeOfDay(timeOfDay: number): void {
        this.atmosphericParams.timeOfDay = timeOfDay;

        // Calculate sun position based on time of day
        const sunAngle = (timeOfDay - 0.5) * 2.0 * Math.PI;
        const sunHeight = Math.sin(sunAngle);
        const sunAzimuth = Math.cos(sunAngle);

        this.atmosphericParams.sunDirection = new Vector3(sunAzimuth, sunHeight, 0.0).normalize();

        // Adjust sun intensity based on height
        const heightFactor = Math.max(0.0, sunHeight);
        this.atmosphericParams.sunIntensity = 20.0 * (heightFactor * 0.8 + 0.2);

        this.updateAtmosphericBuffer();
    }

    /**
     * Update atmospheric uniform buffer
     */
    private updateAtmosphericBuffer(): void {
        const params = this.atmosphericParams;
        const data = new Float32Array(16); // 64 bytes / 4 = 16 floats

        // Sun direction (3 floats)
        data[0] = params.sunDirection.x;
        data[1] = params.sunDirection.y;
        data[2] = params.sunDirection.z;

        // Sun intensity (1 float)
        data[3] = params.sunIntensity;

        // Time of day (1 float)
        data[4] = params.timeOfDay;

        // Fog density (1 float)
        data[5] = params.fogDensity;

        // Fog height falloff (1 float)
        data[6] = params.fogHeightFalloff;

        // Mie G parameter (1 float)
        data[7] = params.mieG;

        // Exposure (1 float)
        data[8] = params.exposure;

        // Rayleigh strength (1 float)
        data[9] = params.rayleighStrength;

        // Mie strength (1 float)
        data[10] = params.mieStrength;

        // Padding for alignment
        data[11] = 0.0;
        data[12] = 0.0;
        data[13] = 0.0;
        data[14] = 0.0;
        data[15] = 0.0;

        this.device.queue.writeBuffer(this.atmosphericBuffer, 0, data);
    }

    private createShadowPipeline(): void {
        // Create a simplified shader for shadow depth rendering
        const shadowShaderModule = this.device.createShaderModule({
            label: 'Terrain Shadow Shader Module',
            code: `
                struct Uniforms {
                    mvpMatrix: mat4x4<f32>,
                    modelMatrix: mat4x4<f32>,
                    normalMatrix: mat4x4<f32>,
                    cameraPosition: vec3<f32>,
                    time: f32,
                };
                
                @group(0) @binding(0) var<uniform> uniforms: Uniforms;
                
                struct VertexInput {
                    @location(0) position: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                    @location(2) uv: vec2<f32>,
                };
                
                @vertex
                fn vs_shadow(input: VertexInput) -> @builtin(position) vec4<f32> {
                    return uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                }
                
                // No fragment shader needed for depth-only rendering
            `,
        });

        // Create a separate pipeline layout for shadow pass (only needs uniform bind group)
        const shadowPipelineLayout = this.device.createPipelineLayout({
            label: 'Shadow Pipeline Layout',
            bindGroupLayouts: [this.uniformBindGroupLayout], // Only group 0
        });

        this.shadowPipeline = this.device.createRenderPipeline({
            label: 'Terrain Shadow Pipeline',
            layout: shadowPipelineLayout,
            vertex: {
                module: shadowShaderModule,
                entryPoint: 'vs_shadow',
                buffers: [
                    {
                        arrayStride: 36, // 3 floats position + 3 floats normal + 2 floats uv + 1 float material
                        attributes: [
                            {
                                format: 'float32x3',
                                offset: 0,
                                shaderLocation: 0, // position
                            },
                            {
                                format: 'float32x3',
                                offset: 12,
                                shaderLocation: 1, // normal
                            },
                            {
                                format: 'float32x2',
                                offset: 24,
                                shaderLocation: 2, // uv
                            },
                            {
                                format: 'float32',
                                offset: 32,
                                shaderLocation: 3, // materialId
                            },
                        ],
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth32float', // Match shadow map format
            },
            // No fragment stage for shadow depth rendering
        });
    }

    private createPipeline(): void {
        const shaderModule = this.device.createShaderModule({
            label: 'Terrain Shader Module',
            code: this.getTerrainShaderCode(),
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'Terrain Render Pipeline',
            layout: this.pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_terrain',
                buffers: [
                    {
                        arrayStride: 36, // 3 floats position + 3 floats normal + 2 floats uv + 1 float material
                        attributes: [
                            {
                                format: 'float32x3',
                                offset: 0,
                                shaderLocation: 0, // position
                            },
                            {
                                format: 'float32x3',
                                offset: 12,
                                shaderLocation: 1, // normal
                            },
                            {
                                format: 'float32x2',
                                offset: 24,
                                shaderLocation: 2, // uv
                            },
                            {
                                format: 'float32',
                                offset: 32,
                                shaderLocation: 3, // materialId
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_terrain',
                targets: [
                    {
                        format: navigator.gpu.getPreferredCanvasFormat(),
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
            multisample: {
                count: this.sampleCount, // Match MSAA sample count
            },
        });
    }

    /**
     * Get terrain shader code with shadow support
     */
    private getTerrainShaderCode(): string {
        return `
            struct Uniforms {
                mvpMatrix: mat4x4<f32>,
                modelMatrix: mat4x4<f32>,
                normalMatrix: mat4x4<f32>,
                cameraPosition: vec3<f32>,
                time: f32,
                seasonFactor: f32,    // 0.0 = spring, 0.25 = summer, 0.5 = autumn, 0.75 = winter, 1.0 = spring
                temperatureFactor: f32, // -1.0 = cold, 0.0 = temperate, 1.0 = hot
                precipitationFactor: f32, // 0.0 = dry, 1.0 = wet
            };
            
            struct AtmosphericUniforms {
                sunDirection: vec3<f32>,
                sunIntensity: f32,
                timeOfDay: f32,
                fogDensity: f32,
                fogHeightFalloff: f32,
                mieG: f32,
                exposure: f32,
                rayleighStrength: f32,
                mieStrength: f32,
            };
            
            struct ShadowUniforms {
                lightMatrix0: mat4x4<f32>,
                lightMatrix1: mat4x4<f32>,
                lightMatrix2: mat4x4<f32>,
                lightMatrix3: mat4x4<f32>,
                cascadeDistances: vec4<f32>,
                lightDirection: vec3<f32>,
                shadowBias: f32,
                lightColor: vec3<f32>,
                lightIntensity: f32,
            };
            
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<uniform> atmosphere: AtmosphericUniforms;
            
            // Shadow resources in separate bind group to avoid conflicts
            @group(3) @binding(0) var shadowMap0: texture_depth_2d;
            @group(3) @binding(1) var shadowMap1: texture_depth_2d;
            @group(3) @binding(2) var shadowMap2: texture_depth_2d;
            @group(3) @binding(3) var shadowMap3: texture_depth_2d;
            @group(3) @binding(4) var shadowSampler: sampler_comparison;
            @group(3) @binding(5) var<uniform> shadowUniforms: ShadowUniforms;
            
            // Enhanced noise functions for photorealistic terrain textures
            fn hash3(p: vec3<f32>) -> vec3<f32> {
                var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.xxy + p3.yzz) * p3.zyx);
            }
            
            // Enhanced hash function for better random distribution
            fn hash13(p3: vec3<f32>) -> f32 {
                let p = fract(p3 * 0.1031);
                let dotProduct = dot(p, p.zyx + 31.32);
                return fract((p.x + p.y) * dotProduct);
            }
            
            // Improved 3D noise with better interpolation
            fn noise3D(p: vec3<f32>) -> f32 {
                let i = floor(p);
                let f = fract(p);
                
                // Use quintic interpolation for smoother results
                let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
                
                return mix(
                    mix(
                        mix(hash13(i + vec3<f32>(0.0, 0.0, 0.0)),
                            hash13(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
                        mix(hash13(i + vec3<f32>(0.0, 1.0, 0.0)),
                            hash13(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
                    mix(
                        mix(hash13(i + vec3<f32>(0.0, 0.0, 1.0)),
                            hash13(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
                        mix(hash13(i + vec3<f32>(0.0, 1.0, 1.0)),
                            hash13(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z) * 2.0 - 1.0;
            }
            
            // Multi-octave fractal noise with configurable persistence
            fn fbm(p: vec3<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
                var value = 0.0;
                var amplitude = 1.0;
                var frequency = 1.0;
                var maxValue = 0.0;
                
                for (var i = 0; i < octaves; i++) {
                    value += noise3D(p * frequency) * amplitude;
                    maxValue += amplitude;
                    amplitude *= persistence;
                    frequency *= lacunarity;
                }
                
                return value / maxValue;
            }
            
            // Domain warping for more organic texture patterns
            fn domainWarp(p: vec3<f32>, strength: f32) -> vec3<f32> {
                return p + vec3<f32>(
                    fbm(p + vec3<f32>(0.0, 0.0, 0.0), 4, 0.5, 2.0),
                    fbm(p + vec3<f32>(5.2, 1.3, 0.0), 4, 0.5, 2.0),
                    fbm(p + vec3<f32>(0.0, 5.2, 1.3), 4, 0.5, 2.0)
                ) * strength;
            }
            
            // Enhanced triplanar mapping with proper blending to eliminate plaid patterns
            fn triplanarNoise(worldPos: vec3<f32>, normal: vec3<f32>, scale: f32, octaves: i32) -> f32 {
                // Apply domain warping for more organic patterns
                let warpedPos = domainWarp(worldPos * 0.01, 8.0);
                
                // Calculate triplanar weights with power to reduce blending artifacts
                let weights = pow(abs(normal), vec3<f32>(8.0));
                let weightSum = weights.x + weights.y + weights.z;
                let normalizedWeights = weights / max(weightSum, 0.001);
                
                // Sample noise from three orthogonal planes with slight offsets to break patterns
                let noiseX = fbm((warpedPos + worldPos).yzx * scale, octaves, 0.6, 2.1);
                let noiseY = fbm((warpedPos + worldPos).zxy * scale, octaves, 0.6, 2.1);
                let noiseZ = fbm((warpedPos + worldPos).xyz * scale, octaves, 0.6, 2.1);
                
                // Blend with normalized weights
                return noiseX * normalizedWeights.x + noiseY * normalizedWeights.y + noiseZ * normalizedWeights.z;
            }
            
            // Enhanced triplanar normal mapping
            fn triplanarNormal(worldPos: vec3<f32>, normal: vec3<f32>, scale: f32, strength: f32) -> vec3<f32> {
                let eps = 0.01;
                
                // Calculate triplanar weights
                let weights = pow(abs(normal), vec3<f32>(8.0));
                let weightSum = weights.x + weights.y + weights.z;
                let normalizedWeights = weights / max(weightSum, 0.001);
                
                // Calculate gradients for each plane
                var normalX = vec3<f32>(0.0);
                var normalY = vec3<f32>(0.0);
                var normalZ = vec3<f32>(0.0);
                
                if (normalizedWeights.x > 0.001) {
                    let h1 = triplanarNoise(worldPos + vec3<f32>(0.0, eps, 0.0), normal, scale, 3);
                    let h2 = triplanarNoise(worldPos - vec3<f32>(0.0, eps, 0.0), normal, scale, 3);
                    let h3 = triplanarNoise(worldPos + vec3<f32>(0.0, 0.0, eps), normal, scale, 3);
                    let h4 = triplanarNoise(worldPos - vec3<f32>(0.0, 0.0, eps), normal, scale, 3);
                    normalX = vec3<f32>(0.0, (h1 - h2) / (2.0 * eps), (h3 - h4) / (2.0 * eps)) * strength;
                }
                
                if (normalizedWeights.y > 0.001) {
                    let h1 = triplanarNoise(worldPos + vec3<f32>(eps, 0.0, 0.0), normal, scale, 3);
                    let h2 = triplanarNoise(worldPos - vec3<f32>(eps, 0.0, 0.0), normal, scale, 3);
                    let h3 = triplanarNoise(worldPos + vec3<f32>(0.0, 0.0, eps), normal, scale, 3);
                    let h4 = triplanarNoise(worldPos - vec3<f32>(0.0, 0.0, eps), normal, scale, 3);
                    normalY = vec3<f32>((h1 - h2) / (2.0 * eps), 0.0, (h3 - h4) / (2.0 * eps)) * strength;
                }
                
                if (normalizedWeights.z > 0.001) {
                    let h1 = triplanarNoise(worldPos + vec3<f32>(eps, 0.0, 0.0), normal, scale, 3);
                    let h2 = triplanarNoise(worldPos - vec3<f32>(eps, 0.0, 0.0), normal, scale, 3);
                    let h3 = triplanarNoise(worldPos + vec3<f32>(0.0, eps, 0.0), normal, scale, 3);
                    let h4 = triplanarNoise(worldPos - vec3<f32>(0.0, eps, 0.0), normal, scale, 3);
                    normalZ = vec3<f32>((h1 - h2) / (2.0 * eps), (h3 - h4) / (2.0 * eps), 0.0) * strength;
                }
                
                let perturbedNormal = normalX * normalizedWeights.x + normalY * normalizedWeights.y + normalZ * normalizedWeights.z;
                return normalize(normal + perturbedNormal);
            }
            
            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) materialId: f32,
            };
            
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) height: f32,
                @location(4) viewDepth: f32,
                @location(5) materialId: f32,
            };
            
            @vertex
            fn vs_terrain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                
                let worldPos = (uniforms.modelMatrix * vec4<f32>(input.position, 1.0)).xyz;
                let clipPos = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                
                output.position = clipPos;
                output.worldPos = worldPos;
                output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                output.uv = input.uv;
                output.height = input.position.y;
                output.viewDepth = clipPos.z / clipPos.w;
                output.materialId = input.materialId;
                
                return output;
            }
            
            fn getShadowCascadeIndex(viewDepth: f32) -> i32 {
                if (viewDepth < shadowUniforms.cascadeDistances.x) {
                    return 0;
                } else if (viewDepth < shadowUniforms.cascadeDistances.y) {
                    return 1;
                } else if (viewDepth < shadowUniforms.cascadeDistances.z) {
                    return 2;
                } else if (viewDepth < shadowUniforms.cascadeDistances.w) {
                    return 3;
                }
                return -1;
            }
            
            fn getLightMatrix(cascadeIndex: i32) -> mat4x4<f32> {
                switch (cascadeIndex) {
                    case 0: { return shadowUniforms.lightMatrix0; }
                    case 1: { return shadowUniforms.lightMatrix1; }
                    case 2: { return shadowUniforms.lightMatrix2; }
                    case 3: { return shadowUniforms.lightMatrix3; }
                    default: { return shadowUniforms.lightMatrix0; }
                }
            }
            
            fn getCascadeWeights(cascadeIndex: i32) -> vec4<f32> {
                if (cascadeIndex == 0) { return vec4<f32>(1.0, 0.0, 0.0, 0.0); }
                if (cascadeIndex == 1) { return vec4<f32>(0.0, 1.0, 0.0, 0.0); }
                if (cascadeIndex == 2) { return vec4<f32>(0.0, 0.0, 1.0, 0.0); }
                if (cascadeIndex == 3) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
                return vec4<f32>(0.0, 0.0, 0.0, 0.0);
            }
            
            fn sampleShadowMap(cascadeIndex: i32, lightSpacePos: vec3<f32>) -> f32 {
                // Sample all shadow maps to maintain uniform control flow
                let shadow0 = textureSampleCompare(shadowMap0, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
                let shadow1 = textureSampleCompare(shadowMap1, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
                let shadow2 = textureSampleCompare(shadowMap2, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
                let shadow3 = textureSampleCompare(shadowMap3, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
                
                // Use weights to select the appropriate cascade
                let weights = getCascadeWeights(cascadeIndex);
                return shadow0 * weights.x + shadow1 * weights.y + shadow2 * weights.z + shadow3 * weights.w;
            }
            
            fn calculateShadowPCF(cascadeIndex: i32, lightSpacePos: vec3<f32>) -> f32 {
                let texelSize = 1.0 / 2048.0;
                var shadowSum = 0.0;
                var sampleCount = 0.0;
                
                for (var x = -1; x <= 1; x++) {
                    for (var y = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        let samplePos = vec3<f32>(lightSpacePos.xy + offset, lightSpacePos.z);
                        shadowSum += sampleShadowMap(cascadeIndex, samplePos);
                        sampleCount += 1.0;
                    }
                }
                
                return shadowSum / sampleCount;
            }
            
            // Structure for PBR material properties
            struct MaterialPBR {
                albedo: vec3<f32>,
                roughness: f32,
                metalness: f32,
                normal: vec3<f32>,
                ao: f32,
            };
            
            // Get material properties for a specific material ID
            fn getSingleMaterialPBR(materialId: i32, elevation: f32, worldPos: vec3<f32>, time: f32, normal: vec3<f32>, detailScale: f32) -> MaterialPBR {
                var material: MaterialPBR;
                
                // Calculate enhanced surface normal with detail
                let enhancedNormal = triplanarNormal(worldPos, normal, detailScale * 2.0, 0.3);
                material.normal = enhancedNormal;
                
                // Material-specific properties
                switch (materialId) {
                    case 0: { // Ocean
                        material.albedo = getOceanTexture(worldPos, time, normal);
                        material.roughness = 0.05;
                        material.metalness = 0.0;
                        material.ao = 1.0;
                    }
                    case 1: { // Beach/Sand
                        material.albedo = getBeachTexture(worldPos, normal, detailScale);
                        material.roughness = 0.8;
                        material.metalness = 0.0;
                        material.ao = getSandAO(worldPos, normal);
                    }
                    case 2: { // Grassland
                        material.albedo = getGrasslandTexturePBR(worldPos, time, normal, detailScale);
                        material.roughness = 0.9;
                        material.metalness = 0.0;
                        material.ao = getGrassAO(worldPos, normal);
                    }
                    case 3: { // Forest
                        material.albedo = getForestFloorTexturePBR(worldPos, elevation, normal, detailScale);
                        material.roughness = 0.8;
                        material.metalness = 0.0;
                        material.ao = getForestAO(worldPos, normal);
                    }
                    case 4: { // Desert
                        material.albedo = getDesertTexturePBR(worldPos, normal, detailScale);
                        material.roughness = 0.9;
                        material.metalness = 0.0;
                        material.ao = getDesertAO(worldPos, normal);
                    }
                    case 5: { // Mountain/Rock
                        material.albedo = getMountainTexturePBR(worldPos, elevation, normal, detailScale);
                        material.roughness = 0.7;
                        material.metalness = 0.1;
                        material.ao = getRockAO(worldPos, normal);
                    }
                    case 6: { // Snow
                        material.albedo = getSnowTexturePBR(worldPos, time, normal, detailScale);
                        material.roughness = 0.1;
                        material.metalness = 0.0;
                        material.ao = getSnowAO(worldPos, normal);
                    }
                    case 7: { // Tundra
                        material.albedo = getTundraTexturePBR(worldPos, normal, detailScale);
                        material.roughness = 0.85;
                        material.metalness = 0.0;
                        material.ao = getTundraAO(worldPos, normal);
                    }
                    case 8: { // Wetland
                        material.albedo = getWetlandTexturePBR(worldPos, normal, detailScale);
                        material.roughness = 0.3;
                        material.metalness = 0.0;
                        material.ao = getWetlandAO(worldPos, normal);
                    }
                    case 9: { // Urban
                        material.albedo = vec3<f32>(0.8, 0.8, 0.8);
                        material.roughness = 0.4;
                        material.metalness = 0.1;
                        material.ao = 1.0;
                    }
                    case 10: { // Lake
                        material.albedo = getLakeTexture(worldPos, time, normal);
                        material.roughness = 0.02;
                        material.metalness = 0.0;
                        material.ao = 1.0;
                    }
                    case 11: { // River
                        material.albedo = getRiverTexture(worldPos, time, normal);
                        material.roughness = 0.05;
                        material.metalness = 0.0;
                        material.ao = 1.0;
                    }
                    default: { // Default grassland
                        material.albedo = getGrasslandTexturePBR(worldPos, time, normal, detailScale);
                        material.roughness = 0.9;
                        material.metalness = 0.0;
                        material.ao = getGrassAO(worldPos, normal);
                    }
                }
                
                return material;
            }
            
            // Blend two materials smoothly
            fn blendMaterials(mat1: MaterialPBR, mat2: MaterialPBR, blendFactor: f32) -> MaterialPBR {
                var result: MaterialPBR;
                let factor = clamp(blendFactor, 0.0, 1.0);
                
                result.albedo = mix(mat1.albedo, mat2.albedo, factor);
                result.roughness = mix(mat1.roughness, mat2.roughness, factor);
                result.metalness = mix(mat1.metalness, mat2.metalness, factor);
                result.ao = mix(mat1.ao, mat2.ao, factor);
                result.normal = normalize(mix(mat1.normal, mat2.normal, factor));
                
                return result;
            }
            
            // Enhanced material generation with smooth biome blending
            fn getMaterialPBR(materialId: f32, elevation: f32, worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> MaterialPBR {
                let primaryId = i32(materialId);
                
                // Initialize common values
                let distance = length(uniforms.cameraPosition - worldPos);
                let detailScale = mix(0.1, 0.02, clamp(distance / 1000.0, 0.0, 1.0));
                
                // Get primary material
                var material = getSingleMaterialPBR(primaryId, elevation, worldPos, time, normal, detailScale);
                
                // Generate blending pattern for smooth biome transitions
                let blendScale = 0.0008; // Large scale for biome transitions
                let blendNoise = fbm(worldPos, 4, 0.6, 1.8) * blendScale;
                let blendStrength = 0.15; // How strong the blending effect is
                
                // Determine secondary material based on elevation and environmental factors
                var secondaryId = primaryId;
                var blendWeight = 0.0;
                
                // Elevation-based transitions
                if (elevation > 600.0 && (primaryId == 2 || primaryId == 3)) {
                    // Grassland/Forest to Mountain transition
                    secondaryId = 5;
                    blendWeight = smoothstep(600.0, 1000.0, elevation) * blendStrength;
                } else if (elevation > 1200.0 && primaryId == 5) {
                    // Mountain to Snow transition
                    secondaryId = 6;
                    blendWeight = smoothstep(1200.0, 1600.0, elevation) * blendStrength;
                } else if (elevation < 50.0 && (primaryId == 2 || primaryId == 4)) {
                    // Grassland/Desert to Beach transition
                    secondaryId = 1;
                    blendWeight = smoothstep(50.0, 10.0, elevation) * blendStrength;
                }
                
                // Environmental transitions based on noise
                let environmentalBlend = abs(blendNoise);
                if (environmentalBlend > 0.7) {
                    if (primaryId == 2) {
                        // Grassland can transition to forest or wetland
                        secondaryId = select(3, 8, blendNoise > 0.0);
                        blendWeight = smoothstep(0.7, 0.9, environmentalBlend) * blendStrength * 0.8;
                    } else if (primaryId == 4 && uniforms.precipitationFactor > 0.3) {
                        // Desert can transition to grassland in higher precipitation
                        secondaryId = 2;
                        blendWeight = smoothstep(0.7, 0.9, environmentalBlend) * blendStrength * uniforms.precipitationFactor;
                    }
                }
                
                // Apply blending if we have a secondary material
                if (secondaryId != primaryId && blendWeight > 0.001) {
                    let secondaryMaterial = getSingleMaterialPBR(secondaryId, elevation, worldPos, time, normal, detailScale);
                    
                    // Modulate blend weight with noise for organic transitions
                    let noiseModulation = fbm(worldPos * 0.002, 3, 0.5, 2.0) * 0.5 + 0.5;
                    let finalBlendWeight = blendWeight * noiseModulation;
                    
                    material = blendMaterials(material, secondaryMaterial, finalBlendWeight);
                }
                
                // Apply elevation-based variation
                material = applyElevationEffects(material, elevation, primaryId);
                
                return material;
            }
            
            // Legacy function for compatibility - extracts albedo from PBR material
            fn getBiomeColor(materialId: f32, elevation: f32, worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let material = getMaterialPBR(materialId, elevation, worldPos, time, normal);
                return material.albedo;
            }
            
            // Apply elevation-based effects to materials
            fn applyElevationEffects(material: MaterialPBR, elevation: f32, materialId: i32) -> MaterialPBR {
                var result = material;
                let elevationFactor = clamp(elevation / 1000.0, 0.0, 1.0);
                
                // Grassland and forest get brown tints at higher elevation
                if (materialId == 2 || materialId == 3) {
                    let brownTint = vec3<f32>(0.6, 0.4, 0.2);
                    result.albedo = mix(result.albedo, brownTint, elevationFactor * 0.3);
                    result.roughness = mix(result.roughness, 0.95, elevationFactor * 0.2);
                }
                
                // Mountains get snow caps
                if (materialId == 5 && elevation > 800.0) {
                    let snowColor = vec3<f32>(0.95, 0.95, 1.0);
                    let snowFactor = clamp((elevation - 800.0) / 200.0, 0.0, 1.0);
                    result.albedo = mix(result.albedo, snowColor, snowFactor);
                    result.roughness = mix(result.roughness, 0.1, snowFactor);
                    result.metalness = mix(result.metalness, 0.0, snowFactor);
                }
                
                return result;
            }
            
            // Enhanced PBR grassland texture with micro details
            fn getGrasslandTexturePBR(worldPos: vec3<f32>, time: f32, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                // Multi-scale texture sampling for realistic grass appearance
                let baseScale = detailScale * 0.5;
                let microScale = detailScale * 4.0;
                let macroScale = detailScale * 0.1;
                
                // Natural grass colors - calibrated to real-world values
                let springGreen = vec3<f32>(0.25, 0.5, 0.15);
                let summerGreen = vec3<f32>(0.2, 0.45, 0.12);
                let autumnBrown = vec3<f32>(0.4, 0.32, 0.12);
                let winterBrown = vec3<f32>(0.28, 0.22, 0.12);
                
                let darkSoil = vec3<f32>(0.12, 0.08, 0.04);
                let lightGrass = vec3<f32>(0.3, 0.55, 0.2);
                let dryGrass = vec3<f32>(0.35, 0.28, 0.1);
                
                // Multi-octave noise patterns for organic variation
                let grassDensity = fbm(worldPos, 5, 0.6, 2.1) * baseScale;
                let grassPatches = fbm(worldPos * 0.5, 3, 0.7, 1.8) * baseScale;
                let microDetail = fbm(worldPos, 8, 0.4, 2.5) * microScale;
                let soilExposure = smoothstep(-0.3, 0.1, fbm(worldPos * 0.3, 4, 0.5, 2.0));
                
                // Seasonal color calculation
                let seasonCycle = uniforms.seasonFactor * 4.0;
                var seasonalBase: vec3<f32>;
                
                if (seasonCycle < 1.0) {
                    seasonalBase = mix(winterBrown, springGreen, smoothstep(0.0, 1.0, seasonCycle));
                } else if (seasonCycle < 2.0) {
                    seasonalBase = mix(springGreen, summerGreen, smoothstep(0.0, 1.0, seasonCycle - 1.0));
                } else if (seasonCycle < 3.0) {
                    seasonalBase = mix(summerGreen, autumnBrown, smoothstep(0.0, 1.0, seasonCycle - 2.0));
                } else {
                    seasonalBase = mix(autumnBrown, winterBrown, smoothstep(0.0, 1.0, seasonCycle - 3.0));
                }
                
                // Build complex grass texture
                var grassColor = seasonalBase;
                
                // Add grass density variation
                grassColor = mix(darkSoil, grassColor, clamp(grassDensity * 0.5 + 0.7, 0.0, 1.0));
                
                // Add light and dark grass patches
                grassColor = mix(grassColor, lightGrass, max(0.0, grassPatches) * 0.2);
                grassColor = mix(grassColor, dryGrass, max(0.0, -grassPatches) * 0.15);
                
                // Expose soil in sparse areas
                grassColor = mix(grassColor, darkSoil, soilExposure * 0.3);
                
                // Add micro surface detail
                grassColor += vec3<f32>(microDetail) * 0.05;
                
                // Environmental effects
                let coldEffect = clamp(-uniforms.temperatureFactor, 0.0, 1.0);
                let dryEffect = clamp(1.0 - uniforms.precipitationFactor, 0.0, 1.0);
                
                // Cold reduces saturation and shifts toward brown
                grassColor = mix(grassColor, vec3<f32>(0.35, 0.28, 0.15), coldEffect * 0.4);
                // Dry conditions reduce vibrancy and add yellow tint
                grassColor = mix(grassColor, grassColor * vec3<f32>(1.2, 1.0, 0.7), dryEffect * 0.3);
                grassColor *= mix(1.0, 0.8, dryEffect * 0.5);
                
                return clamp(grassColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            // Ambient occlusion for grass (cavities between grass blades)
            fn getGrassAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoNoise = fbm(worldPos, 4, 0.5, 2.0) * 0.15;
                return clamp(0.7 + aoNoise, 0.3, 1.0);
            }
            
            // Enhanced forest floor texture with detailed organic materials
            fn getForestFloorTexturePBR(worldPos: vec3<f32>, elevation: f32, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let richSoil = vec3<f32>(0.15, 0.1, 0.05);
                let leafLitter = vec3<f32>(0.28, 0.18, 0.08);
                let freshLeaves = vec3<f32>(0.25, 0.15, 0.06);
                let mossGreen = vec3<f32>(0.06, 0.2, 0.08);
                let darkHumus = vec3<f32>(0.08, 0.05, 0.03);
                let rottenWood = vec3<f32>(0.2, 0.12, 0.06);
                
                // Multi-scale organic patterns
                let litterPattern = fbm(worldPos, 6, 0.65, 2.0) * detailScale;
                let mossPattern = fbm(worldPos * 1.3, 5, 0.6, 1.9) * detailScale;
                let soilPattern = fbm(worldPos * 0.7, 4, 0.7, 2.1) * detailScale;
                let decomposition = fbm(worldPos * 2.1, 7, 0.45, 2.3) * detailScale;
                
                // Base forest floor color
                var forestColor = mix(richSoil, leafLitter, clamp(litterPattern * 0.7 + 0.5, 0.0, 1.0));
                
                // Add moss in humid areas
                let mossiness = smoothstep(-0.2, 0.4, mossPattern) * uniforms.precipitationFactor;
                forestColor = mix(forestColor, mossGreen, mossiness * 0.4);
                
                // Add fresh and decomposing leaf patches
                forestColor = mix(forestColor, freshLeaves, max(0.0, litterPattern) * 0.3);
                forestColor = mix(forestColor, darkHumus, smoothstep(0.2, 0.6, decomposition) * 0.2);
                
                // Add rotting wood debris
                let woodDebris = smoothstep(0.6, 0.8, abs(soilPattern));
                forestColor = mix(forestColor, rottenWood, woodDebris * 0.15);
                
                // Dark soil in low areas (better drainage)
                forestColor = mix(forestColor, darkHumus, max(0.0, -soilPattern) * 0.25);
                
                // Seasonal effects
                let autumnFactor = max(0.0, sin(uniforms.seasonFactor * 2.0 * 3.14159));
                let autumnLeaves = vec3<f32>(0.6, 0.3, 0.1);
                forestColor = mix(forestColor, autumnLeaves, autumnFactor * max(0.0, litterPattern) * 0.2);
                
                return clamp(forestColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getForestAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoPattern = fbm(worldPos, 5, 0.6, 2.0) * 0.2;
                return clamp(0.6 + aoPattern, 0.4, 1.0);  // Darker due to canopy shade
            }
            
            // Enhanced desert texture with realistic sand patterns
            fn getDesertTexturePBR(worldPos: vec3<f32>, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let fineSand = vec3<f32>(0.75, 0.65, 0.45);
                let coarseSand = vec3<f32>(0.65, 0.55, 0.35);
                let redSand = vec3<f32>(0.7, 0.45, 0.25);
                let darkSand = vec3<f32>(0.5, 0.4, 0.25);
                let rockDust = vec3<f32>(0.6, 0.5, 0.4);
                
                // Multi-scale sand patterns
                let dunePattern = fbm(worldPos * 0.3, 4, 0.7, 1.8) * detailScale;
                let windRipples = fbm(worldPos * 3.0, 6, 0.4, 2.2) * detailScale;
                let grainDetail = fbm(worldPos, 8, 0.3, 2.5) * detailScale;
                let ironStaining = fbm(worldPos * 0.8, 3, 0.8, 1.7) * detailScale;
                
                // Base sand color with wind patterns
                var sandColor = mix(fineSand, coarseSand, clamp(dunePattern * 0.6 + 0.4, 0.0, 1.0));
                
                // Add wind ripple patterns
                sandColor = mix(sandColor, darkSand, abs(windRipples) * 0.15);
                
                // Iron oxide staining creates red patches
                sandColor = mix(sandColor, redSand, smoothstep(0.3, 0.7, ironStaining) * 0.3);
                
                // Rock dust in exposed areas
                let rockExposure = smoothstep(0.4, 0.8, abs(dunePattern));
                sandColor = mix(sandColor, rockDust, rockExposure * 0.2);
                
                // Fine grain surface detail
                sandColor += vec3<f32>(grainDetail) * 0.03;
                
                // Temperature effects (hotter = more bleached)
                let heatEffect = clamp(uniforms.temperatureFactor, 0.0, 1.0);
                sandColor = mix(sandColor, sandColor * vec3<f32>(1.1, 1.05, 0.95), heatEffect * 0.2);
                
                return clamp(sandColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getDesertAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoNoise = fbm(worldPos, 3, 0.7, 2.0) * 0.1;
                return clamp(0.85 + aoNoise, 0.7, 1.0);  // High AO due to open exposure
            }
            
            // Enhanced mountain rocky texture with geological realism
            fn getMountainTexturePBR(worldPos: vec3<f32>, elevation: f32, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let granite = vec3<f32>(0.6, 0.55, 0.5);
                let basalt = vec3<f32>(0.25, 0.25, 0.3);
                let limestone = vec3<f32>(0.7, 0.65, 0.6);
                let slate = vec3<f32>(0.3, 0.32, 0.35);
                let weatheredRock = vec3<f32>(0.5, 0.45, 0.4);
                let mossyRock = vec3<f32>(0.4, 0.5, 0.35);
                let lichens = vec3<f32>(0.6, 0.6, 0.4);
                
                // Geological stratification patterns
                let stratification = fbm(worldPos * vec3<f32>(0.1, 2.0, 0.1), 5, 0.6, 2.0) * detailScale;
                let weathering = fbm(worldPos, 6, 0.5, 2.1) * detailScale;
                let fractures = fbm(worldPos * 2.0, 7, 0.4, 2.3) * detailScale;
                let alteration = fbm(worldPos * 0.5, 4, 0.7, 1.9) * detailScale;
                
                // Base rock type based on elevation and patterns
                var rockColor: vec3<f32>;
                let elevationFactor = clamp(elevation / 2000.0, 0.0, 1.0);
                
                // Lower elevations: sedimentary rocks
                if (elevationFactor < 0.3) {
                    rockColor = mix(limestone, slate, clamp(stratification * 0.8 + 0.3, 0.0, 1.0));
                }
                // Mid elevations: metamorphic rocks
                else if (elevationFactor < 0.7) {
                    rockColor = mix(slate, granite, clamp(alteration * 0.6 + 0.4, 0.0, 1.0));
                }
                // High elevations: igneous rocks
                else {
                    rockColor = mix(granite, basalt, clamp(fractures * 0.7 + 0.2, 0.0, 1.0));
                }
                
                // Weather-based alterations
                let weatheringIntensity = clamp(weathering * 0.8 + 0.2, 0.0, 1.0);
                rockColor = mix(rockColor, weatheredRock, weatheringIntensity * 0.3);
                
                // Biological growth in humid conditions
                let humidity = uniforms.precipitationFactor;
                let biologicalGrowth = smoothstep(0.2, 0.8, alteration * humidity);
                rockColor = mix(rockColor, mossyRock, biologicalGrowth * 0.2);
                
                // Lichen growth on exposed surfaces
                let lichensGrowth = smoothstep(0.6, 0.9, abs(fractures)) * humidity;
                rockColor = mix(rockColor, lichens, lichensGrowth * 0.15);
                
                // Fracture darkening
                rockColor = mix(rockColor, basalt, smoothstep(0.7, 0.9, abs(fractures)) * 0.2);
                
                return clamp(rockColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getRockAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let creviceNoise = fbm(worldPos, 6, 0.5, 2.2) * 0.25;
                return clamp(0.6 + creviceNoise, 0.3, 1.0);  // Deep crevices create shadows
            }
            
            // Enhanced snow texture with realistic ice crystal patterns
            fn getSnowTexturePBR(worldPos: vec3<f32>, time: f32, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let freshSnow = vec3<f32>(0.95, 0.95, 0.98);
                let oldSnow = vec3<f32>(0.85, 0.87, 0.9);
                let blueSnow = vec3<f32>(0.8, 0.85, 0.92);
                let dirtySonw = vec3<f32>(0.7, 0.72, 0.75);
                let iceyCrust = vec3<f32>(0.9, 0.92, 0.95);
                
                // Snow crystal and density patterns
                let snowDensity = fbm(worldPos, 5, 0.6, 2.0) * detailScale;
                let iceFormation = fbm(worldPos * 1.5, 4, 0.7, 1.9) * detailScale;
                let windPacking = fbm(worldPos * 2.5, 6, 0.4, 2.3) * detailScale;
                let contamination = fbm(worldPos * 0.7, 3, 0.8, 1.8) * detailScale;
                
                // Base snow color with age variation
                var snowColor = mix(freshSnow, oldSnow, clamp(snowDensity * 0.5 + 0.3, 0.0, 1.0));
                
                // Blue tint in shadows and compacted areas
                let shadowTint = smoothstep(-0.2, 0.2, snowDensity);
                snowColor = mix(snowColor, blueSnow, shadowTint * 0.3);
                
                // Ice crust formation in wind-exposed areas
                let iceCrust = smoothstep(0.4, 0.8, abs(windPacking));
                snowColor = mix(snowColor, iceyCrust, iceCrust * 0.4);
                
                // Dirt and debris contamination
                let dirtiness = smoothstep(0.3, 0.7, contamination);
                snowColor = mix(snowColor, dirtySonw, dirtiness * 0.2);
                
                // Micro-surface sparkle (subtle)
                let sparklePattern = fbm(worldPos + vec3<f32>(time * 0.1, 0.0, 0.0), 8, 0.3, 2.7) * detailScale;
                snowColor += vec3<f32>(max(0.0, sparklePattern)) * 0.02;
                
                return clamp(snowColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getSnowAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let driftNoise = fbm(worldPos, 4, 0.6, 2.0) * 0.1;
                return clamp(0.9 + driftNoise, 0.8, 1.0);  // High AO, slight drifting shadows
            }
            
            // Enhanced tundra texture with permafrost characteristics
            fn getTundraTexturePBR(worldPos: vec3<f32>, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let permafrost = vec3<f32>(0.45, 0.5, 0.55);
                let frozenSoil = vec3<f32>(0.4, 0.35, 0.3);
                let deadVegetation = vec3<f32>(0.5, 0.4, 0.25);
                let ice = vec3<f32>(0.7, 0.75, 0.8);
                let organicLayer = vec3<f32>(0.3, 0.25, 0.2);
                
                // Tundra-specific patterns
                let frostHeave = fbm(worldPos * 0.8, 5, 0.6, 2.0) * detailScale;
                let polygonPattern = fbm(worldPos * 0.3, 4, 0.7, 1.8) * detailScale;
                let vegetationSpots = fbm(worldPos * 1.2, 6, 0.5, 2.2) * detailScale;
                let iceContent = fbm(worldPos * 2.0, 7, 0.4, 2.1) * detailScale;
                
                // Base permafrost color
                var tundraColor = mix(permafrost, frozenSoil, clamp(frostHeave * 0.6 + 0.4, 0.0, 1.0));
                
                // Polygon ground patterns (thermal contraction)
                let polygons = smoothstep(0.2, 0.6, abs(polygonPattern));
                tundraColor = mix(tundraColor, organicLayer, polygons * 0.3);
                
                // Sparse dead vegetation
                let vegetation = smoothstep(0.3, 0.7, vegetationSpots);
                tundraColor = mix(tundraColor, deadVegetation, vegetation * 0.4);
                
                // Surface ice patches
                let icePatches = smoothstep(0.6, 0.9, abs(iceContent));
                tundraColor = mix(tundraColor, ice, icePatches * 0.2);
                
                // Cold temperature effects
                let coldEffect = clamp(-uniforms.temperatureFactor, 0.0, 1.0);
                tundraColor = mix(tundraColor, tundraColor * vec3<f32>(0.9, 0.95, 1.1), coldEffect * 0.2);
                
                return clamp(tundraColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getTundraAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoNoise = fbm(worldPos, 4, 0.5, 2.0) * 0.15;
                return clamp(0.75 + aoNoise, 0.6, 1.0);
            }
            
            // Enhanced wetland texture with organic sediment layers
            fn getWetlandTexturePBR(worldPos: vec3<f32>, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let darkMud = vec3<f32>(0.15, 0.12, 0.08);
                let richSilt = vec3<f32>(0.25, 0.2, 0.12);
                let organicSediment = vec3<f32>(0.12, 0.15, 0.08);
                let clayDeposit = vec3<f32>(0.3, 0.25, 0.2);
                let waterSurface = vec3<f32>(0.2, 0.3, 0.4);
                let algaeGrowth = vec3<f32>(0.1, 0.3, 0.15);
                
                // Wetland sedimentation patterns
                let sedimentLayers = fbm(worldPos * vec3<f32>(1.0, 0.2, 1.0), 5, 0.6, 2.0) * detailScale;
                let organicDeposits = fbm(worldPos * 1.3, 6, 0.5, 2.1) * detailScale;
                let waterLevel = fbm(worldPos * 0.5, 3, 0.8, 1.7) * detailScale;
                let biologicalActivity = fbm(worldPos * 2.0, 7, 0.4, 2.2) * detailScale;
                
                // Base mud and silt mixture
                var wetlandColor = mix(darkMud, richSilt, clamp(sedimentLayers * 0.7 + 0.4, 0.0, 1.0));
                
                // Organic matter accumulation
                let organicContent = smoothstep(-0.1, 0.4, organicDeposits);
                wetlandColor = mix(wetlandColor, organicSediment, organicContent * 0.4);
                
                // Clay deposits in calmer areas
                let calmAreas = smoothstep(0.2, 0.6, abs(waterLevel));
                wetlandColor = mix(wetlandColor, clayDeposit, calmAreas * 0.2);
                
                // Water surface reflection in standing water
                let standingWater = smoothstep(0.4, 0.8, waterLevel) * uniforms.precipitationFactor;
                wetlandColor = mix(wetlandColor, waterSurface, standingWater * 0.3);
                
                // Algae and microbial growth
                let algaeGrowth = smoothstep(0.5, 0.8, biologicalActivity) * uniforms.precipitationFactor;
                wetlandColor = mix(wetlandColor, algaeGrowth, algaeGrowth * 0.2);
                
                return clamp(wetlandColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getWetlandAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoNoise = fbm(worldPos, 5, 0.6, 2.0) * 0.2;
                return clamp(0.5 + aoNoise, 0.3, 0.8);  // Lower AO due to water saturation
            }
            
            // Beach/sand texture with realistic coastal characteristics
            fn getBeachTexture(worldPos: vec3<f32>, normal: vec3<f32>, detailScale: f32) -> vec3<f32> {
                let fineSand = vec3<f32>(0.8, 0.7, 0.5);
                let coarseSand = vec3<f32>(0.7, 0.6, 0.4);
                let wetSand = vec3<f32>(0.5, 0.45, 0.35);
                let shells = vec3<f32>(0.9, 0.85, 0.8);
                let seaweed = vec3<f32>(0.3, 0.4, 0.2);
                
                // Beach formation patterns
                let waveAction = fbm(worldPos * vec3<f32>(3.0, 0.1, 1.5), 6, 0.5, 2.1) * detailScale;
                let grainSize = fbm(worldPos, 5, 0.6, 2.0) * detailScale;
                let moisture = fbm(worldPos * 0.8, 4, 0.7, 1.9) * detailScale;
                let debris = fbm(worldPos * 1.5, 7, 0.4, 2.3) * detailScale;
                
                // Base sand composition
                var beachColor = mix(fineSand, coarseSand, clamp(grainSize * 0.6 + 0.4, 0.0, 1.0));
                
                // Wave-sorted sand patterns
                let waveSort = smoothstep(-0.2, 0.4, waveAction);
                beachColor = mix(beachColor, fineSand, waveSort * 0.3);
                
                // Moisture darkening near water
                let wetness = smoothstep(0.2, 0.7, moisture);
                beachColor = mix(beachColor, wetSand, wetness * 0.5);
                
                // Shell fragments and marine debris
                let shellContent = smoothstep(0.6, 0.9, abs(debris));
                beachColor = mix(beachColor, shells, shellContent * 0.15);
                
                // Occasional seaweed deposits
                let seaweedDeposits = smoothstep(0.7, 0.95, debris) * wetness;
                beachColor = mix(beachColor, seaweed, seaweedDeposits * 0.1);
                
                return clamp(beachColor, vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            fn getSandAO(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
                let aoNoise = fbm(worldPos, 3, 0.7, 2.0) * 0.1;
                return clamp(0.85 + aoNoise, 0.7, 1.0);
            }
            
            // Ocean water texture
            fn getOceanTexture(worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let deepWater = vec3<f32>(0.02, 0.2, 0.4);
                let shallowWater = vec3<f32>(0.1, 0.4, 0.6);
                let foam = vec3<f32>(0.8, 0.9, 0.95);
                
                let wavePattern = fbm(worldPos + vec3<f32>(time * 0.5, 0.0, time * 0.3), 4, 0.6, 2.0);
                let foamPattern = smoothstep(0.6, 0.9, abs(wavePattern));
                
                var oceanColor = mix(deepWater, shallowWater, clamp(wavePattern * 0.3 + 0.5, 0.0, 1.0));
                oceanColor = mix(oceanColor, foam, foamPattern * 0.1);
                
                return oceanColor;
            }
            
            // Lake water texture
            fn getLakeTexture(worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let clearWater = vec3<f32>(0.1, 0.3, 0.5);
                let reflection = vec3<f32>(0.4, 0.6, 0.8);
                
                let ripples = fbm(worldPos + vec3<f32>(time * 0.2, 0.0, time * 0.15), 3, 0.5, 2.0);
                return mix(clearWater, reflection, clamp(ripples * 0.2 + 0.3, 0.0, 1.0));
            }
            
            // River water texture
            fn getRiverTexture(worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let flowingWater = vec3<f32>(0.15, 0.35, 0.55);
                let sediment = vec3<f32>(0.3, 0.4, 0.35);
                
                let flowPattern = fbm(worldPos + vec3<f32>(time * 1.0, 0.0, 0.0), 4, 0.6, 2.1);
                let sedimentLoad = smoothstep(0.2, 0.7, abs(flowPattern));
                
                return mix(flowingWater, sediment, sedimentLoad * 0.2);
            }
            
            fn calculateShadow(worldPos: vec3<f32>, normal: vec3<f32>, viewDepth: f32) -> f32 {
                let cascadeIndex = getShadowCascadeIndex(viewDepth);
                
                // Always calculate shadow, but use a mask to disable if outside cascade range
                let validCascade = select(0.0, 1.0, cascadeIndex >= 0);
                
                // Use cascade 0 as fallback when invalid to avoid branching
                let safeCascadeIndex = max(0, cascadeIndex);
                
                let lightMatrix = getLightMatrix(safeCascadeIndex);
                let lightSpacePos4 = lightMatrix * vec4<f32>(worldPos, 1.0);
                var lightSpacePos = lightSpacePos4.xyz / lightSpacePos4.w;
                
                lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
                lightSpacePos.y = lightSpacePos.y * -0.5 + 0.5;
                
                // Check bounds without branching
                let inBounds = select(0.0, 1.0,
                    lightSpacePos.x >= 0.0 && lightSpacePos.x <= 1.0 && 
                    lightSpacePos.y >= 0.0 && lightSpacePos.y <= 1.0 && 
                    lightSpacePos.z >= 0.0 && lightSpacePos.z <= 1.0);
                
                let bias = shadowUniforms.shadowBias * (1.0 + (1.0 - abs(dot(normal, shadowUniforms.lightDirection))));
                lightSpacePos.z -= bias;
                
                let shadow = calculateShadowPCF(safeCascadeIndex, lightSpacePos);
                
                // Return 1.0 (no shadow) if invalid cascade or out of bounds
                return mix(1.0, shadow, validCascade * inBounds);
            }
            
            // Atmospheric scattering functions
            fn rayleighPhase(cosTheta: f32) -> f32 {
                return 3.0 / (16.0 * 3.14159) * (1.0 + cosTheta * cosTheta);
            }
            
            fn miePhase(cosTheta: f32, g: f32) -> f32 {
                let g2 = g * g;
                let cos2 = cosTheta * cosTheta;
                return 3.0 / (8.0 * 3.14159) * ((1.0 - g2) / (2.0 + g2)) * 
                       (1.0 + cos2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
            }
            
            // Calculate atmospheric scattering
            fn calculateAtmosphericScattering(
                worldPos: vec3<f32>,
                cameraPos: vec3<f32>,
                sunDirection: vec3<f32>
            ) -> vec3<f32> {
                let distance = length(worldPos - cameraPos);
                let viewDirection = normalize(worldPos - cameraPos);
                
                // Distance-based scattering
                let scatteringFactor = 1.0 - exp(-distance * 0.000015 * atmosphere.rayleighStrength);
                
                // Calculate phase functions
                let cosTheta = dot(viewDirection, sunDirection);
                let rayleighPhaseValue = rayleighPhase(cosTheta);
                let miePhaseValue = miePhase(cosTheta, atmosphere.mieG);
                
                // Rayleigh scattering (blue sky)
                let rayleighColor = vec3<f32>(0.3, 0.6, 1.0) * rayleighPhaseValue * atmosphere.rayleighStrength;
                
                // Mie scattering (haze and sun glow)
                let mieColor = vec3<f32>(1.0, 0.9, 0.8) * miePhaseValue * atmosphere.mieStrength;
                
                // Sun disk enhancement
                let sunFactor = pow(max(0.0, cosTheta), 16.0);
                let sunColor = vec3<f32>(1.0, 0.9, 0.7) * sunFactor;
                
                // Combine atmospheric effects
                return (rayleighColor + mieColor + sunColor) * scatteringFactor * atmosphere.sunIntensity * 0.15;
            }
            
            // Calculate exponential height fog
            fn calculateHeightFog(worldPos: vec3<f32>, cameraPos: vec3<f32>) -> f32 {
                let distance = length(worldPos - cameraPos);
                let heightDifference = abs(worldPos.y - cameraPos.y);
                
                // Exponential height falloff
                let heightFactor = exp(-heightDifference * atmosphere.fogHeightFalloff);
                
                // Distance-based fog density
                let fogFactor = 1.0 - exp(-distance * atmosphere.fogDensity * heightFactor);
                
                return clamp(fogFactor, 0.0, 0.95);
            }
            
            // Calculate aerial perspective
            fn calculateAerialPerspective(
                originalColor: vec3<f32>,
                worldPos: vec3<f32>,
                cameraPos: vec3<f32>
            ) -> vec3<f32> {
                let distance = length(worldPos - cameraPos);
                
                // Distance-based perspective shifts
                let perspectiveFactor = 1.0 - exp(-distance * 0.00003);
                
                // Blue shift at distance (Rayleigh scattering dominance)
                let blueShift = vec3<f32>(0.7, 0.8, 1.0);
                
                // Contrast reduction at distance
                let contrastReduction = mix(1.0, 0.4, perspectiveFactor);
                
                // Apply aerial perspective
                var aerialColor = mix(originalColor, blueShift, perspectiveFactor * 0.2);
                
                // Reduce contrast
                let luminance = dot(aerialColor, vec3<f32>(0.299, 0.587, 0.114));
                aerialColor = mix(vec3<f32>(luminance), aerialColor, contrastReduction);
                
                return aerialColor;
            }
            
            // Calculate sky ambient lighting based on atmospheric scattering
            fn calculateSkyAmbient(normal: vec3<f32>, sunDirection: vec3<f32>) -> vec3<f32> {
                let skyUp = vec3<f32>(0.0, 1.0, 0.0);
                let skyColor = vec3<f32>(0.4, 0.7, 1.0); // Blue sky
                let groundColor = vec3<f32>(0.2, 0.15, 0.1); // Earth tones
                
                // Hemisphere lighting
                let skyFactor = max(0.0, dot(normal, skyUp));
                let ambientColor = mix(groundColor, skyColor, skyFactor);
                
                // Sun influence on ambient
                let sunInfluence = max(0.0, sunDirection.y) * 0.7 + 0.3;
                
                return ambientColor * sunInfluence * atmosphere.sunIntensity * 0.3;
            }
            
            // Enhanced tone mapping with ACES approximation
            fn toneMapACES(color: vec3<f32>) -> vec3<f32> {
                let exposedColor = color * atmosphere.exposure;
                
                // ACES tone mapping approximation
                let a = 2.51;
                let b = 0.03;
                let c = 2.43;
                let d = 0.59;
                let e = 0.14;
                
                return clamp((exposedColor * (a * exposedColor + b)) / 
                           (exposedColor * (c * exposedColor + d) + e), 
                           vec3<f32>(0.0), vec3<f32>(1.0));
            }
            
            // Enhanced PBR lighting calculation with atmospheric effects
            fn calculatePBRLighting(material: MaterialPBR, worldPos: vec3<f32>, viewDir: vec3<f32>, lightDir: vec3<f32>, shadowFactor: f32) -> vec3<f32> {
                let normal = material.normal;
                let halfwayDir = normalize(lightDir + viewDir);
                
                let NdotL = max(dot(normal, lightDir), 0.0);
                let NdotV = max(dot(normal, viewDir), 0.0);
                let NdotH = max(dot(normal, halfwayDir), 0.0);
                let VdotH = max(dot(viewDir, halfwayDir), 0.0);
                
                // Fresnel calculation
                let F0 = mix(vec3<f32>(0.04), material.albedo, material.metalness);
                let fresnel = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
                
                // Distribution (GGX/Trowbridge-Reitz)
                let alpha = material.roughness * material.roughness;
                let alpha2 = alpha * alpha;
                let denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
                let distribution = alpha2 / (3.14159 * denom * denom);
                
                // Geometry function (Smith's method)
                let k = (material.roughness + 1.0) * (material.roughness + 1.0) / 8.0;
                let G1L = NdotL / (NdotL * (1.0 - k) + k);
                let G1V = NdotV / (NdotV * (1.0 - k) + k);
                let geometry = G1L * G1V;
                
                // BRDF
                let numerator = distribution * geometry * fresnel;
                let denominator = 4.0 * NdotV * NdotL + 0.001;
                let specular = numerator / denominator;
                
                // Energy conservation
                let kS = fresnel;
                let kD = (1.0 - kS) * (1.0 - material.metalness);
                
                let diffuse = kD * material.albedo / 3.14159;
                
                // Enhanced sun lighting based on atmospheric parameters
                let sunColor = vec3<f32>(1.0, 0.95, 0.8);
                
                // Adjust sun color based on time of day
                let sunHeight = atmosphere.sunDirection.y;
                let sunColorModified = mix(
                    vec3<f32>(1.0, 0.4, 0.1), // Sunset/sunrise orange
                    sunColor,                   // Noon white
                    clamp(sunHeight * 2.0, 0.0, 1.0)
                );
                
                let lightColor = sunColorModified * atmosphere.sunIntensity;
                let brdf = (diffuse + specular) * lightColor * NdotL * shadowFactor;
                
                // Sky ambient lighting based on atmospheric scattering
                let ambient = material.albedo * calculateSkyAmbient(normal, atmosphere.sunDirection) * material.ao;
                
                return brdf + ambient;
            }

            @fragment
            fn fs_terrain(input: VertexOutput) -> @location(0) vec4<f32> {
                // Get enhanced PBR material properties
                let material = getMaterialPBR(input.materialId, input.worldPos.y, input.worldPos, uniforms.time, input.normal);
                
                // Calculate view and light directions
                let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
                let lightDir = -shadowUniforms.lightDirection;
                
                // Calculate shadow
                let shadowFactor = calculateShadow(input.worldPos, material.normal, input.viewDepth);
                
                // Calculate enhanced PBR lighting with atmospheric effects
                var finalColor = calculatePBRLighting(material, input.worldPos, viewDir, lightDir, shadowFactor);
                
                // Add slope-based ambient occlusion enhancement
                let slopeFactor = 1.0 - abs(input.normal.y);
                let slopeAO = mix(1.0, 0.8, slopeFactor * 0.5);
                finalColor *= slopeAO;
                
                // Apply atmospheric scattering
                let atmosphericLight = calculateAtmosphericScattering(
                    input.worldPos, uniforms.cameraPosition, atmosphere.sunDirection
                );
                finalColor += atmosphericLight;
                
                // Apply aerial perspective (distance-based color shifts)
                finalColor = calculateAerialPerspective(
                    finalColor, input.worldPos, uniforms.cameraPosition
                );
                
                // Apply exponential height fog
                let fogFactor = calculateHeightFog(input.worldPos, uniforms.cameraPosition);
                
                // Calculate fog color based on atmospheric scattering
                let fogColor = calculateAtmosphericScattering(
                    input.worldPos, uniforms.cameraPosition, atmosphere.sunDirection
                ) * 2.0 + vec3<f32>(0.6, 0.7, 0.9) * atmosphere.sunIntensity * 0.3;
                
                // Blend with fog
                finalColor = mix(finalColor, fogColor, fogFactor);
                
                // Enhanced HDR tone mapping with ACES approximation
                finalColor = toneMapACES(finalColor);
                
                // Gamma correction
                finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
                
                return vec4<f32>(finalColor, 1.0);
            }
        `;
    }

    public createTerrainMesh(tile: TerrainTile): TerrainMeshData | null {
        if (!tile.meshData) {
            return null;
        }

        const meshData = tile.meshData;

        // Create vertex buffer
        const vertexData = new Float32Array(
            meshData.vertices.length +
                meshData.normals.length +
                meshData.uvs.length +
                meshData.vertices.length / 3
        );
        let offset = 0;

        // Interleave vertex data: position, normal, uv, materialId
        const vertexCount = meshData.vertices.length / 3;
        for (let i = 0; i < vertexCount; i++) {
            // Position
            vertexData[offset++] = meshData.vertices[i * 3];
            vertexData[offset++] = meshData.vertices[i * 3 + 1];
            vertexData[offset++] = meshData.vertices[i * 3 + 2];

            // Normal
            vertexData[offset++] = meshData.normals[i * 3];
            vertexData[offset++] = meshData.normals[i * 3 + 1];
            vertexData[offset++] = meshData.normals[i * 3 + 2];

            // UV
            vertexData[offset++] = meshData.uvs[i * 2];
            vertexData[offset++] = meshData.uvs[i * 2 + 1];

            // Material ID (from terrain data if available)
            const materialId = tile.terrainData?.materials ? tile.terrainData.materials[i] || 2 : 2; // Default to grassland
            vertexData[offset++] = materialId;
        }

        const vertexBuffer = this.device.createBuffer({
            label: `Terrain Vertex Buffer ${tile.id}`,
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        // Create index buffer
        const indexBuffer = this.device.createBuffer({
            label: `Terrain Index Buffer ${tile.id}`,
            size: meshData.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(indexBuffer, 0, meshData.indices);

        // Create a unique uniform buffer for this tile
        const uniformBuffer = this.device.createBuffer({
            label: `Terrain Uniform Buffer ${tile.id}`,
            size: 256, // Same size as the shared uniform buffer with environmental params
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create bind group for this tile with its own uniform buffer
        const bindGroup = this.createTerrainBindGroup(tile.id, uniformBuffer);

        const terrainMeshData: TerrainMeshData = {
            vertexBuffer,
            indexBuffer,
            indexCount: meshData.indices.length,
            bindGroup,
            uniformBuffer, // Store the uniform buffer with the mesh data
        };

        this.meshCache.set(tile.id, terrainMeshData);
        return terrainMeshData;
    }

    public render(
        renderPass: GPURenderPassEncoder,
        tiles: TerrainTile[],
        camera: Camera,
        time: number,
        shadowSystem?: ShadowSystem,
        isShadowPass: boolean = false
    ): void {
        // Use shadow pipeline for shadow passes, regular pipeline for main rendering
        const pipelineToUse = isShadowPass ? this.shadowPipeline : this.pipeline;

        if (!pipelineToUse) {
            console.error(
                `TerrainRenderer: No ${isShadowPass ? 'shadow' : 'main'} pipeline available`
            );
            return;
        }

        renderPass.setPipeline(pipelineToUse);

        // Create and set shadow bind group (for main pass only)
        if (!isShadowPass && this.shadowBindGroupLayout) {
            if (!this.shadowBindGroup || shadowSystem) {
                // Create or update shadow bind group
                this.shadowBindGroup = shadowSystem
                    ? this.createShadowBindGroup(shadowSystem)
                    : this.createDummyShadowBindGroup();
            }
            // Set shadow bind group for all tiles (group 3)
            renderPass.setBindGroup(3, this.shadowBindGroup);
        }

        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix();
        const cameraPosition = camera.getPosition();

        for (const tile of tiles) {
            // Get or create mesh for this tile
            let meshData = this.meshCache.get(tile.id);
            if (!meshData && tile.meshData) {
                meshData = this.createTerrainMesh(tile);
            }

            if (!meshData) {
                continue;
            }

            // No need to update bind group for shadow system anymore
            // Shadow resources are in a separate bind group (group 3)

            // Create model matrix for this tile
            const modelMatrix = new Matrix4();
            modelMatrix.makeTranslation(tile.worldBounds.minX, 0, tile.worldBounds.minZ);

            // Calculate MVP matrix
            const mvpMatrix = new Matrix4()
                .multiplyMatrices(projectionMatrix, viewMatrix)
                .multiply(modelMatrix);

            // Calculate normal matrix
            const normalMatrix = modelMatrix.clone().invert().transpose();

            // Update the tile's own uniform buffer
            // Total: 16 + 16 + 16 + 3 + 1 + seasonal params (8) = 60 floats = 240 bytes
            const uniformData = new Float32Array(64); // Round up to 256 bytes / 4 = 64 floats
            uniformData.set(mvpMatrix.elements, 0); // 16 floats at offset 0
            uniformData.set(modelMatrix.elements, 16); // 16 floats at offset 16
            uniformData.set(normalMatrix.elements, 32); // 16 floats at offset 32
            uniformData.set([cameraPosition.x, cameraPosition.y, cameraPosition.z], 48); // 3 floats at offset 48
            uniformData[51] = time; // 1 float at offset 51

            // Add seasonal and environmental parameters
            uniformData[52] = 0.25; // seasonFactor (spring)
            uniformData[53] = 0.0; // temperatureFactor (temperate)
            uniformData[54] = 0.5; // precipitationFactor (moderate)

            // Update atmospheric parameters
            this.updateAtmosphericBuffer();

            this.device.queue.writeBuffer(meshData.uniformBuffer, 0, uniformData);

            // Set bind group and draw
            renderPass.setBindGroup(0, meshData.bindGroup);
            renderPass.setVertexBuffer(0, meshData.vertexBuffer);
            renderPass.setIndexBuffer(meshData.indexBuffer, 'uint32');
            renderPass.drawIndexed(meshData.indexCount);
        }
    }

    public clearCache(): void {
        this.meshCache.clear();
    }

    /**
     * Create bind group for terrain with shadow support
     */
    private createTerrainBindGroup(tileId: string, uniformBuffer: GPUBuffer): GPUBindGroup {
        // Create uniform bind group (group 0) with both uniform and atmospheric buffers
        // Shadow resources will be in a separate bind group (group 3)
        return this.device.createBindGroup({
            label: `Terrain Bind Group ${tileId}`,
            layout: this.uniformBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.atmosphericBuffer },
                },
            ],
        });
    }

    /**
     * Create shadow bind group (group 3)
     */
    private createShadowBindGroup(shadowSystem: ShadowSystem): GPUBindGroup {
        const shadowMaps = shadowSystem.getShadowMaps();
        const shadowSampler = shadowSystem.getShadowSampler();
        const shadowUniforms = this.createShadowUniformBuffer(shadowSystem);

        const entries: GPUBindGroupEntry[] = [];

        // Add shadow map textures (bindings 0-3)
        for (let i = 0; i < 4; i++) {
            entries.push({
                binding: i,
                resource:
                    shadowMaps[i]?.createView() || this.createDummyDepthTexture().createView(),
            });
        }

        // Add shadow sampler (binding 4)
        entries.push({
            binding: 4,
            resource: shadowSampler,
        });

        // Add shadow uniforms (binding 5)
        entries.push({
            binding: 5,
            resource: { buffer: shadowUniforms },
        });

        return this.device.createBindGroup({
            label: 'Shadow Bind Group',
            layout: this.shadowBindGroupLayout!,
            entries,
        });
    }

    /**
     * Create shadow uniform buffer
     */
    private createShadowUniformBuffer(shadowSystem: ShadowSystem): GPUBuffer {
        const shadowConfig = shadowSystem.getConfig();
        const light = shadowSystem.getLight();
        const cascades = shadowSystem.getCascades();

        // Calculate required size: 4 matrices (64 floats) + cascade distances (4) + light data (8)
        const totalFloats = 64 + 4 + 8; // 76 floats
        const bufferSize = Math.ceil((totalFloats * 4) / 256) * 256; // Round up to 256 byte alignment

        const buffer = this.device.createBuffer({
            label: 'Terrain Shadow Uniforms',
            size: bufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Update buffer with shadow data
        const uniformData = new Float32Array(bufferSize / 4); // Convert bytes to float count
        let offset = 0;

        // Light matrices (16 floats each)
        for (let i = 0; i < 4; i++) {
            if (i < cascades.length) {
                uniformData.set(cascades[i].lightMatrix.elements, offset);
            }
            offset += 16;
        }

        // Cascade distances (4 floats)
        uniformData.set(shadowConfig.cascadeDistances, offset);
        offset += 4;

        // Light direction (3 floats)
        uniformData.set([light.direction.x, light.direction.y, light.direction.z], offset);
        offset += 3;

        // Shadow bias (1 float)
        uniformData[offset++] = shadowConfig.biasConstant;

        // Light color (3 floats)
        uniformData.set([light.color.x, light.color.y, light.color.z], offset);
        offset += 3;

        // Light intensity (1 float)
        uniformData[offset] = light.intensity;

        this.device.queue.writeBuffer(buffer, 0, uniformData);
        return buffer;
    }

    /**
     * Create dummy depth texture for missing shadows
     */
    private createDummyDepthTexture(): GPUTexture {
        return this.device.createTexture({
            label: 'Dummy Depth Texture',
            size: [1, 1, 1],
            format: 'depth32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    /**
     * Create dummy sampler
     */
    private createDummySampler(): GPUSampler {
        return this.device.createSampler({
            label: 'Dummy Sampler',
            compare: 'less',
        });
    }

    /**
     * Create dummy uniform buffer
     */
    private createDummyUniformBuffer(): GPUBuffer {
        return this.device.createBuffer({
            label: 'Dummy Uniform Buffer',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Create dummy shadow bind group when no shadow system is available
     */
    private createDummyShadowBindGroup(): GPUBindGroup {
        const entries: GPUBindGroupEntry[] = [];

        // Add dummy shadow map textures (bindings 0-3)
        for (let i = 0; i < 4; i++) {
            entries.push({
                binding: i,
                resource: this.createDummyDepthTexture().createView(),
            });
        }

        // Add dummy shadow sampler (binding 4)
        entries.push({
            binding: 4,
            resource: this.createDummySampler(),
        });

        // Add dummy shadow uniforms (binding 5)
        entries.push({
            binding: 5,
            resource: { buffer: this.createDummyUniformBuffer() },
        });

        return this.device.createBindGroup({
            label: 'Dummy Shadow Bind Group',
            layout: this.shadowBindGroupLayout!,
            entries,
        });
    }

    public destroy(): void {
        this.uniformBuffer.destroy();
        this.atmosphericBuffer.destroy();
        for (const meshData of this.meshCache.values()) {
            meshData.vertexBuffer.destroy();
            meshData.indexBuffer.destroy();
            meshData.uniformBuffer.destroy(); // Destroy each tile's uniform buffer
        }
        this.meshCache.clear();
    }
}
