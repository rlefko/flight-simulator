import { Camera } from './Camera';
import { Matrix4, Vector3 } from '../core/math';

interface TreeInstance {
    position: Vector3;
    scale: number;
    rotation: number;
}

/**
 * Simplified vegetation renderer for stable rendering
 */
export class SimpleVegetationRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout;
    private uniformBuffer: GPUBuffer;
    private treeGeometry: {
        vertexBuffer: GPUBuffer;
        indexBuffer: GPUBuffer;
        indexCount: number;
    } | null = null;
    private instanceBuffer: GPUBuffer | null = null;
    private instanceCount: number = 0;
    private maxInstances: number = 20000; // Increased to handle more trees

    constructor(device: GPUDevice) {
        this.device = device;

        // Create bind group layout
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Simple Vegetation Bind Group Layout',
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
            label: 'Simple Vegetation Uniform Buffer',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create instance buffer
        this.instanceBuffer = device.createBuffer({
            label: 'Vegetation Instance Buffer',
            size: this.maxInstances * 32, // position(12) + scale(4) + rotation(4) + padding(12) = 32 bytes
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Initialize the vegetation pipeline
     */
    public async initialize(): Promise<void> {
        // Create tree geometry
        this.createTreeGeometry();

        // Load shader
        const shaderCode = this.getShaderCode();
        const shaderModule = this.device.createShaderModule({
            label: 'Simple Vegetation Shader',
            code: shaderCode,
        });

        // Create pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Simple Vegetation Pipeline',
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
                            { format: 'float32x2', offset: 24, shaderLocation: 2 }, // uv/color
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
                count: 4,
            },
        });

        console.log('SimpleVegetationRenderer: Pipeline initialized');
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
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) color: vec3<f32>,
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
                
                // Apply scale and translation
                let worldPos = rotatedPos * input.scale + input.instancePosition;
                
                // Transform to clip space
                output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
                output.worldPos = worldPos;
                
                // Rotate normal
                output.normal = normalize(vec3<f32>(
                    input.normal.x * cosRot - input.normal.z * sinRot,
                    input.normal.y,
                    input.normal.x * sinRot + input.normal.z * cosRot
                ));
                
                // Simple tree coloring
                let heightFactor = clamp(input.position.y / 50.0, 0.0, 1.0);
                
                // Create simple green gradient
                let baseColor = vec3<f32>(0.2, 0.5, 0.1);
                let topColor = vec3<f32>(0.3, 0.7, 0.2);
                output.color = mix(baseColor, topColor, heightFactor);
                
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                // Simple lighting
                let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
                let ndotl = max(dot(input.normal, lightDir), 0.3);
                
                // Apply lighting
                let finalColor = input.color * ndotl;
                
                return vec4<f32>(finalColor, 1.0);
            }
        `;
    }

    /**
     * Create simple tree geometry (pyramid/cone shape)
     */
    private createTreeGeometry(): void {
        const vertices: number[] = [];
        const indices: number[] = [];

        // Create a simple cone - made much larger and more detailed
        const height = 50.0; // Increased from 20.0 for better visibility
        const radius = 8.0; // Increased from 3.0 for better visibility
        const segments = 12; // Increased from 8 for smoother appearance

        // Add top vertex
        vertices.push(0, height, 0); // position
        vertices.push(0, 1, 0); // normal (up)
        vertices.push(0.5, 1.0); // uv

        // Add base vertices
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            vertices.push(x, 0, z); // position
            vertices.push(x / radius, 0, z / radius); // normal (outward)
            vertices.push(i / segments, 0); // uv
        }

        // Add base center
        vertices.push(0, 0, 0); // position
        vertices.push(0, -1, 0); // normal (down)
        vertices.push(0.5, 0.5); // uv

        // Create side faces
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(0, i + 1, next + 1); // Top to base edge
        }

        // Create base
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(segments + 1, next + 1, i + 1); // Base triangles
        }

        // Create GPU buffers
        const vertexData = new Float32Array(vertices);
        const indexData = new Uint16Array(indices);

        const vertexBuffer = this.device.createBuffer({
            label: 'Tree Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: 'Tree Index Buffer',
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, indexData);

        this.treeGeometry = {
            vertexBuffer,
            indexBuffer,
            indexCount: indices.length,
        };

        console.log('SimpleVegetationRenderer: Created tree geometry');
    }

    /**
     * Update tree instances
     */
    public updateInstances(trees: TreeInstance[]): void {
        if (!this.instanceBuffer) return;

        // Limit instances to prevent buffer overflow
        const instancesToRender = Math.min(trees.length, this.maxInstances);
        if (trees.length > this.maxInstances) {
            console.warn(
                `SimpleVegetationRenderer: Limiting trees from ${trees.length} to ${this.maxInstances}`
            );
        }

        const instanceData = new Float32Array(instancesToRender * 8); // 32 bytes / 4 = 8 floats
        let offset = 0;

        for (let i = 0; i < instancesToRender; i++) {
            const tree = trees[i];
            // Position
            instanceData[offset++] = tree.position.x;
            instanceData[offset++] = tree.position.y;
            instanceData[offset++] = tree.position.z;
            // Scale
            instanceData[offset++] = tree.scale;
            // Rotation
            instanceData[offset++] = tree.rotation;
            // Padding
            offset += 3;
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);
        this.instanceCount = instancesToRender;

        console.log(`SimpleVegetationRenderer: Updated ${instancesToRender} tree instances`);
    }

    /**
     * Render vegetation
     */
    public render(renderPass: GPURenderPassEncoder, camera: Camera, time: number): void {
        if (!this.pipeline || !this.treeGeometry || this.instanceCount === 0) {
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
            console.error('SimpleVegetationRenderer: Error getting camera position:', e);
            cameraPos = { x: 0, y: 100, z: 0 }; // Fallback position
        }

        // Safety check for camera position
        if (!cameraPos || typeof cameraPos.x === 'undefined') {
            console.error('SimpleVegetationRenderer: Camera position is invalid, using fallback');
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
        renderPass.setVertexBuffer(0, this.treeGeometry.vertexBuffer);
        renderPass.setVertexBuffer(1, this.instanceBuffer!);
        renderPass.setIndexBuffer(this.treeGeometry.indexBuffer, 'uint16');
        renderPass.drawIndexed(this.treeGeometry.indexCount, this.instanceCount);
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        if (this.treeGeometry) {
            this.treeGeometry.vertexBuffer.destroy();
            this.treeGeometry.indexBuffer.destroy();
        }
        if (this.instanceBuffer) {
            this.instanceBuffer.destroy();
        }
        this.uniformBuffer.destroy();
    }
}
