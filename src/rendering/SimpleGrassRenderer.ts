import { Camera } from './Camera';
import { Matrix4, Vector3 } from '../core/math';

interface GrassInstance {
    position: Vector3;
    scale: number;
    rotation: number;
    biomeType?: string;
    colorVariation?: number;
}

/**
 * Simplified grass renderer for ground cover
 */
export class SimpleGrassRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout;
    private uniformBuffer: GPUBuffer;
    private grassGeometry: {
        vertexBuffer: GPUBuffer;
        indexBuffer: GPUBuffer;
        indexCount: number;
    } | null = null;
    private instanceBuffer: GPUBuffer | null = null;
    private instanceCount: number = 0;
    private maxInstances: number = 100000; // Much more grass for better coverage

    constructor(device: GPUDevice) {
        this.device = device;

        // Create bind group layout
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Simple Grass Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create uniform buffer
        this.uniformBuffer = device.createBuffer({
            label: 'Simple Grass Uniform Buffer',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create instance buffer
        this.instanceBuffer = device.createBuffer({
            label: 'Grass Instance Buffer',
            size: this.maxInstances * 32, // position(12) + scale(4) + rotation(4) + padding(12) = 32 bytes
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Initialize the grass pipeline
     */
    public async initialize(): Promise<void> {
        // Create grass geometry
        this.createGrassGeometry();

        // Load shader
        const shaderCode = this.getShaderCode();
        const shaderModule = this.device.createShaderModule({
            label: 'Simple Grass Shader',
            code: shaderCode,
        });

        // Create pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Simple Grass Pipeline',
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    // Vertex buffer
                    {
                        arrayStride: 32, // position(12) + normal(12) + color(8) = 32 bytes
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
                            { format: 'float32x3', offset: 12, shaderLocation: 1 }, // normal
                            { format: 'float32x2', offset: 24, shaderLocation: 2 }, // uv
                        ],
                    },
                    // Instance buffer
                    {
                        arrayStride: 32,
                        stepMode: 'instance',
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 3 }, // instance position
                            { format: 'float32', offset: 12, shaderLocation: 4 }, // scale
                            { format: 'float32', offset: 16, shaderLocation: 5 }, // rotation
                            { format: 'float32', offset: 20, shaderLocation: 6 }, // color variation
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
                cullMode: 'none', // No culling for grass blades
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: false, // Grass doesn't write depth for better blending
                depthCompare: 'less',
                format: 'depth24plus',
            },
            multisample: {
                count: 4,
            },
        });

        console.log('SimpleGrassRenderer: Pipeline initialized');
    }

    /**
     * Get shader code
     */
    private getShaderCode(): string {
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
                // Instance attributes
                @location(3) instancePosition: vec3<f32>,
                @location(4) scale: f32,
                @location(5) rotation: f32,
                @location(6) colorVariation: f32,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) color: vec3<f32>,
                @location(3) alpha: f32,
                @location(4) uv: vec2<f32>,
            }

            @vertex
            fn vs_main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                
                // Apply rotation
                let cosRot = cos(input.rotation);
                let sinRot = sin(input.rotation);
                let rotatedPos = vec3<f32>(
                    input.position.x * cosRot - input.position.z * sinRot,
                    input.position.y,
                    input.position.x * sinRot + input.position.z * cosRot
                );
                
                // Simple wind animation
                let windOffset = sin(uniforms.time * 2.0 + input.instancePosition.x * 0.1) * 0.2;
                let heightFactor = input.position.y / 3.0;
                rotatedPos.x += windOffset * heightFactor;
                
                // Apply scale and translation
                let worldPos = rotatedPos * input.scale + input.instancePosition;
                
                // Transform to clip space
                output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
                output.worldPos = worldPos;
                
                // Simple normal
                output.normal = vec3<f32>(0.0, 1.0, 0.0);
                
                // Biome-based grass color with variation
                // Base colors for different grass types
                let baseGreen = vec3<f32>(0.2, 0.6, 0.1);  // Forest grass
                let dryGrass = vec3<f32>(0.5, 0.5, 0.2);   // Dry/desert grass
                
                // Mix colors based on color variation (acts as biome indicator)
                let grassColor = mix(baseGreen, dryGrass, input.colorVariation);
                
                // Add some random variation per blade
                let variation = sin(input.instancePosition.x * 0.1 + input.instancePosition.z * 0.1) * 0.1;
                grassColor += vec3<f32>(variation * 0.1, variation * 0.2, variation * 0.05);
                
                // Make grass tips lighter/yellower
                let heightFactor = input.position.y / 3.0; // Assuming max height is 3
                grassColor = mix(grassColor, grassColor + vec3<f32>(0.2, 0.3, 0.0), heightFactor * 0.3);
                
                output.color = grassColor;
                output.alpha = 0.85;
                output.uv = input.uv;
                
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                // Alpha test for grass blade edges (simulate grass shape)
                let grassAlpha = input.alpha;
                if (input.uv.x < 0.1 || input.uv.x > 0.9) {
                    grassAlpha *= 0.3; // Make edges more transparent
                }
                
                // Simple lighting with ambient
                let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
                let ambient = 0.4;
                let diffuse = max(dot(input.normal, lightDir), 0.0) * 0.6;
                let lighting = ambient + diffuse;
                
                // Apply lighting to grass color
                let finalColor = input.color * lighting;
                
                // Add slight subsurface scattering effect for grass
                let subsurface = max(dot(-lightDir, input.normal), 0.0) * 0.2;
                finalColor += vec3<f32>(0.1, 0.3, 0.05) * subsurface;
                
                return vec4<f32>(finalColor, grassAlpha);
            }
        `;
    }

    /**
     * Create simple grass blade geometry
     */
    private createGrassGeometry(): void {
        const vertices: number[] = [];
        const indices: number[] = [];

        // Create a simple grass blade (two triangles forming a thin rectangle)
        const height = 2.5;
        const width = 0.15; // Thinner blades for more realistic look

        // Grass blade vertices (4 vertices for a quad)
        // Bottom left
        vertices.push(-width / 2, 0, 0); // position
        vertices.push(0, 0, 1); // normal
        vertices.push(0, 0); // uv

        // Bottom right
        vertices.push(width / 2, 0, 0); // position
        vertices.push(0, 0, 1); // normal
        vertices.push(1, 0); // uv

        // Top left
        vertices.push(-width / 2, height, 0); // position
        vertices.push(0, 0, 1); // normal
        vertices.push(0, 1); // uv

        // Top right
        vertices.push(width / 2, height, 0); // position
        vertices.push(0, 0, 1); // normal
        vertices.push(1, 1); // uv

        // Create indices for two triangles
        indices.push(0, 1, 2); // First triangle
        indices.push(1, 3, 2); // Second triangle

        // Create GPU buffers
        const vertexData = new Float32Array(vertices);
        const indexData = new Uint16Array(indices);

        const vertexBuffer = this.device.createBuffer({
            label: 'Grass Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: 'Grass Index Buffer',
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, indexData);

        this.grassGeometry = {
            vertexBuffer,
            indexBuffer,
            indexCount: indices.length,
        };

        console.log('SimpleGrassRenderer: Created grass geometry');
    }

    /**
     * Generate grass instances based on terrain bounds
     */
    public generateGrassInstances(
        terrainBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
        density: number = 5000
    ): void {
        const instances: GrassInstance[] = [];

        // Generate random grass positions within terrain bounds
        for (let i = 0; i < Math.min(density, this.maxInstances); i++) {
            const x =
                terrainBounds.minX + Math.random() * (terrainBounds.maxX - terrainBounds.minX);
            const z =
                terrainBounds.minZ + Math.random() * (terrainBounds.maxZ - terrainBounds.minZ);
            const y = 0; // Assume grass grows at ground level

            // Determine biome type based on position (simple noise-based approach)
            const biomeNoise = (Math.sin(x * 0.01) + Math.cos(z * 0.01)) * 0.5 + 0.5;
            const colorVariation = Math.random() * 0.3 + biomeNoise * 0.7; // 0.0 = green, 1.0 = dry

            instances.push({
                position: new Vector3(x, y, z),
                scale: 0.3 + Math.random() * 0.8, // Random scale between 0.3 and 1.1
                rotation: Math.random() * Math.PI * 2, // Random rotation
                colorVariation: colorVariation,
            });
        }

        this.updateInstances(instances);
    }

    /**
     * Update grass instances
     */
    public updateInstances(grassBlades: GrassInstance[]): void {
        if (!this.instanceBuffer) return;

        const instanceData = new Float32Array(grassBlades.length * 8); // 32 bytes / 4 = 8 floats
        let offset = 0;

        for (const grass of grassBlades) {
            // Position
            instanceData[offset++] = grass.position.x;
            instanceData[offset++] = grass.position.y;
            instanceData[offset++] = grass.position.z;
            // Scale
            instanceData[offset++] = grass.scale;
            // Rotation
            instanceData[offset++] = grass.rotation;
            // Color variation
            instanceData[offset++] = grass.colorVariation || 0.0;
            // Padding
            offset += 2;
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);
        this.instanceCount = grassBlades.length;

        console.log(`SimpleGrassRenderer: Updated ${grassBlades.length} grass instances`);
    }

    /**
     * Render grass
     */
    public render(renderPass: GPURenderPassEncoder, camera: Camera, time: number): void {
        if (!this.pipeline || !this.grassGeometry || this.instanceCount === 0) {
            return;
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
            console.error('SimpleGrassRenderer: Error getting camera position:', e);
            cameraPos = { x: 0, y: 100, z: 0 }; // Fallback position
        }

        // Safety check for camera position
        if (!cameraPos || typeof cameraPos.x === 'undefined') {
            console.error('SimpleGrassRenderer: Camera position is invalid, using fallback');
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
        renderPass.setVertexBuffer(0, this.grassGeometry.vertexBuffer);
        renderPass.setVertexBuffer(1, this.instanceBuffer!);
        renderPass.setIndexBuffer(this.grassGeometry.indexBuffer, 'uint16');
        renderPass.drawIndexed(this.grassGeometry.indexCount, this.instanceCount);
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        if (this.grassGeometry) {
            this.grassGeometry.vertexBuffer.destroy();
            this.grassGeometry.indexBuffer.destroy();
        }
        if (this.instanceBuffer) {
            this.instanceBuffer.destroy();
        }
        this.uniformBuffer.destroy();
    }
}
