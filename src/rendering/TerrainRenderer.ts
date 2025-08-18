import { TerrainTile } from '../world/TerrainTile';
import { Camera } from './Camera';
import { Vector3, Matrix4 } from '../core/math';

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
                    // Simple green color for debugging - make terrain always visible
                    var color = vec3<f32>(0.2, 0.6, 0.2); // Green
                    
                    // Add some height variation for visibility
                    let heightFactor = clamp(input.worldPos.y / 500.0, 0.0, 1.0);
                    color = mix(vec3<f32>(0.1, 0.4, 0.1), vec3<f32>(0.4, 0.8, 0.4), heightFactor);
                    
                    // Simple lighting
                    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
                    let NdotL = max(dot(input.normal, lightDir), 0.0);
                    let ambient = 0.4;
                    let diffuse = 0.6 * NdotL;
                    let lighting = ambient + diffuse;
                    
                    // Apply fog based on distance
                    let distance = length(uniforms.cameraPosition - input.worldPos);
                    let fogStart = 10000.0;  // 10km
                    let fogEnd = 50000.0;    // 50km
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

        // Create a unique uniform buffer for this tile
        const uniformBuffer = this.device.createBuffer({
            label: `Terrain Uniform Buffer ${tile.id}`,
            size: 256, // Same size as the shared uniform buffer
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create bind group for this tile with its own uniform buffer
        const bindGroup = this.device.createBindGroup({
            label: `Terrain Bind Group ${tile.id}`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer,
                    },
                },
            ],
        });

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
        time: number
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
