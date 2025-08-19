import { Camera } from './Camera';
import { Matrix4, Vector3 } from '../core/math';
import { WaterSurface } from '../world/WaterSystem';

/**
 * Simplified water renderer for stable rendering
 */
export class SimpleWaterRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout;
    private uniformBuffer: GPUBuffer;
    private meshCache: Map<
        string,
        {
            vertexBuffer: GPUBuffer;
            indexBuffer: GPUBuffer;
            indexCount: number;
        }
    > = new Map();

    constructor(device: GPUDevice) {
        this.device = device;

        // Create bind group layout
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Simple Water Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create uniform buffer (16 * 4 + 16 * 4 + 4 * 4 = 144 bytes, padded to 256)
        this.uniformBuffer = device.createBuffer({
            label: 'Simple Water Uniform Buffer',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Initialize the water pipeline
     */
    public async initialize(): Promise<void> {
        // Load shader
        const shaderCode = await this.loadShaderCode();
        const shaderModule = this.device.createShaderModule({
            label: 'Simple Water Shader',
            code: shaderCode,
        });

        // Create pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Simple Water Pipeline',
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 32, // position(12) + normal(12) + uv(8) = 32 bytes
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                            { format: 'float32x3', offset: 12, shaderLocation: 1 }, // normal
                            { format: 'float32x2', offset: 24, shaderLocation: 2 }, // uv
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
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
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
            multisample: {
                count: 4,
            },
        });

        console.log('SimpleWaterRenderer: Pipeline initialized');
    }

    /**
     * Load shader code
     */
    private async loadShaderCode(): Promise<string> {
        // For now, inline the shader code
        return `
            struct Uniforms {
                mvpMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                cameraPosition: vec3<f32>,
                time: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
                @location(3) depth: f32,
            }

            @vertex
            fn vs_main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                
                // Apply simple wave displacement for more realistic water surface
                var worldPos = input.position;
                let waveTime = uniforms.time;
                
                // Multi-frequency wave displacement
                let wave1 = sin(worldPos.x * 0.02 + waveTime * 1.5) * cos(worldPos.z * 0.015 + waveTime * 1.2) * 0.3;
                let wave2 = sin(worldPos.x * 0.035 + waveTime * 2.1) * cos(worldPos.z * 0.028 + waveTime * 1.8) * 0.15;
                let wave3 = sin((worldPos.x + worldPos.z) * 0.05 + waveTime * 2.8) * 0.08;
                
                worldPos.y += wave1 + wave2 + wave3;
                
                output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
                output.worldPos = worldPos;
                
                // Calculate surface normal from wave gradients for better lighting
                let epsilon = 2.0;
                let heightL = sin((worldPos.x - epsilon) * 0.02 + waveTime * 1.5) * cos(worldPos.z * 0.015 + waveTime * 1.2) * 0.3;
                let heightR = sin((worldPos.x + epsilon) * 0.02 + waveTime * 1.5) * cos(worldPos.z * 0.015 + waveTime * 1.2) * 0.3;
                let heightD = sin(worldPos.x * 0.02 + waveTime * 1.5) * cos((worldPos.z - epsilon) * 0.015 + waveTime * 1.2) * 0.3;
                let heightU = sin(worldPos.x * 0.02 + waveTime * 1.5) * cos((worldPos.z + epsilon) * 0.015 + waveTime * 1.2) * 0.3;
                
                let normalX = (heightL - heightR) / (2.0 * epsilon);
                let normalZ = (heightD - heightU) / (2.0 * epsilon);
                output.normal = normalize(vec3<f32>(normalX, 1.0, normalZ));
                
                output.uv = input.uv;
                
                // Calculate depth for shading
                let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
                output.depth = -viewPos.z;
                
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                // Enhanced water colors with more convincing depth gradation
                let veryShallowColor = vec3<f32>(0.7, 0.95, 1.0);  // Very light turquoise
                let shallowColor = vec3<f32>(0.3, 0.8, 0.95);      // Bright turquoise  
                let mediumColor = vec3<f32>(0.15, 0.55, 0.8);      // Medium blue
                let deepColor = vec3<f32>(0.05, 0.3, 0.7);        // Deep ocean blue
                let veryDeepColor = vec3<f32>(0.02, 0.15, 0.5);   // Very deep blue
                
                // FIXED: Use a more reliable depth calculation
                // Start with a base water color and make depth calculations more predictable
                let cameraDistance = length(uniforms.cameraPosition - input.worldPos);
                let normalizedDistance = clamp(cameraDistance * 0.0002, 0.0, 4.0); // Improved scaling
                
                // Use UV coordinates as backup for depth variation if distance fails
                let uvDepth = (input.uv.x + input.uv.y) * 0.5; // 0.0 to 1.0 based on UV
                let combinedDepth = max(normalizedDistance, uvDepth);
                
                let depthFactor1 = clamp(combinedDepth, 0.0, 1.0);
                let depthFactor2 = clamp(combinedDepth - 1.0, 0.0, 1.0);
                let depthFactor3 = clamp(combinedDepth - 2.0, 0.0, 1.0);
                
                // Progressive color transitions
                var waterColor = mix(veryShallowColor, shallowColor, depthFactor1);
                waterColor = mix(waterColor, mediumColor, depthFactor2);
                waterColor = mix(waterColor, deepColor, depthFactor3);
                waterColor = mix(waterColor, veryDeepColor, clamp(combinedDepth - 3.0, 0.0, 1.0));
                
                // FAILSAFE: Ensure we always have a blue water color, never gray
                // If all depth calculations fail, default to medium blue water
                if (length(waterColor) < 0.1) {
                    waterColor = vec3<f32>(0.2, 0.6, 0.9); // Fallback medium blue
                }
                
                // Add subtle animated wave patterns with multiple frequencies
                let waveTime = uniforms.time * 0.8;
                let waveOffset1 = sin(input.uv.x * 25.0 + waveTime * 2.2) * 0.08;
                let waveOffset2 = cos(input.uv.y * 18.0 + waveTime * 1.7) * 0.06;
                let waveOffset3 = sin((input.uv.x + input.uv.y) * 12.0 + waveTime * 2.8) * 0.04;
                let waveIntensity = waveOffset1 + waveOffset2 + waveOffset3;
                
                // Enhanced wave color effects with depth modulation
                let waveColorEffect = vec3<f32>(0.08, 0.12, 0.18) * waveIntensity * (1.0 - depthFactor1 * 0.5);
                waterColor += waveColorEffect;
                
                // Create surface foam effect for shallow water
                let foamFactor = 1.0 - smoothstep(0.0, 0.3, combinedDepth);
                let foamNoise = sin(input.uv.x * 60.0 + waveTime * 3.0) * cos(input.uv.y * 45.0 + waveTime * 2.5);
                let foam = foamFactor * max(0.0, foamNoise) * 0.15;
                waterColor = mix(waterColor, vec3<f32>(0.9, 0.95, 1.0), foam);
                
                // Improved lighting with sun reflection
                let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
                
                // Create dynamic water normal for better wave reflection
                let normalOffset = vec3<f32>(
                    sin(input.uv.x * 30.0 + waveTime * 2.0) * 0.1,
                    1.0,
                    cos(input.uv.y * 25.0 + waveTime * 1.8) * 0.1
                );
                let waveNormal = normalize(normalOffset);
                
                let ndotl = max(dot(waveNormal, lightDir), 0.35); // Higher ambient for water
                
                // Enhanced specular highlights with wave normal
                let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
                let reflectDir = reflect(-lightDir, waveNormal);
                let specularPower = 64.0; // Sharper water reflections
                let specular = pow(max(dot(viewDir, reflectDir), 0.0), specularPower) * 0.8;
                
                // Fresnel effect with proper water refractive index
                let fresnel = pow(1.0 - max(dot(viewDir, waveNormal), 0.0), 1.8);
                
                // Depth-dependent transparency - make water more opaque
                let depthTransparency = mix(0.75, 0.95, clamp(combinedDepth, 0.0, 1.0));
                var alpha = mix(depthTransparency, 0.98, fresnel);
                
                // Add shoreline alpha blending for realistic water edges
                let shorelineBlending = smoothstep(0.0, 0.3, combinedDepth);
                alpha *= shorelineBlending;
                
                // Ensure minimum alpha for visibility - water should never be invisible
                alpha = max(alpha, 0.8);
                
                // Apply caustics effect for shallow areas
                let causticsStrength = 1.0 - smoothstep(0.0, 0.8, combinedDepth);
                let causticPattern = sin(input.uv.x * 40.0 + waveTime * 1.5) * cos(input.uv.y * 35.0 + waveTime * 1.2);
                let caustics = causticsStrength * max(0.0, causticPattern) * 0.1;
                
                // Final color composition
                let finalColor = waterColor * ndotl + vec3<f32>(1.0, 1.0, 0.9) * specular + vec3<f32>(0.8, 0.9, 1.0) * caustics;
                
                // Add subtle subsurface scattering
                let backscatter = max(0.0, -dot(viewDir, lightDir)) * (1.0 - depthFactor1) * 0.2;
                finalColor += vec3<f32>(0.4, 0.7, 0.9) * backscatter;
                
                // FINAL FAILSAFE: Ensure the returned color is always visible blue water
                if (length(finalColor) < 0.1 || alpha < 0.1) {
                    return vec4<f32>(0.2, 0.6, 0.9, 0.85); // Guaranteed blue water
                }
                
                return vec4<f32>(finalColor, alpha);
            }
        `;
    }

    /**
     * Create simple flat water mesh
     */
    private createWaterMesh(surface: WaterSurface): void {
        const { minX, maxX, minZ, maxZ } = surface.bounds;
        const resolution = 10; // Simple 10x10 grid
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        const stepX = sizeX / (resolution - 1);
        const stepZ = sizeZ / (resolution - 1);

        const vertices: number[] = [];
        const indices: number[] = [];

        // Generate vertices - simple flat plane at sea level
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = minX + j * stepX;
                const z = minZ + i * stepZ;
                const y = 0.0; // Sea level - completely flat

                // Position
                vertices.push(x, y, z);
                // Normal (always up)
                vertices.push(0, 1, 0);
                // UV
                vertices.push(j / (resolution - 1), i / (resolution - 1));
            }
        }

        // Generate indices
        for (let i = 0; i < resolution - 1; i++) {
            for (let j = 0; j < resolution - 1; j++) {
                const topLeft = i * resolution + j;
                const topRight = topLeft + 1;
                const bottomLeft = (i + 1) * resolution + j;
                const bottomRight = bottomLeft + 1;

                // Two triangles per quad
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        // Create GPU buffers
        const vertexData = new Float32Array(vertices);
        const indexData = new Uint32Array(indices);

        const vertexBuffer = this.device.createBuffer({
            label: `Simple Water Vertex Buffer ${surface.id}`,
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: `Simple Water Index Buffer ${surface.id}`,
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, indexData);

        this.meshCache.set(surface.id, {
            vertexBuffer,
            indexBuffer,
            indexCount: indices.length,
        });

        console.log(
            `SimpleWaterRenderer: Created mesh for surface ${surface.id} with ${vertices.length / 8} vertices, bounds: ${surface.bounds.minX}-${surface.bounds.maxX} x ${surface.bounds.minZ}-${surface.bounds.maxZ}`
        );
    }

    /**
     * Render water surfaces
     */
    public render(
        renderPass: GPURenderPassEncoder,
        camera: Camera,
        surfaces: WaterSurface[],
        time: number
    ): void {
        if (!this.pipeline) {
            console.warn('SimpleWaterRenderer: Pipeline not initialized');
            return;
        }

        // Always render a simple ocean plane if no water surfaces
        if (surfaces.length === 0) {
            // Create a default ocean surface - much larger for better visibility
            const defaultOcean: WaterSurface = {
                id: 'default-ocean',
                type: 'ocean' as any, // Use proper WaterType
                center: new Vector3(0, 0, 0),
                bounds: { minX: -50000, maxX: 50000, minZ: -50000, maxZ: 50000 }, // Much larger ocean
                averageDepth: 25,
                maxDepth: 50,
                temperature: 15,
                salinity: 0.35, // Ocean salinity
                clarity: 0.8,
                waveHeight: 1.2, // More pronounced waves
                windDirection: new Vector3(1, 0, 0.3).normalize(),
                windSpeed: 8.0, // Reasonable wind speed
            };
            surfaces = [defaultOcean];
        }

        renderPass.setPipeline(this.pipeline);

        // Update uniforms
        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix();
        const mvpMatrix = new Matrix4().multiplyMatrices(projectionMatrix, viewMatrix);

        // Get camera position with fallback
        let cameraPos;
        try {
            cameraPos = camera.getPosition();
        } catch (e) {
            console.error('SimpleWaterRenderer: Error getting camera position:', e);
            cameraPos = { x: 0, y: 100, z: 0 }; // Fallback position
        }

        // Safety check for camera position
        if (!cameraPos || typeof cameraPos.x === 'undefined') {
            console.error('SimpleWaterRenderer: Camera position is invalid, using fallback');
            cameraPos = { x: 0, y: 100, z: 0 };
        }

        const uniformData = new Float32Array(64);
        uniformData.set(mvpMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set([cameraPos.x, cameraPos.y, cameraPos.z], 32);
        uniformData[35] = time;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });

        renderPass.setBindGroup(0, bindGroup);

        // Render each surface
        for (const surface of surfaces) {
            let mesh = this.meshCache.get(surface.id);
            if (!mesh) {
                this.createWaterMesh(surface);
                mesh = this.meshCache.get(surface.id);
                if (!mesh) continue;
            }

            renderPass.setVertexBuffer(0, mesh.vertexBuffer);
            renderPass.setIndexBuffer(mesh.indexBuffer, 'uint32');
            renderPass.drawIndexed(mesh.indexCount);
        }
    }

    /**
     * Clear mesh cache
     */
    public clearCache(): void {
        for (const mesh of this.meshCache.values()) {
            mesh.vertexBuffer.destroy();
            mesh.indexBuffer.destroy();
        }
        this.meshCache.clear();
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        this.clearCache();
        this.uniformBuffer.destroy();
    }
}
