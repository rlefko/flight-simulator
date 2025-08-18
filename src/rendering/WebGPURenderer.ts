import { EventBus } from '../core/events/EventBus';
import { Matrix4, Vector3 } from '../core/math';
import { Camera } from './Camera';
import { RenderPipeline } from './pipeline/RenderPipeline';
import { ShaderManager } from './pipeline/ShaderManager';
import { UniformBufferManager } from './pipeline/UniformBufferManager';
import { WebGL2Fallback } from './WebGL2Fallback';

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
        try {
            await this.initializeWebGPU();
            await this.createRenderPipeline();
            this.isInitialized = true;
            this.eventBus.emit('renderer:initialized', { renderer: this });
        } catch (error) {
            console.error('Failed to initialize WebGPU renderer:', error);
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
        
        this.renderPipeline = new RenderPipeline(
            this.device,
            this.shaderManager,
            this.uniformBufferManager,
            this.colorFormat,
            this.depthFormat,
            this.qualitySettings,
            this.capabilities
        );
        
        await this.renderPipeline.initialize();
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
        
        try {
            // Update camera matrices
            this.camera.update(deltaTime);
            
            // Use WebGL2 fallback if WebGPU is not available
            if (this.webgl2Fallback) {
                this.webgl2Fallback.render(deltaTime, this.camera);
                const fallbackStats = this.webgl2Fallback.getRenderStats();
                this.renderStats.drawCalls = fallbackStats.drawCalls;
                this.renderStats.triangles = fallbackStats.triangles;
                this.renderStats.vertices = fallbackStats.vertices;
            } else if (this.device && this.renderPipeline && this.context) {
                // WebGPU rendering path
                const surfaceTexture = this.context.getCurrentTexture();
                
                const commandEncoder = this.device.createCommandEncoder({
                    label: 'Main Render Command Encoder',
                });
                
                this.renderPipeline.render(commandEncoder, surfaceTexture, this.camera);
                this.device.queue.submit([commandEncoder.finish()]);
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
    
    destroy(): void {
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