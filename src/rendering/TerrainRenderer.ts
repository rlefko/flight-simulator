import { TerrainTile } from '../world/TerrainTile';
import { Camera } from './Camera';
import { Vector3, Matrix4 } from '../core/math';

interface TerrainMeshData {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    bindGroup: GPUBindGroup;
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
            ],
        });

        this.pipelineLayout = device.createPipelineLayout({
            label: 'Terrain Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Create uniform buffer for matrices
        this.uniformBuffer = device.createBuffer({
            label: 'Terrain Uniform Buffer',
            size: 256, // Enough for MVP matrix and other uniforms
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.createPipeline();
    }

    private createPipeline(): void {
        const shaderModule = this.device.createShaderModule({
            label: 'Terrain Shader Module',
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
                
                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                    @location(0) worldPos: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                    @location(2) uv: vec2<f32>,
                    @location(3) height: f32,
                };
                
                @vertex
                fn vs_main(input: VertexInput) -> VertexOutput {
                    var output: VertexOutput;
                    
                    let worldPos = (uniforms.modelMatrix * vec4<f32>(input.position, 1.0)).xyz;
                    output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                    output.worldPos = worldPos;
                    output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                    output.uv = input.uv;
                    output.height = input.position.y;
                    
                    return output;
                }
                
                @fragment
                fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                    // Simple height-based coloring for now
                    let minHeight = -100.0;
                    let maxHeight = 500.0;
                    let normalizedHeight = clamp((input.height - minHeight) / (maxHeight - minHeight), 0.0, 1.0);
                    
                    // Terrain color gradient
                    var color: vec3<f32>;
                    if (normalizedHeight < 0.2) {
                        // Water/Beach (blue to sand)
                        let t = normalizedHeight / 0.2;
                        color = mix(vec3<f32>(0.1, 0.3, 0.6), vec3<f32>(0.9, 0.8, 0.6), t);
                    } else if (normalizedHeight < 0.5) {
                        // Grass (sand to green)
                        let t = (normalizedHeight - 0.2) / 0.3;
                        color = mix(vec3<f32>(0.9, 0.8, 0.6), vec3<f32>(0.2, 0.6, 0.2), t);
                    } else if (normalizedHeight < 0.8) {
                        // Forest (green to brown)
                        let t = (normalizedHeight - 0.5) / 0.3;
                        color = mix(vec3<f32>(0.2, 0.6, 0.2), vec3<f32>(0.4, 0.3, 0.2), t);
                    } else {
                        // Snow (brown to white)
                        let t = (normalizedHeight - 0.8) / 0.2;
                        color = mix(vec3<f32>(0.4, 0.3, 0.2), vec3<f32>(0.95, 0.95, 1.0), t);
                    }
                    
                    // Simple lighting
                    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
                    let NdotL = max(dot(input.normal, lightDir), 0.0);
                    let ambient = 0.3;
                    let diffuse = 0.7 * NdotL;
                    let lighting = ambient + diffuse;
                    
                    // Apply fog based on distance
                    let distance = length(uniforms.cameraPosition - input.worldPos);
                    let fogStart = 5000.0;
                    let fogEnd = 20000.0;
                    let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
                    let fogColor = vec3<f32>(0.7, 0.8, 0.9);
                    
                    color = mix(fogColor, color * lighting, fogFactor);
                    
                    return vec4<f32>(color, 1.0);
                }
            `,
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'Terrain Render Pipeline',
            layout: this.pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
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
        });
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

        // Create bind group for this tile
        const bindGroup = this.device.createBindGroup({
            label: `Terrain Bind Group ${tile.id}`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.uniformBuffer,
                    },
                },
            ],
        });

        const terrainMeshData: TerrainMeshData = {
            vertexBuffer,
            indexBuffer,
            indexCount: meshData.indices.length,
            bindGroup,
        };

        this.meshCache.set(tile.id, terrainMeshData);
        return terrainMeshData;
    }

    public render(
        renderPass: GPURenderPassEncoder,
        tiles: TerrainTile[],
        camera: Camera,
        time: number
    ): void {
        if (!this.pipeline) return;

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

            if (!meshData) continue;

            // Create model matrix for this tile
            const modelMatrix = new Matrix4();
            modelMatrix.makeTranslation(tile.worldBounds.minX, 0, tile.worldBounds.minZ);

            // Calculate MVP matrix
            const mvpMatrix = new Matrix4()
                .multiplyMatrices(projectionMatrix, viewMatrix)
                .multiply(modelMatrix);

            // Calculate normal matrix
            const normalMatrix = modelMatrix.clone().invert().transpose();

            // Update uniform buffer
            const uniformData = new Float32Array(64 + 16 + 16 + 4); // MVP + Model + Normal + camera pos + time
            uniformData.set(mvpMatrix.elements, 0);
            uniformData.set(modelMatrix.elements, 16);
            uniformData.set(normalMatrix.elements, 32);
            uniformData.set([cameraPosition.x, cameraPosition.y, cameraPosition.z], 48);
            uniformData[51] = time;

            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

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

    public destroy(): void {
        this.uniformBuffer.destroy();
        for (const meshData of this.meshCache.values()) {
            meshData.vertexBuffer.destroy();
            meshData.indexBuffer.destroy();
        }
        this.meshCache.clear();
    }
}
