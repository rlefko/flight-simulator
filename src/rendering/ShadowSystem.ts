import { Camera } from './Camera';
import { Vector3, Matrix4 } from '../core/math';

/**
 * Shadow cascade configuration
 */
export interface ShadowCascade {
    near: number;
    far: number;
    lightMatrix: Matrix4;
    shadowMap: GPUTexture;
    depthTexture: GPUTexture;
    renderPassDescriptor: GPURenderPassDescriptor;
}

/**
 * Shadow rendering configuration
 */
export interface ShadowConfig {
    resolution: number;
    cascadeCount: number;
    cascadeDistances: number[];
    biasConstant: number;
    biasSlope: number;
    softShadowRadius: number;
    maxDistance: number;
}

/**
 * Light source for shadow casting
 */
export interface DirectionalLight {
    direction: Vector3;
    color: Vector3;
    intensity: number;
    castShadows: boolean;
}

/**
 * Shadow rendering statistics
 */
export interface ShadowStats {
    shadowMapsGenerated: number;
    shadowMapResolution: number;
    cascadesUsed: number;
    renderTime: number;
    memoryUsage: number;
}

/**
 * Cascaded Shadow Map system for large-scale terrain rendering
 */
export class ShadowSystem {
    private device: GPUDevice;
    private shadowConfig: ShadowConfig;
    private cascades: ShadowCascade[] = [];
    private shadowMapRenderPipeline: GPURenderPipeline | null = null;
    private shadowBindGroupLayout: GPUBindGroupLayout;
    private shadowPipelineLayout: GPUPipelineLayout;
    private shadowUniformBuffer: GPUBuffer;
    private shadowSampler: GPUSampler;
    private shadowComparisonSampler: GPUSampler;

    private directionalLight: DirectionalLight;
    private stats: ShadowStats;

    constructor(device: GPUDevice, config?: Partial<ShadowConfig>) {
        this.device = device;

        // Default shadow configuration
        this.shadowConfig = {
            resolution: 2048,
            cascadeCount: 4,
            cascadeDistances: [100, 500, 2000, 10000], // Distances in meters
            biasConstant: 0.005,
            biasSlope: 2.0,
            softShadowRadius: 1.0,
            maxDistance: 50000,
            ...config,
        };

        this.directionalLight = {
            direction: new Vector3(0.3, -0.8, 0.5).normalize(),
            color: new Vector3(1.0, 0.95, 0.8),
            intensity: 1.0,
            castShadows: true,
        };

        this.stats = {
            shadowMapsGenerated: 0,
            shadowMapResolution: this.shadowConfig.resolution,
            cascadesUsed: this.shadowConfig.cascadeCount,
            renderTime: 0,
            memoryUsage: 0,
        };

        this.createShadowResources();
        this.createShadowPipeline();
        this.initializeCascades();
    }

