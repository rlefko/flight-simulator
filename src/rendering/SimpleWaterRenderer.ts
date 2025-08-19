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
                
                // Simple transformation - no wave displacement
                output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                output.worldPos = input.position;
                output.normal = vec3<f32>(0.0, 1.0, 0.0); // Always point up for water
                output.uv = input.uv;
                
                // Calculate depth for shading
                let viewPos = uniforms.viewMatrix * vec4<f32>(input.position, 1.0);
                output.depth = -viewPos.z;
                
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                // Enhanced water colors - more vibrant and realistic
                let shallowColor = vec3<f32>(0.4, 0.8, 1.0); // Bright turquoise
                let deepColor = vec3<f32>(0.1, 0.3, 0.6);    // Deep ocean blue
                
                // Depth-based color mixing with better falloff
                let depthFactor = clamp(input.depth * 0.005, 0.0, 1.0);
                var waterColor = mix(shallowColor, deepColor, depthFactor);
                
                // Add animated wave patterns
                let waveOffset1 = sin(input.uv.x * 20.0 + uniforms.time * 2.0) * 0.1;
                let waveOffset2 = cos(input.uv.y * 15.0 + uniforms.time * 1.5) * 0.1;
                let waveIntensity = waveOffset1 + waveOffset2;
                
                // Enhance color with wave effects
                waterColor += vec3<f32>(0.1, 0.15, 0.2) * waveIntensity;
                
                // Improved lighting with sun reflection
                let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
                let ndotl = max(dot(input.normal, lightDir), 0.4); // Higher ambient
                
                // Add specular highlights for sun reflection on water
                let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
                let reflectDir = reflect(-lightDir, input.normal);
                let specular = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * 0.5;
                
                // Fresnel effect for realistic water transparency
                let fresnel = pow(1.0 - max(dot(viewDir, input.normal), 0.0), 2.0);
                let alpha = mix(0.7, 0.95, fresnel); // More transparent when looking straight down
                
                // Final color with enhanced lighting and specular
                let finalColor = waterColor * ndotl + vec3<f32>(1.0, 1.0, 0.9) * specular;
                
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
            `SimpleWaterRenderer: Created mesh for surface ${surface.id} with ${vertices.length / 8} vertices`
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
                center: new Vector3(0, 0, 0),
                bounds: { minX: -50000, maxX: 50000, minZ: -50000, maxZ: 50000 }, // Much larger ocean
                type: 'ocean',
                depth: 50,
                area: 10000000000, // Updated area
                windDirection: new Vector3(1, 0, 0),
                waveHeight: 0.5,
                currentStrength: 0.1,
                foamDensity: 0.1,
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
