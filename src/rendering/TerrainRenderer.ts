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
    private meshCache: Map<string, TerrainMeshData> = new Map();
    private uniformBuffer: GPUBuffer;
    private bindGroupLayout: GPUBindGroupLayout;
    private pipelineLayout: GPUPipelineLayout;

    constructor(device: GPUDevice) {
        this.device = device;

        // Create bind group layout for terrain rendering
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Terrain Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                // Shadow maps will be bound by shadow system
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
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'comparison' },
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        this.pipelineLayout = device.createPipelineLayout({
            label: 'Terrain Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Create uniform buffer for matrices
        // MVP (64) + Model (64) + Normal (64) + Camera pos (12) + time (4) = 208 bytes
        // Round up to 256 for alignment
        this.uniformBuffer = device.createBuffer({
            label: 'Terrain Uniform Buffer',
            size: 256, // MVP + Model + Normal matrices + camera position + time
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.createPipeline();
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
                        arrayStride: 32, // 3 floats position + 3 floats normal + 2 floats uv
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
            @group(0) @binding(1) var shadowMap0: texture_depth_2d;
            @group(0) @binding(2) var shadowMap1: texture_depth_2d;
            @group(0) @binding(3) var shadowMap2: texture_depth_2d;
            @group(0) @binding(4) var shadowMap3: texture_depth_2d;
            @group(0) @binding(5) var shadowSampler: sampler_comparison;
            @group(0) @binding(6) var<uniform> shadowUniforms: ShadowUniforms;
            
            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            };
            
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) height: f32,
                @location(4) viewDepth: f32,
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
                // Base terrain color based on height
                var baseColor = vec3<f32>(0.2, 0.6, 0.2); // Green
                
                let heightFactor = clamp(input.worldPos.y / 500.0, 0.0, 1.0);
                baseColor = mix(
                    vec3<f32>(0.1, 0.4, 0.1), // Dark green (low)
                    vec3<f32>(0.4, 0.8, 0.4), // Bright green (high)
                    heightFactor
                );
                
                // Add some rock color at higher elevations
                if (input.worldPos.y > 300.0) {
                    let rockFactor = smoothstep(300.0, 800.0, input.worldPos.y);
                    baseColor = mix(baseColor, vec3<f32>(0.5, 0.4, 0.3), rockFactor);
                }
                
                // Calculate lighting
                let lightDir = -shadowUniforms.lightDirection;
                let NdotL = max(dot(input.normal, lightDir), 0.0);
                
                // Calculate shadow
                let shadowFactor = calculateShadow(input.worldPos, input.normal, input.viewDepth);
                
                // Apply lighting with shadows
                let ambient = 0.3;
                let diffuse = 0.7 * NdotL * shadowFactor;
                let lighting = ambient + diffuse;
                
                var finalColor = baseColor * lighting * shadowUniforms.lightColor * shadowUniforms.lightIntensity;
                
                // Apply atmospheric scattering
                let distance = length(uniforms.cameraPosition - input.worldPos);
                let scatteringCoeff = 0.00001;
                let scattering = 1.0 - exp(-distance * scatteringCoeff);
                
                let sunDirection = -shadowUniforms.lightDirection;
                let viewDirection = normalize(input.worldPos - uniforms.cameraPosition);
                let cosTheta = dot(viewDirection, sunDirection);
                let miePhase = (1.0 + cosTheta * cosTheta) * 0.5;
                
                let skyColor = mix(
                    vec3<f32>(0.5, 0.7, 1.0),
                    vec3<f32>(1.0, 0.8, 0.6),
                    max(0.0, sunDirection.y) * 0.5
                );
                
                let scatteredLight = skyColor * scattering * miePhase;
                finalColor += scatteredLight;
                
                // Distance fog
                let fogStart = 10000.0;
                let fogEnd = 50000.0;
                let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
                let fogColor = vec3<f32>(0.7, 0.8, 0.9);
                
                finalColor = mix(fogColor, finalColor, fogFactor);
                
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
            meshData.vertices.length + meshData.normals.length + meshData.uvs.length
        );
        let offset = 0;

        // Interleave vertex data: position, normal, uv
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
            size: 256, // Same size as the shared uniform buffer
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
        shadowSystem?: ShadowSystem
    ): void {
        if (!this.pipeline) {
            console.error('TerrainRenderer: No pipeline available');
            return;
        }

        renderPass.setPipeline(this.pipeline);

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

            // Update bind group if we have shadow system
            if (shadowSystem) {
                meshData.bindGroup = this.createTerrainBindGroup(
                    tile.id,
                    meshData.uniformBuffer,
                    shadowSystem
                );
            }

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
    private createTerrainBindGroup(
        tileId: string,
        uniformBuffer: GPUBuffer,
        shadowSystem?: ShadowSystem
    ): GPUBindGroup {
        const entries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: { buffer: uniformBuffer },
            },
        ];

        if (shadowSystem) {
            const shadowMaps = shadowSystem.getShadowMaps();
            const shadowSampler = shadowSystem.getShadowSampler();
            const shadowUniforms = this.createShadowUniformBuffer(shadowSystem);

            // Add shadow map textures
            for (let i = 0; i < 4; i++) {
                entries.push({
                    binding: i + 1,
                    resource:
                        shadowMaps[i]?.createView() || this.createDummyDepthTexture().createView(),
                });
            }

            // Add shadow sampler
            entries.push({
                binding: 5,
                resource: shadowSampler,
            });

            // Add shadow uniforms
            entries.push({
                binding: 6,
                resource: { buffer: shadowUniforms },
            });
        } else {
            // Add dummy resources for shadow bindings
            const dummyTexture = this.createDummyDepthTexture();
            const dummySampler = this.createDummySampler();
            const dummyBuffer = this.createDummyUniformBuffer();

            for (let i = 1; i <= 4; i++) {
                entries.push({
                    binding: i,
                    resource: dummyTexture.createView(),
                });
            }

            entries.push({ binding: 5, resource: dummySampler });
            entries.push({ binding: 6, resource: { buffer: dummyBuffer } });
        }

        return this.device.createBindGroup({
            label: `Terrain Bind Group ${tileId}`,
            layout: this.bindGroupLayout,
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
