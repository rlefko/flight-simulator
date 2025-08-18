import { EventBus } from '../core/events/EventBus';
import { Matrix4, Vector3 } from '../core/math';
import { Camera } from './Camera';
import { RenderPipeline } from './pipeline/RenderPipeline';
import { ShaderManager } from './pipeline/ShaderManager';
import { UniformBufferManager } from './pipeline/UniformBufferManager';
import { WebGL2Fallback } from './WebGL2Fallback';
import { TerrainRenderer } from './TerrainRenderer';
import { TerrainTile } from '../world/TerrainTile';

export interface WebGPURenderingCapabilities {
    maxTextureSize: number;
    maxBindGroups: number;
    maxBindingsPerBindGroup: number;
    maxBufferSize: number;
    maxComputeWorkgroupSizeX: number;
    supportedTextureFormats: GPUTextureFormat[];
    supportsTimestampQueries: boolean;
    supportsComputeShaders: boolean;
}

export interface RenderStats {
    frameTime: number;
    renderTime: number;
    drawCalls: number;
    triangles: number;
    vertices: number;
    memoryUsage: {
        textures: number;
        buffers: number;
        total: number;
    };
}

export interface QualitySettings {
    shadowMapSize: number;
    msaaSamples: number;
    anisotropicFiltering: number;
    tessellationLevel: number;
    lodBias: number;
    enablePostProcessing: boolean;
    enableVolumetricFog: boolean;
    enableSSR: boolean;
    enableSSAO: boolean;
}

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private adapter: GPUAdapter | null = null;
    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private colorFormat: GPUTextureFormat = 'rgba8unorm';
    private depthFormat: GPUTextureFormat = 'depth24plus-stencil8';

    private shaderManager: ShaderManager;
    private uniformBufferManager: UniformBufferManager;
    private renderPipeline: RenderPipeline | null = null;
    private webgl2Fallback: WebGL2Fallback | null = null;

    private camera: Camera;
    private eventBus: EventBus;

    private capabilities: WebGPURenderingCapabilities | null = null;
    private qualitySettings: QualitySettings;
    private renderStats: RenderStats;

    private isInitialized = false;
    private frameStartTime = 0;
    private frameCount = 0;
    private lastStatsUpdate = 0;

    // Test geometry
    private testTriangleBuffer: GPUBuffer | null = null;
    private testPipeline: GPURenderPipeline | null = null;

    // Terrain rendering
    private terrainRenderer: TerrainRenderer | null = null;
    private depthTexture: GPUTexture | null = null;
    private depthTextureView: GPUTextureView | null = null;
    private terrainTiles: TerrainTile[] = [];

    constructor(canvas: HTMLCanvasElement, eventBus: EventBus) {
        this.canvas = canvas;
        this.eventBus = eventBus;
        this.camera = new Camera(canvas.width / canvas.height);
        this.shaderManager = new ShaderManager();
        this.uniformBufferManager = new UniformBufferManager();

        // Default quality settings
        this.qualitySettings = {
            shadowMapSize: 2048,
            msaaSamples: 4,
            anisotropicFiltering: 16,
            tessellationLevel: 8,
            lodBias: 0,
            enablePostProcessing: true,
            enableVolumetricFog: true,
            enableSSR: true,
            enableSSAO: true,
        };

        this.renderStats = {
            frameTime: 0,
            renderTime: 0,
            drawCalls: 0,
            triangles: 0,
            vertices: 0,
            memoryUsage: {
                textures: 0,
                buffers: 0,
                total: 0,
            },
        };

        this.setupEventListeners();
    }

    async initialize(): Promise<void> {
        console.log('WebGPURenderer.initialize() called');
        console.log('Canvas dimensions:', this.canvas.width, 'x', this.canvas.height);

        try {
            // Check for WebGPU support
            if (!navigator.gpu) {
                console.warn('WebGPU not supported, falling back to WebGL2');
                await this.initializeWebGLFallback();
                return;
            }

            console.log('Attempting WebGPU initialization...');
            await this.initializeWebGPU();
            console.log('WebGPU initialized successfully');

            // Skip complex render pipeline for now
            // await this.createRenderPipeline();

            this.isInitialized = true;
            this.eventBus.emit('renderer:initialized', { renderer: this });
            console.log('WebGPU renderer ready');
        } catch (error) {
            console.error('Failed to initialize WebGPU renderer:', error);
            console.log('Attempting WebGL2 fallback...');
            await this.initializeWebGLFallback();
        }
    }

    private async initializeWebGPU(): Promise<void> {
        // Check WebGPU support
        if (!navigator.gpu) {
            throw new Error('WebGPU not supported');
        }

        // Request adapter
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
            forceFallbackAdapter: false,
        });

        if (!this.adapter) {
            throw new Error('Failed to get WebGPU adapter');
        }

        // Get device features and limits
        const features = Array.from(this.adapter.features);
        const limits = this.adapter.limits;

        console.log('WebGPU Adapter Info:', {
            vendor: this.adapter.info?.vendor || 'Unknown',
            architecture: this.adapter.info?.architecture || 'Unknown',
            device: this.adapter.info?.device || 'Unknown',
            features,
            limits: {
                maxBindGroups: limits.maxBindGroups,
                maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
                maxBufferSize: limits.maxBufferSize,
                maxTextureSize: limits.maxTextureDimension2D,
            },
        });

        // Request device with required features
        const requiredFeatures: GPUFeatureName[] = [];
        if (features.includes('timestamp-query')) {
            requiredFeatures.push('timestamp-query');
        }
        if (features.includes('texture-compression-bc')) {
            requiredFeatures.push('texture-compression-bc');
        }
        if (features.includes('depth-clip-control')) {
            requiredFeatures.push('depth-clip-control');
        }

        this.device = await this.adapter.requestDevice({
            requiredFeatures,
            requiredLimits: {
                maxBindGroups: Math.min(8, limits.maxBindGroups),
                maxBindingsPerBindGroup: Math.min(64, limits.maxBindingsPerBindGroup),
                maxBufferSize: Math.min(256 * 1024 * 1024, limits.maxBufferSize), // 256MB
            },
        });

        // Set up error handling
        this.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU uncaptured error:', event.error);
            this.eventBus.emit('renderer:error', { error: event.error });
        });

        this.device.lost.then((info) => {
            console.error('WebGPU device lost:', info);
            this.eventBus.emit('renderer:device-lost', { info });
        });

        // Configure canvas context
        this.context = this.canvas.getContext('webgpu');
        if (!this.context) {
            throw new Error('Failed to get WebGPU context');
        }

        // Determine optimal format
        this.colorFormat = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.colorFormat,
            alphaMode: 'opaque',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Initialize capabilities
        this.capabilities = {
            maxTextureSize: limits.maxTextureDimension2D,
            maxBindGroups: limits.maxBindGroups,
            maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
            maxBufferSize: limits.maxBufferSize,
            maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
            supportedTextureFormats: this.getSupportedTextureFormats(),
            supportsTimestampQueries: features.includes('timestamp-query'),
            supportsComputeShaders: true, // WebGPU always supports compute
        };

        // Initialize managers
        await this.shaderManager.initialize(this.device);
        this.uniformBufferManager.initialize(this.device);

        // Create terrain renderer
        this.terrainRenderer = new TerrainRenderer(this.device);

        // Create depth texture for 3D rendering
        this.createDepthTexture();

        // Create test triangle for debugging
        this.createTestTriangle();
    }

    private async initializeWebGLFallback(): Promise<void> {
        console.warn('Falling back to WebGL2');

        this.webgl2Fallback = new WebGL2Fallback(this.canvas, this.eventBus);

        try {
            await this.webgl2Fallback.initialize();
            this.isInitialized = true;

            // Set fallback capabilities
            const fallbackCaps = this.webgl2Fallback.getCapabilities();
            if (fallbackCaps) {
                this.capabilities = {
                    maxTextureSize: fallbackCaps.maxTextureSize,
                    maxBindGroups: 4, // WebGL2 limitation
                    maxBindingsPerBindGroup: 16, // WebGL2 limitation
                    maxBufferSize: 256 * 1024 * 1024, // 256MB limit
                    maxComputeWorkgroupSizeX: 0, // No compute shaders
                    supportedTextureFormats: ['rgba8unorm', 'depth24plus'],
                    supportsTimestampQueries: false,
                    supportsComputeShaders: false,
                };
            }

            this.eventBus.emit('renderer:fallback-initialized', { renderer: this });
        } catch (error) {
            console.error('WebGL2 fallback initialization failed:', error);
            throw new Error('No suitable graphics API available');
        }
    }

    private getSupportedTextureFormats(): GPUTextureFormat[] {
        const formats: GPUTextureFormat[] = [
            'rgba8unorm',
            'rgba8unorm-srgb',
            'bgra8unorm',
            'rgba16float',
            'rgba32float',
            'depth32float',
            'depth24plus',
            'depth24plus-stencil8',
        ];

        // Add compression formats if supported
        if (this.adapter?.features.has('texture-compression-bc')) {
            formats.push('bc1-rgba-unorm', 'bc3-rgba-unorm', 'bc5-rg-unorm');
        }
        if (this.adapter?.features.has('texture-compression-astc')) {
            formats.push('astc-4x4-unorm');
        }

        return formats;
    }

    private async createRenderPipeline(): Promise<void> {
        if (!this.device || !this.capabilities) {
            throw new Error('Device not initialized');
        }

        // Skip complex pipeline creation for now to avoid hanging
        console.log('Skipping complex render pipeline creation for debugging');

        // Just create a simple clear pass for now
        this.isInitialized = true;
    }

    private setupEventListeners(): void {
        // Handle canvas resize
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target === this.canvas) {
                    this.resize(entry.contentRect.width, entry.contentRect.height);
                }
            }
        });
        resizeObserver.observe(this.canvas);

        // Handle quality settings changes
        this.eventBus.on('renderer:quality-changed', (settings: Partial<QualitySettings>) => {
            this.setQualitySettings(settings);
        });

        // Handle camera updates
        this.eventBus.on('camera:update', (data: { position: Vector3; target: Vector3 }) => {
            this.camera.setPosition(data.position);
            this.camera.setTarget(data.target);
        });
    }

    resize(width: number, height: number): void {
        if (!this.isInitialized) return;

        this.canvas.width = width;
        this.canvas.height = height;
        this.camera.setAspectRatio(width / height);

        if (this.webgl2Fallback) {
            this.webgl2Fallback.resize(width, height);
        } else if (this.renderPipeline) {
            this.renderPipeline.resize(width, height);
        }

        this.eventBus.emit('renderer:resized', { width, height });
    }

    setQualitySettings(settings: Partial<QualitySettings>): void {
        this.qualitySettings = { ...this.qualitySettings, ...settings };

        if (this.renderPipeline) {
            this.renderPipeline.updateQualitySettings(this.qualitySettings);
        }
    }

    render(deltaTime: number): void {
        if (!this.isInitialized) {
            return;
        }

        this.frameStartTime = performance.now();

        // Reset render stats for this frame
        this.renderStats.drawCalls = 0;
        this.renderStats.triangles = 0;
        this.renderStats.vertices = 0;

        this.frameCount++;

        try {
            // Update camera matrices
            this.camera.update(deltaTime);

            // Use WebGL2 fallback if WebGPU is not available
            if (this.webgl2Fallback) {
                // Log once that we're using WebGL2
                if (this.frameCount === 0) {
                    console.log('Rendering with WebGL2 fallback');
                }
                this.webgl2Fallback.render(deltaTime, this.camera);
                const fallbackStats = this.webgl2Fallback.getRenderStats();
                if (fallbackStats) {
                    this.renderStats.drawCalls = fallbackStats.drawCalls;
                    this.renderStats.triangles = fallbackStats.triangles;
                    this.renderStats.vertices = fallbackStats.vertices;
                }
            } else if (this.device && this.context) {
                // Log once that we're using WebGPU
                if (this.frameCount === 0) {
                    console.log('Rendering with WebGPU');
                }
                // Simple WebGPU clear and test triangle
                try {
                    const surfaceTexture = this.context.getCurrentTexture();

                    // Check if texture is valid
                    if (surfaceTexture.width === 0 || surfaceTexture.height === 0) {
                        console.warn('Invalid surface texture dimensions');
                        return;
                    }

                    const textureView = surfaceTexture.createView();

                    // Create a simple test triangle if not already created
                    if (!this.testTriangleBuffer) {
                        this.createTestTriangle();
                    }

                    const commandEncoder = this.device.createCommandEncoder({
                        label: 'Main Render Command Encoder',
                    });

                    // Ensure depth texture matches canvas size
                    if (
                        !this.depthTexture ||
                        this.depthTexture.width !== surfaceTexture.width ||
                        this.depthTexture.height !== surfaceTexture.height
                    ) {
                        this.createDepthTexture();
                    }

                    const renderPass = commandEncoder.beginRenderPass({
                        label: 'Main Render Pass',
                        colorAttachments: [
                            {
                                view: textureView,
                                clearValue: { r: 0.5, g: 0.7, b: 0.9, a: 1.0 }, // Sky blue color
                                loadOp: 'clear',
                                storeOp: 'store',
                            },
                        ],
                        depthStencilAttachment: this.depthTextureView
                            ? {
                                  view: this.depthTextureView,
                                  depthClearValue: 1.0,
                                  depthLoadOp: 'clear',
                                  depthStoreOp: 'store',
                              }
                            : undefined,
                    });

                    // Render terrain if available
                    if (this.terrainRenderer && this.terrainTiles.length > 0) {
                        this.terrainRenderer.render(
                            renderPass,
                            this.terrainTiles,
                            this.camera,
                            performance.now() / 1000
                        );
                    } else if (this.testPipeline && this.testTriangleBuffer) {
                        // Fallback to test triangle if no terrain
                        renderPass.setPipeline(this.testPipeline);
                        renderPass.setVertexBuffer(0, this.testTriangleBuffer);
                        renderPass.draw(3);
                    }

                    renderPass.end();

                    const commandBuffer = commandEncoder.finish();
                    this.device.queue.submit([commandBuffer]);
                } catch (error) {
                    console.error('WebGPU render error:', error);
                    // Fall back to 2D canvas on WebGPU error
                    const ctx = this.canvas.getContext('2d');
                    if (ctx) {
                        ctx.fillStyle = '#3366AA';
                        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    }
                }
            } else {
                // Fallback to canvas 2D clear if nothing else works
                if (this.frameCount === 0) {
                    console.log('Using 2D canvas fallback (no WebGPU device or context)');
                    console.log('Device:', !!this.device, 'Context:', !!this.context);
                    console.log('isInitialized:', this.isInitialized);
                }
                const ctx = this.canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = '#3366AA';
                    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    // Draw a test shape to verify 2D rendering works
                    ctx.fillStyle = '#FF0000';
                    ctx.fillRect(100, 100, 200, 200);
                    // Add text to confirm rendering
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = '24px Arial';
                    ctx.fillText('2D Canvas Fallback Active', 50, 50);
                }
            }
        } catch (error) {
            console.error('Render error:', error);
            this.eventBus.emit('renderer:error', { error });
        }

        // Update performance stats
        this.updateRenderStats();
    }

    private updateRenderStats(): void {
        const now = performance.now();
        this.renderStats.frameTime = now - this.frameStartTime;
        this.renderStats.renderTime = this.renderStats.frameTime; // Simplified for now
        this.frameCount++;

        // Update stats every second
        if (now - this.lastStatsUpdate >= 1000) {
            const fps = this.frameCount / ((now - this.lastStatsUpdate) / 1000);
            this.eventBus.emit('renderer:stats', {
                fps,
                ...this.renderStats,
            });

            this.frameCount = 0;
            this.lastStatsUpdate = now;
        }
    }

    getCapabilities(): WebGPURenderingCapabilities | null {
        return this.capabilities;
    }

    getQualitySettings(): QualitySettings {
        return { ...this.qualitySettings };
    }

    getRenderStats(): RenderStats {
        return { ...this.renderStats };
    }

    getCamera(): Camera {
        return this.camera;
    }

    private createTestTriangle(): void {
        if (!this.device) return;

        // Create vertex buffer with a simple triangle
        const vertices = new Float32Array([
            // x, y, z, r, g, b
            0.0,
            0.5,
            0.0,
            1.0,
            0.0,
            0.0, // Top vertex (red)
            -0.5,
            -0.5,
            0.0,
            0.0,
            1.0,
            0.0, // Bottom left (green)
            0.5,
            -0.5,
            0.0,
            0.0,
            0.0,
            1.0, // Bottom right (blue)
        ]);

        this.testTriangleBuffer = this.device.createBuffer({
            label: 'Test Triangle Vertex Buffer',
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(this.testTriangleBuffer, 0, vertices);

        // Create simple shader module
        const shaderModule = this.device.createShaderModule({
            label: 'Test Triangle Shader',
            code: `
                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                    @location(0) color: vec3<f32>,
                };
                
                @vertex
                fn vs_main(
                    @location(0) position: vec3<f32>,
                    @location(1) color: vec3<f32>
                ) -> VertexOutput {
                    var output: VertexOutput;
                    output.position = vec4<f32>(position, 1.0);
                    output.color = color;
                    return output;
                }
                
                @fragment
                fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                    return vec4<f32>(input.color, 1.0);
                }
            `,
        });

        // Create pipeline
        this.testPipeline = this.device.createRenderPipeline({
            label: 'Test Triangle Pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 24, // 6 floats * 4 bytes
                        attributes: [
                            {
                                format: 'float32x3',
                                offset: 0,
                                shaderLocation: 0, // position
                            },
                            {
                                format: 'float32x3',
                                offset: 12,
                                shaderLocation: 1, // color
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
                        format: this.colorFormat,
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        console.log('Test triangle created successfully');
    }

    private createDepthTexture(): void {
        if (!this.device || !this.canvas) return;

        // Destroy old depth texture if it exists
        if (this.depthTexture) {
            this.depthTexture.destroy();
        }

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.depthTextureView = this.depthTexture.createView();
    }

    public setTerrainTiles(tiles: TerrainTile[]): void {
        this.terrainTiles = tiles;
    }

    destroy(): void {
        if (this.testTriangleBuffer) {
            this.testTriangleBuffer.destroy();
            this.testTriangleBuffer = null;
        }

        if (this.depthTexture) {
            this.depthTexture.destroy();
            this.depthTexture = null;
        }

        if (this.terrainRenderer) {
            this.terrainRenderer.destroy();
            this.terrainRenderer = null;
        }

        if (this.webgl2Fallback) {
            this.webgl2Fallback.destroy();
            this.webgl2Fallback = null;
        }

        if (this.renderPipeline) {
            this.renderPipeline.destroy();
        }

        this.uniformBufferManager.destroy();
        this.shaderManager.destroy();

        if (this.device) {
            this.device.destroy();
        }

        this.isInitialized = false;
        this.eventBus.emit('renderer:destroyed');
    }
}