    /**
     * Create shadow mapping resources
     */
    private createShadowResources(): void {
        // Create bind group layout for shadow rendering
        this.shadowBindGroupLayout = this.device.createBindGroupLayout({
            label: 'Shadow Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        this.shadowPipelineLayout = this.device.createPipelineLayout({
            label: 'Shadow Pipeline Layout',
            bindGroupLayouts: [this.shadowBindGroupLayout],
        });

        // Create uniform buffer for shadow matrices
        // Light matrix (64 bytes) per cascade
        const bufferSize = 64 * this.shadowConfig.cascadeCount;
        this.shadowUniformBuffer = this.device.createBuffer({
            label: 'Shadow Uniform Buffer',
            size: Math.max(256, bufferSize), // Ensure minimum alignment
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create shadow map sampler
        this.shadowSampler = this.device.createSampler({
            label: 'Shadow Map Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // Create comparison sampler for PCF
        this.shadowComparisonSampler = this.device.createSampler({
            label: 'Shadow Comparison Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            compare: 'less',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
    }

    /**
     * Create shadow map generation pipeline
     */
    private createShadowPipeline(): void {
        const shadowShaderModule = this.device.createShaderModule({
            label: 'Shadow Map Shader',
            code: `
                struct ShadowUniforms {
                    lightMatrix: mat4x4<f32>,
                };
                
                @group(0) @binding(0) var<uniform> shadowUniforms: ShadowUniforms;
                
                struct VertexInput {
                    @location(0) position: vec3<f32>,
                };
                
                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                };
                
                @vertex
                fn vs_shadow(input: VertexInput) -> VertexOutput {
                    var output: VertexOutput;
                    output.position = shadowUniforms.lightMatrix * vec4<f32>(input.position, 1.0);
                    return output;
                }
                
                @fragment
                fn fs_shadow() -> @location(0) vec4<f32> {
                    // Depth is automatically written to the depth buffer
                    return vec4<f32>(1.0);
                }
            `,
        });

        this.shadowMapRenderPipeline = this.device.createRenderPipeline({
            label: 'Shadow Map Render Pipeline',
            layout: this.shadowPipelineLayout,
            vertex: {
                module: shadowShaderModule,
                entryPoint: 'vs_shadow',
                buffers: [
                    {
                        arrayStride: 12, // 3 floats for position
                        attributes: [
                            {
                                format: 'float32x3',
                                offset: 0,
                                shaderLocation: 0, // position
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: shadowShaderModule,
                entryPoint: 'fs_shadow',
                targets: [], // No color output, depth only
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'front', // Front-face culling for shadow mapping
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth32float',
            },
        });
    }

    /**
     * Initialize shadow cascade data
     */
    private initializeCascades(): void {
        this.cascades = [];

        for (let i = 0; i < this.shadowConfig.cascadeCount; i++) {
            const shadowMap = this.device.createTexture({
                label: `Shadow Map Cascade ${i}`,
                size: [this.shadowConfig.resolution, this.shadowConfig.resolution, 1],
                format: 'depth32float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });

            const depthTexture = this.device.createTexture({
                label: `Shadow Depth Texture Cascade ${i}`,
                size: [this.shadowConfig.resolution, this.shadowConfig.resolution, 1],
                format: 'depth32float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });

            const renderPassDescriptor: GPURenderPassDescriptor = {
                label: `Shadow Render Pass Cascade ${i}`,
                colorAttachments: [],
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            };

            const cascade: ShadowCascade = {
                near: i === 0 ? 0.1 : this.shadowConfig.cascadeDistances[i - 1],
                far: this.shadowConfig.cascadeDistances[i],
                lightMatrix: new Matrix4(),
                shadowMap,
                depthTexture,
                renderPassDescriptor,
            };

            this.cascades.push(cascade);
        }

        this.stats.memoryUsage =
            this.cascades.length *
            (this.shadowConfig.resolution * this.shadowConfig.resolution * 4); // 4 bytes per depth pixel
    }

    /**
     * Update shadow cascades based on camera view
     */
    public updateCascades(camera: Camera, lightDirection?: Vector3): void {
        if (lightDirection) {
            this.directionalLight.direction = lightDirection.clone().normalize();
        }

        const cameraPosition = camera.getPosition();
        const cameraForward = camera.getForward();
        const cameraUp = camera.getUp();
        const cameraRight = camera.getRight();

        // Update each cascade
        for (let i = 0; i < this.cascades.length; i++) {
            const cascade = this.cascades[i];

            // Calculate frustum corners for this cascade
            const frustumCorners = this.calculateFrustumCorners(camera, cascade.near, cascade.far);

            // Calculate light-space bounding box
            const lightView = this.calculateLightViewMatrix();
            const lightProjection = this.calculateLightProjectionMatrix(frustumCorners, lightView);

            // Combine into light space matrix
            cascade.lightMatrix = new Matrix4().multiplyMatrices(lightProjection, lightView);

            // Update shadow map render pass to use the shadow map as depth attachment
            cascade.renderPassDescriptor.depthStencilAttachment = {
                view: cascade.shadowMap.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            };
        }

        // Update uniform buffer with light matrices
        this.updateShadowUniforms();
    }

    /**
     * Calculate frustum corners for cascade bounds
     */
    private calculateFrustumCorners(camera: Camera, near: number, far: number): Vector3[] {
        const corners: Vector3[] = [];
        const cameraPosition = camera.getPosition();
        const cameraForward = camera.getForward();
        const cameraUp = camera.getUp();
        const cameraRight = camera.getRight();

        const config = camera.getConfiguration();
        const fov = config.fov;
        const aspect = config.aspectRatio;

        const tanHalfFov = Math.tan(fov * 0.5);
        const nearHeight = 2.0 * tanHalfFov * near;
        const farHeight = 2.0 * tanHalfFov * far;
        const nearWidth = nearHeight * aspect;
        const farWidth = farHeight * aspect;

        const nearCenter = cameraPosition.clone().add(cameraForward.clone().multiplyScalar(near));
        const farCenter = cameraPosition.clone().add(cameraForward.clone().multiplyScalar(far));

        // Near plane corners
        corners.push(
            nearCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(nearHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(nearWidth * 0.5))
        );
        corners.push(
            nearCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(nearHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(-nearWidth * 0.5))
        );
        corners.push(
            nearCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(-nearHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(nearWidth * 0.5))
        );
        corners.push(
            nearCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(-nearHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(-nearWidth * 0.5))
        );

        // Far plane corners
        corners.push(
            farCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(farHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(farWidth * 0.5))
        );
        corners.push(
            farCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(farHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(-farWidth * 0.5))
        );
        corners.push(
            farCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(-farHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(farWidth * 0.5))
        );
        corners.push(
            farCenter
                .clone()
                .add(cameraUp.clone().multiplyScalar(-farHeight * 0.5))
                .add(cameraRight.clone().multiplyScalar(-farWidth * 0.5))
        );

        return corners;
    }

    /**
     * Calculate light view matrix
     */
    private calculateLightViewMatrix(): Matrix4 {
        const lightDirection = this.directionalLight.direction;
        const up = Math.abs(lightDirection.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);

        return new Matrix4().lookAt(new Vector3(0, 0, 0), lightDirection, up);
    }

    /**
     * Calculate light projection matrix for frustum corners
     */
    private calculateLightProjectionMatrix(corners: Vector3[], lightView: Matrix4): Matrix4 {
        // Transform corners to light space
        const lightSpaceCorners = corners.map((corner) => {
            const lightSpaceCorner = corner.clone().applyMatrix4(lightView);
            return lightSpaceCorner;
        });

        // Find bounding box in light space
        let minX = Infinity,
            maxX = -Infinity;
        let minY = Infinity,
            maxY = -Infinity;
        let minZ = Infinity,
            maxZ = -Infinity;

        for (const corner of lightSpaceCorners) {
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
            minZ = Math.min(minZ, corner.z);
            maxZ = Math.max(maxZ, corner.z);
        }

        // Extend Z range for shadow casters outside frustum
        const zExtension = (maxZ - minZ) * 2.0;
        minZ -= zExtension;

        return new Matrix4().makeOrthographic(minX, maxX, minY, maxY, minZ, maxZ);
    }

    /**
     * Update shadow uniform buffer
     */
    private updateShadowUniforms(): void {
        const uniformData = new Float32Array(16 * this.cascades.length);

        for (let i = 0; i < this.cascades.length; i++) {
            const cascade = this.cascades[i];
            uniformData.set(cascade.lightMatrix.elements, i * 16);
        }

        this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, uniformData);
    }

    /**
     * Render shadow maps for all cascades
     */
    public renderShadowMaps(
        commandEncoder: GPUCommandEncoder,
        renderCallback: (renderPass: GPURenderPassEncoder, cascadeIndex: number) => void
    ): void {
        if (!this.shadowMapRenderPipeline || !this.directionalLight.castShadows) {
            return;
        }

        const startTime = performance.now();

        for (let i = 0; i < this.cascades.length; i++) {
            const cascade = this.cascades[i];

            const renderPass = commandEncoder.beginRenderPass(cascade.renderPassDescriptor);
            renderPass.setPipeline(this.shadowMapRenderPipeline);

            // Create bind group for this cascade
            const shadowBindGroup = this.device.createBindGroup({
                layout: this.shadowBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: this.shadowUniformBuffer,
                            offset: i * 64, // 64 bytes per matrix
                            size: 64,
                        },
                    },
                ],
            });

            renderPass.setBindGroup(0, shadowBindGroup);

            // Let the caller render shadow-casting geometry
            renderCallback(renderPass, i);

            renderPass.end();
        }

        this.stats.shadowMapsGenerated = this.cascades.length;
        this.stats.renderTime = performance.now() - startTime;
    }

    /**
     * Get shadow map textures for shader binding
     */
    public getShadowMaps(): GPUTexture[] {
        return this.cascades.map((cascade) => cascade.shadowMap);
    }

    /**
     * Get shadow comparison sampler
     */
    public getShadowSampler(): GPUSampler {
        return this.shadowComparisonSampler;
    }

    /**
     * Get shadow configuration
     */
    public getConfig(): ShadowConfig {
        return { ...this.shadowConfig };
    }

    /**
     * Get directional light settings
     */
    public getLight(): DirectionalLight {
        return { ...this.directionalLight };
    }

    /**
     * Get cascade information
     */
    public getCascades(): Readonly<ShadowCascade[]> {
        return this.cascades;
    }

    /**
     * Get shadow rendering statistics
     */
    public getStats(): ShadowStats {
        return { ...this.stats };
    }

    /**
     * Update light direction
     */
    public setLightDirection(direction: Vector3): void {
        this.directionalLight.direction = direction.clone().normalize();
    }

    /**
     * Update light color and intensity
     */
    public setLightColor(color: Vector3, intensity: number): void {
        this.directionalLight.color = color.clone();
        this.directionalLight.intensity = intensity;
    }

    /**
     * Enable or disable shadow casting
     */
    public setShadowsEnabled(enabled: boolean): void {
        this.directionalLight.castShadows = enabled;
    }

    /**
     * Destroy shadow system resources
     */
    public destroy(): void {
        this.shadowUniformBuffer.destroy();

        for (const cascade of this.cascades) {
            cascade.shadowMap.destroy();
            cascade.depthTexture.destroy();
        }

        this.cascades = [];
    }
}
