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

export class TerrainRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private shadowPipeline: GPURenderPipeline | null = null;
    private meshCache: Map<string, TerrainMeshData> = new Map();
    private uniformBuffer: GPUBuffer;
    private uniformBindGroupLayout: GPUBindGroupLayout;
    private shadowBindGroupLayout: GPUBindGroupLayout | null = null;
    private shadowBindGroup: GPUBindGroup | null = null;
    private pipelineLayout: GPUPipelineLayout;
    private sampleCount: number = 4;

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
            
            // Shadow resources in separate bind group to avoid conflicts
            @group(3) @binding(0) var shadowMap0: texture_depth_2d;
            @group(3) @binding(1) var shadowMap1: texture_depth_2d;
            @group(3) @binding(2) var shadowMap2: texture_depth_2d;
            @group(3) @binding(3) var shadowMap3: texture_depth_2d;
            @group(3) @binding(4) var shadowSampler: sampler_comparison;
            @group(3) @binding(5) var<uniform> shadowUniforms: ShadowUniforms;
            
            // Improved Perlin noise functions to replace sine/cosine patterns
            fn hash3(p: vec3<f32>) -> vec3<f32> {
                var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.xxy + p3.yzz) * p3.zyx);
            }
            
            fn noise3D(p: vec3<f32>) -> f32 {
                let i = floor(p);
                let f = fract(p);
                let u = f * f * (3.0 - 2.0 * f);
                
                return mix(
                    mix(
                        mix(dot(hash3(i + vec3<f32>(0.0, 0.0, 0.0)), f - vec3<f32>(0.0, 0.0, 0.0)),
                            dot(hash3(i + vec3<f32>(1.0, 0.0, 0.0)), f - vec3<f32>(1.0, 0.0, 0.0)), u.x),
                        mix(dot(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), f - vec3<f32>(0.0, 1.0, 0.0)),
                            dot(hash3(i + vec3<f32>(1.0, 1.0, 0.0)), f - vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
                    mix(
                        mix(dot(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), f - vec3<f32>(0.0, 0.0, 1.0)),
                            dot(hash3(i + vec3<f32>(1.0, 0.0, 1.0)), f - vec3<f32>(1.0, 0.0, 1.0)), u.x),
                        mix(dot(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), f - vec3<f32>(0.0, 1.0, 1.0)),
                            dot(hash3(i + vec3<f32>(1.0, 1.0, 1.0)), f - vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
            }
            
            fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
                var value = 0.0;
                var amplitude = 1.0;
                var frequency = 1.0;
                var maxValue = 0.0;
                
                for (var i = 0; i < octaves; i++) {
                    value += noise3D(p * frequency) * amplitude;
                    maxValue += amplitude;
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                
                return value / maxValue;
            }
            
            fn triplanarNoise(worldPos: vec3<f32>, normal: vec3<f32>, scale: f32, octaves: i32) -> f32 {
                // Calculate proper triplanar weights based on surface normal
                let weights = abs(normal);
                let weightSum = weights.x + weights.y + weights.z;
                let normalizedWeights = weights / weightSum;
                
                // Sample noise from three orthogonal planes
                let noiseX = fbm(worldPos.yzx * scale, octaves);  // YZ plane (for X-facing surfaces)
                let noiseY = fbm(worldPos.xzy * scale, octaves);  // XZ plane (for Y-facing surfaces)
                let noiseZ = fbm(worldPos.xyz * scale, octaves);  // XY plane (for Z-facing surfaces)
                
                // Blend based on surface normal orientation
                return noiseX * normalizedWeights.x + noiseY * normalizedWeights.y + noiseZ * normalizedWeights.z;
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
            
            fn getBiomeColor(materialId: f32, elevation: f32, worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let id = i32(materialId);
                
                // Natural biome colors with realistic earth tones
                var baseColor: vec3<f32>;
                switch (id) {
                    case 0: { baseColor = vec3<f32>(0.05, 0.3, 0.6); }     // Ocean - deep blue
                    case 1: { 
                        // Beach - natural sand with improved triplanar noise
                        baseColor = vec3<f32>(0.7, 0.6, 0.45);
                        let sandNoise = triplanarNoise(worldPos, normal, 0.017, 3) * 0.08;
                        baseColor += vec3<f32>(sandNoise, sandNoise * 0.8, sandNoise * 0.6);
                    }
                    case 2: { 
                        // Grassland - enhanced with tiling grass texture
                        baseColor = getGrasslandTexture(worldPos, time, normal);
                    }
                    case 3: { 
                        // Forest - rich soil with organic variation
                        baseColor = getForestFloorTexture(worldPos, elevation, normal);
                    }
                    case 4: { 
                        // Desert - enhanced sand texture
                        baseColor = getDesertTexture(worldPos, normal);
                    }
                    case 5: { 
                        // Mountain - rocky texture with mineral variation
                        baseColor = getMountainTexture(worldPos, elevation, normal);
                    }
                    case 6: { 
                        // Snow - pure white with subtle blue tint and sparkle
                        baseColor = getSnowTexture(worldPos, time, normal);
                    }
                    case 7: { 
                        // Tundra - frozen soil with sparse vegetation
                        baseColor = getTundraTexture(worldPos, normal);
                    }
                    case 8: { 
                        // Wetland - muddy terrain with organic matter
                        baseColor = getWetlandTexture(worldPos, normal);
                    }
                    case 9: { baseColor = vec3<f32>(0.8, 0.8, 0.8); }       // Urban - light gray
                    case 10: { baseColor = vec3<f32>(0.2, 0.6, 1.0); }      // Lake - bright blue
                    case 11: { baseColor = vec3<f32>(0.3, 0.7, 1.0); }      // River - flowing blue
                    default: { baseColor = getGrasslandTexture(worldPos, time, normal); } // Default grassland
                }
                
                // Add elevation-based variation for more realism
                let elevationFactor = clamp(elevation / 1000.0, 0.0, 1.0);
                
                // Grassland and forest get brown tints at higher elevation
                if (id == 2 || id == 3) {
                    let brownTint = vec3<f32>(0.6, 0.4, 0.2);
                    baseColor = mix(baseColor, brownTint, elevationFactor * 0.3);
                }
                
                // Mountains get snow caps
                if (id == 5 && elevation > 800.0) {
                    let snowColor = vec3<f32>(0.95, 0.95, 1.0);
                    let snowFactor = clamp((elevation - 800.0) / 200.0, 0.0, 1.0);
                    baseColor = mix(baseColor, snowColor, snowFactor);
                }
                
                return baseColor;
            }
            
            // Grass texture with seasonal variation and natural colors
            fn getGrasslandTexture(worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let scale1 = 0.02;
                let scale2 = 0.08;
                let scale3 = 0.15;
                
                // Natural grass colors - more muted and realistic
                let springGreen = vec3<f32>(0.3, 0.6, 0.2);   // Fresh spring green
                let summerGreen = vec3<f32>(0.25, 0.5, 0.18); // Mature summer green
                let autumnBrown = vec3<f32>(0.45, 0.35, 0.15); // Autumn gold
                let winterBrown = vec3<f32>(0.3, 0.25, 0.15);  // Winter dormant
                
                let darkGreen = vec3<f32>(0.15, 0.4, 0.1);
                let lightGreen = vec3<f32>(0.35, 0.6, 0.25);
                let brownPatch = vec3<f32>(0.3, 0.22, 0.08);
                
                // Multi-scale noise for grass variation using improved noise
                let noise1 = triplanarNoise(worldPos, normal, scale1, 2);
                let noise2 = triplanarNoise(worldPos, normal, scale2, 2);
                let noise3 = triplanarNoise(worldPos + vec3<f32>(time * 2.0, 0.0, 0.0), normal, scale3, 2);
                
                // Combine noise layers
                let grassDensity = (noise1 + noise2 * 0.5 + noise3 * 0.3) * 0.5 + 0.5;
                let brownPatches = smoothstep(0.3, 0.4, noise2);
                
                // Apply seasonal variation
                let seasonCycle = uniforms.seasonFactor * 4.0; // Convert to 0-4 range
                var seasonalGrassColor: vec3<f32>;
                
                if (seasonCycle < 1.0) {        // Spring
                    seasonalGrassColor = mix(winterBrown, springGreen, seasonCycle);
                } else if (seasonCycle < 2.0) { // Summer
                    seasonalGrassColor = mix(springGreen, summerGreen, seasonCycle - 1.0);
                } else if (seasonCycle < 3.0) { // Autumn
                    seasonalGrassColor = mix(summerGreen, autumnBrown, seasonCycle - 2.0);
                } else {                        // Winter
                    seasonalGrassColor = mix(autumnBrown, winterBrown, seasonCycle - 3.0);
                }
                
                // Color mixing with seasonal base
                var grassColor = mix(darkGreen * 0.7, seasonalGrassColor, grassDensity);
                grassColor = mix(grassColor, lightGreen * 0.8, max(0.0, noise3) * 0.3);
                grassColor = mix(grassColor, brownPatch, brownPatches * 0.2);
                
                // Temperature and precipitation effects
                let coldEffect = clamp(-uniforms.temperatureFactor, 0.0, 1.0);
                let dryEffect = clamp(1.0 - uniforms.precipitationFactor, 0.0, 1.0);
                
                // Cold makes grass more brown/dead
                grassColor = mix(grassColor, vec3<f32>(0.4, 0.3, 0.2), coldEffect * 0.3);
                // Dry conditions make grass less vibrant
                grassColor *= mix(1.0, 0.7, dryEffect * 0.5);
                
                return grassColor;
            }
            
            // Forest floor texture with rich organic variation
            fn getForestFloorTexture(worldPos: vec3<f32>, elevation: f32, normal: vec3<f32>) -> vec3<f32> {
                let soilBrown = vec3<f32>(0.18, 0.12, 0.06);
                let leafLitter = vec3<f32>(0.3, 0.2, 0.08);
                let mossGreen = vec3<f32>(0.08, 0.25, 0.1);
                let darkSoil = vec3<f32>(0.1, 0.08, 0.04);
                
                let noise1 = triplanarNoise(worldPos, normal, 0.023, 3);
                let noise2 = triplanarNoise(worldPos, normal, 0.087, 2);
                
                // Moss in damper areas
                let mossAreas = smoothstep(0.2, 0.6, noise1);
                
                var forestColor = mix(soilBrown, leafLitter, noise2 * 0.5 + 0.5);
                forestColor = mix(forestColor, mossGreen, mossAreas * 0.4);
                forestColor = mix(forestColor, darkSoil, max(0.0, -noise2) * 0.3);
                
                return forestColor;
            }
            
            // Desert sand texture with natural dune patterns
            fn getDesertTexture(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
                let lightSand = vec3<f32>(0.7, 0.6, 0.4);
                let darkSand = vec3<f32>(0.55, 0.45, 0.25);
                let redSand = vec3<f32>(0.6, 0.35, 0.15);
                
                let noise1 = triplanarNoise(worldPos, normal, 0.011, 4);
                let noise2 = triplanarNoise(worldPos, normal, 0.053, 2);
                
                var sandColor = mix(lightSand, darkSand, noise1 * 0.3 + 0.5);
                sandColor = mix(sandColor, redSand, max(0.0, noise2) * 0.2);
                
                return sandColor;
            }
            
            // Mountain rocky texture with realistic stone colors
            fn getMountainTexture(worldPos: vec3<f32>, elevation: f32, normal: vec3<f32>) -> vec3<f32> {
                let grayRock = vec3<f32>(0.45, 0.45, 0.5);
                let darkRock = vec3<f32>(0.3, 0.3, 0.35);
                let brownRock = vec3<f32>(0.35, 0.28, 0.2);
                let slate = vec3<f32>(0.25, 0.28, 0.32);
                
                let noise1 = triplanarNoise(worldPos, normal, 0.009, 3);
                let noise2 = triplanarNoise(worldPos, normal, 0.031, 2);
                
                var rockColor = mix(grayRock, darkRock, noise1 * 0.5 + 0.5);
                rockColor = mix(rockColor, brownRock, max(0.0, noise2) * 0.3);
                rockColor = mix(rockColor, slate, smoothstep(800.0, 1200.0, elevation) * 0.4);
                
                return rockColor;
            }
            
            // Snow texture with natural variations
            fn getSnowTexture(worldPos: vec3<f32>, time: f32, normal: vec3<f32>) -> vec3<f32> {
                let pureWhite = vec3<f32>(0.9, 0.9, 0.95);
                let blueSnow = vec3<f32>(0.8, 0.85, 0.9);
                let sparkle = vec3<f32>(0.95, 0.95, 0.98);
                
                let noise1 = triplanarNoise(worldPos + vec3<f32>(time * 1.0, 0.0, 0.0), normal, 0.11, 2);
                let sparkleNoise = triplanarNoise(worldPos + vec3<f32>(time * 0.5, time * 0.3, 0.0), normal, 0.19, 1);
                
                var snowColor = mix(pureWhite, blueSnow, noise1 * 0.2 + 0.3);
                let sparkleEffect = smoothstep(0.7, 0.9, sparkleNoise);
                snowColor = mix(snowColor, sparkle, sparkleEffect * 0.1);
                
                return snowColor;
            }
            
            // Tundra frozen ground texture
            fn getTundraTexture(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
                let frozenSoil = vec3<f32>(0.5, 0.5, 0.45);
                let permafrost = vec3<f32>(0.4, 0.45, 0.5);
                let deadGrass = vec3<f32>(0.6, 0.5, 0.3);
                
                let noise1 = triplanarNoise(worldPos, normal, 0.021, 3);
                let noise2 = triplanarNoise(worldPos, normal, 0.083, 2);
                
                var tundraColor = mix(frozenSoil, permafrost, noise1 * 0.4 + 0.5);
                tundraColor = mix(tundraColor, deadGrass, max(0.0, noise2) * 0.3);
                
                return tundraColor;
            }
            
            // Wetland muddy texture
            fn getWetlandTexture(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
                let darkMud = vec3<f32>(0.2, 0.15, 0.1);
                let wetSoil = vec3<f32>(0.3, 0.25, 0.15);
                let organicMatter = vec3<f32>(0.15, 0.2, 0.1);
                let waterReflection = vec3<f32>(0.4, 0.5, 0.6);
                
                let noise1 = triplanarNoise(worldPos, normal, 0.041, 3);
                let noise2 = triplanarNoise(worldPos, normal, 0.151, 2);
                
                var wetlandColor = mix(darkMud, wetSoil, noise1 * 0.5 + 0.5);
                wetlandColor = mix(wetlandColor, organicMatter, max(0.0, noise2) * 0.4);
                
                // Add subtle water reflection in very wet areas
                let wateriness = smoothstep(0.5, 0.8, noise1);
                wetlandColor = mix(wetlandColor, waterReflection, wateriness * 0.15);
                
                return wetlandColor;
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
            
            @fragment
            fn fs_terrain(input: VertexOutput) -> @location(0) vec4<f32> {
                // Base terrain color based on material ID (biome) with enhanced texturing
                var baseColor = getBiomeColor(input.materialId, input.worldPos.y, input.worldPos, uniforms.time, input.normal);
                
                // Add noise-based texture variation with improved Perlin noise
                let noiseScale = 0.013;
                let noiseValue1 = triplanarNoise(input.worldPos, input.normal, noiseScale, 3);
                let noiseValue2 = triplanarNoise(input.worldPos, input.normal, noiseScale * 2.7, 2);
                let combinedNoise = (noiseValue1 + noiseValue2 * 0.5) * 0.12;
                
                // Apply noise variation
                baseColor += vec3<f32>(combinedNoise, combinedNoise * 0.8, combinedNoise * 0.6);
                
                // Add height-based color variation for more realism
                let heightFactor = clamp(input.worldPos.y / 1000.0, 0.0, 1.0);
                let heightVariation = mix(0.9, 1.3, heightFactor);
                baseColor *= heightVariation;
                
                // Add slope-based darkening (cliffs and steep areas are darker)
                let slopeFactor = 1.0 - abs(input.normal.y);
                let slopeDarkening = mix(1.0, 0.7, slopeFactor);
                baseColor *= slopeDarkening;
                
                // Enhanced lighting calculation
                let lightDir = -shadowUniforms.lightDirection;
                let NdotL = max(dot(input.normal, lightDir), 0.0);
                
                // Calculate shadow
                let shadowFactor = calculateShadow(input.worldPos, input.normal, input.viewDepth);
                
                // Enhanced lighting with better ambient and diffuse
                let ambient = 0.4; // Increased ambient for better visibility
                let diffuse = 0.8 * NdotL * shadowFactor;
                let lighting = ambient + diffuse;
                
                // Add subtle rim lighting for depth
                let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
                let rimLight = pow(1.0 - max(dot(viewDir, input.normal), 0.0), 2.0) * 0.2;
                
                var finalColor = baseColor * lighting * shadowUniforms.lightColor * shadowUniforms.lightIntensity;
                finalColor += baseColor * rimLight;
                
                // Enhanced atmospheric scattering
                let distance = length(uniforms.cameraPosition - input.worldPos);
                let scatteringCoeff = 0.000008; // Adjusted for better visibility
                let scattering = 1.0 - exp(-distance * scatteringCoeff);
                
                let sunDirection = -shadowUniforms.lightDirection;
                let viewDirection = normalize(input.worldPos - uniforms.cameraPosition);
                let cosTheta = dot(viewDirection, sunDirection);
                let miePhase = (1.0 + cosTheta * cosTheta) * 0.5;
                
                // More realistic sky colors
                let horizonColor = vec3<f32>(0.6, 0.8, 1.0);
                let zenithColor = vec3<f32>(0.3, 0.6, 1.0);
                let sunsetColor = vec3<f32>(1.0, 0.7, 0.4);
                
                let skyColor = mix(
                    mix(horizonColor, zenithColor, max(0.0, sunDirection.y)),
                    sunsetColor,
                    max(0.0, cosTheta) * (1.0 - abs(sunDirection.y))
                );
                
                let scatteredLight = skyColor * scattering * miePhase * 0.3;
                finalColor += scatteredLight;
                
                // Distance fog with better color blending
                let fogStart = 15000.0;
                let fogEnd = 60000.0;
                let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
                let fogColor = skyColor * 0.9; // Use sky color for fog
                
                finalColor = mix(fogColor, finalColor, fogFactor);
                
                // Color correction and saturation boost
                finalColor = pow(finalColor, vec3<f32>(0.9)); // Slight gamma correction
                finalColor = mix(vec3<f32>(dot(finalColor, vec3<f32>(0.299, 0.587, 0.114))), finalColor, 1.2); // Saturation boost
                
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
            // Total: 16 + 16 + 16 + 3 + 1 = 52 floats = 208 bytes
            const uniformData = new Float32Array(52);
            uniformData.set(mvpMatrix.elements, 0); // 16 floats at offset 0
            uniformData.set(modelMatrix.elements, 16); // 16 floats at offset 16
            uniformData.set(normalMatrix.elements, 32); // 16 floats at offset 32
            uniformData.set([cameraPosition.x, cameraPosition.y, cameraPosition.z], 48); // 3 floats at offset 48
            uniformData[51] = time; // 1 float at offset 51

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
        // Only create uniform bind group (group 0) with the uniform buffer
        // Shadow resources will be in a separate bind group (group 3)
        return this.device.createBindGroup({
            label: `Terrain Bind Group ${tileId}`,
            layout: this.uniformBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer },
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
        for (const meshData of this.meshCache.values()) {
            meshData.vertexBuffer.destroy();
            meshData.indexBuffer.destroy();
            meshData.uniformBuffer.destroy(); // Destroy each tile's uniform buffer
        }
        this.meshCache.clear();
    }
}
