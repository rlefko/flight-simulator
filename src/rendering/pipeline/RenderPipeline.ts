import { Camera } from '../Camera';
import { ShaderManager } from './ShaderManager';
import { UniformBufferManager, CameraUniformsLayout, LightingUniformsLayout } from './UniformBufferManager';
import { WebGPURenderingCapabilities, QualitySettings } from '../WebGPURenderer';
import { Matrix4, Vector3 } from '../../core/math';

interface GBufferTextures {
    albedo: GPUTexture;        // RGB: albedo, A: metallic
    normal: GPUTexture;        // RG: packed normal, B: roughness, A: unused
    motion: GPUTexture;        // RG: motion vectors, BA: depth derivatives
    material: GPUTexture;      // R: occlusion, G: emissive, BA: custom
    depth: GPUTexture;         // Depth buffer
    
    // Texture views for sampling
    albedoView: GPUTextureView;
    normalView: GPUTextureView;
    motionView: GPUTextureView;
    materialView: GPUTextureView;
    depthView: GPUTextureView;
}

interface RenderPassConfig {
    label: string;
    colorTargets: (GPURenderPassColorAttachment | null)[];
    depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
    occlusionQuerySet?: GPUQuerySet;
    timestampWrites?: GPURenderPassTimestampWrites;
}

export class RenderPipeline {
    private device: GPUDevice;
    private shaderManager: ShaderManager;
    private uniformManager: UniformBufferManager;
    private colorFormat: GPUTextureFormat;
    private depthFormat: GPUTextureFormat;
    private qualitySettings: QualitySettings;
    private capabilities: WebGPURenderingCapabilities;
    
    // Render targets
    private gBufferTextures: GBufferTextures | null = null;
    private finalColorTexture: GPUTexture | null = null;
    private msaaTexture: GPUTexture | null = null;
    
    // Render pipelines
    private geometryPipeline: GPURenderPipeline | null = null;
    private lightingPipeline: GPURenderPipeline | null = null;
    
    // Bind group layouts
    private globalBindGroupLayout: GPUBindGroupLayout | null = null;
    private gBufferBindGroupLayout: GPUBindGroupLayout | null = null;
    private gBufferBindGroup: GPUBindGroup | null = null;
    
    // Samplers
    private linearSampler: GPUSampler | null = null;
    private nearestSampler: GPUSampler | null = null;
    
    // Current dimensions
    private width = 1920;
    private height = 1080;
    
    // Performance tracking
    private renderStats = {
        geometryPassTime: 0,
        lightingPassTime: 0,
        drawCalls: 0,
    };
    
    constructor(
        device: GPUDevice,
        shaderManager: ShaderManager,
        uniformManager: UniformBufferManager,
        colorFormat: GPUTextureFormat,
        depthFormat: GPUTextureFormat,
        qualitySettings: QualitySettings,
        capabilities: WebGPURenderingCapabilities
    ) {
        this.device = device;
        this.shaderManager = shaderManager;
        this.uniformManager = uniformManager;
        this.colorFormat = colorFormat;
        this.depthFormat = depthFormat;
        this.qualitySettings = qualitySettings;
        this.capabilities = capabilities;
    }
    
    async initialize(): Promise<void> {
        await this.createSamplers();
        await this.createBindGroupLayouts();
        await this.createGBufferTextures(this.width, this.height);
        await this.createRenderPipelines();
        this.createUniformBuffers();
    }
    
    private async createSamplers(): Promise<void> {
        this.linearSampler = this.device.createSampler({
            label: 'Linear Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            maxAnisotropy: this.qualitySettings.anisotropicFiltering,
        });
        
        this.nearestSampler = this.device.createSampler({
            label: 'Nearest Sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
    }
    
    private async createBindGroupLayouts(): Promise<void> {
        // Global uniforms layout (camera + lighting)
        this.globalBindGroupLayout = this.device.createBindGroupLayout({
            label: 'Global Uniforms Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });
        
        // G-buffer textures layout for deferred lighting
        this.gBufferBindGroupLayout = this.device.createBindGroupLayout({
            label: 'G-Buffer Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            ],
        });
    }
    
    private async createGBufferTextures(width: number, height: number): Promise<void> {
        // Destroy existing textures
        if (this.gBufferTextures) {
            this.gBufferTextures.albedo.destroy();
            this.gBufferTextures.normal.destroy();
            this.gBufferTextures.motion.destroy();
            this.gBufferTextures.material.destroy();
            this.gBufferTextures.depth.destroy();
        }
        
        if (this.finalColorTexture) {
            this.finalColorTexture.destroy();
        }
        
        if (this.msaaTexture) {
            this.msaaTexture.destroy();
        }
        
        // Create G-buffer textures
        const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        
        const albedoTexture = this.device.createTexture({
            label: 'G-Buffer Albedo',
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage,
        });
        
        const normalTexture = this.device.createTexture({
            label: 'G-Buffer Normal',
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage,
        });
        
        const motionTexture = this.device.createTexture({
            label: 'G-Buffer Motion',
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'rgba16float',
            usage,
        });
        
        const materialTexture = this.device.createTexture({
            label: 'G-Buffer Material',
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage,
        });
        
        const depthTexture = this.device.createTexture({
            label: 'Depth Buffer',
            size: { width, height, depthOrArrayLayers: 1 },
            format: this.depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        
        // Create final color target
        this.finalColorTexture = this.device.createTexture({
            label: 'Final Color Buffer',
            size: { width, height, depthOrArrayLayers: 1 },
            format: this.colorFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        
        // Create MSAA texture if enabled
        if (this.qualitySettings.msaaSamples > 1) {
            this.msaaTexture = this.device.createTexture({
                label: 'MSAA Color Buffer',
                size: { width, height, depthOrArrayLayers: 1 },
                format: this.colorFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                sampleCount: this.qualitySettings.msaaSamples,
            });
        }
        
        // Create texture views
        this.gBufferTextures = {
            albedo: albedoTexture,
            normal: normalTexture,
            motion: motionTexture,
            material: materialTexture,
            depth: depthTexture,
            albedoView: albedoTexture.createView(),
            normalView: normalTexture.createView(),
            motionView: motionTexture.createView(),
            materialView: materialTexture.createView(),
            depthView: depthTexture.createView(),
        };
        
        // Create G-buffer bind group for lighting pass
        if (this.gBufferBindGroupLayout) {
            this.gBufferBindGroup = this.device.createBindGroup({
                label: 'G-Buffer Bind Group',
                layout: this.gBufferBindGroupLayout,
                entries: [
                    { binding: 0, resource: this.gBufferTextures.albedoView },
                    { binding: 1, resource: this.gBufferTextures.normalView },
                    { binding: 2, resource: this.gBufferTextures.motionView },
                    { binding: 3, resource: this.gBufferTextures.materialView },
                    { binding: 4, resource: this.gBufferTextures.depthView },
                    { binding: 5, resource: this.nearestSampler },
                ],
            });
        }
    }
    
    private async createRenderPipelines(): Promise<void> {
        if (!this.globalBindGroupLayout || !this.gBufferBindGroupLayout) {
            throw new Error('Bind group layouts not created');
        }
        
        // Get model and material bind group layouts from uniform manager
        const modelLayout = this.uniformManager.getBindGroupLayout('model');
        const materialLayout = this.uniformManager.getBindGroupLayout('material');
        
        if (!modelLayout || !materialLayout) {
            throw new Error('Model or material bind group layouts not found');
        }
        
        // Create geometry pass pipeline layout
        const geometryPipelineLayout = this.device.createPipelineLayout({
            label: 'Geometry Pipeline Layout',
            bindGroupLayouts: [
                this.globalBindGroupLayout,
                modelLayout,
                materialLayout,
            ],
        });
        
        // Create geometry pass pipeline
        this.geometryPipeline = this.shaderManager.createRenderPipeline({
            vertex: 'basic',
            fragment: 'basic',
            layout: geometryPipelineLayout,
            targets: [
                { format: 'rgba8unorm' },  // Albedo + metallic
                { format: 'rgba8unorm' },  // Normal + roughness
                { format: 'rgba16float' }, // Motion + derivatives
                { format: 'rgba8unorm' },  // Material properties
            ],
            depthStencil: {
                format: this.depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            multisample: this.qualitySettings.msaaSamples > 1 ? {
                count: this.qualitySettings.msaaSamples,
                alphaToCoverageEnabled: true,
            } : undefined,
            label: 'Geometry Pass Pipeline',
        });
        
        // Create lighting pass pipeline layout
        const lightingPipelineLayout = this.device.createPipelineLayout({
            label: 'Lighting Pipeline Layout',
            bindGroupLayouts: [
                this.globalBindGroupLayout,
                this.gBufferBindGroupLayout,
            ],
        });
        
        // Create lighting pass pipeline (fullscreen quad)
        this.lightingPipeline = this.shaderManager.createRenderPipeline({
            vertex: 'lighting',
            fragment: 'lighting',
            layout: lightingPipelineLayout,
            targets: [{ format: this.colorFormat }],
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Fullscreen quad
                frontFace: 'ccw',
            },
            label: 'Lighting Pass Pipeline',
        });
    }
    
    private createUniformBuffers(): void {
        // Create standard uniform buffers
        this.uniformManager.createCameraUniforms('camera');
        this.uniformManager.createLightingUniforms('lighting');
        
        // Create global bind group with camera and lighting uniforms
        if (this.globalBindGroupLayout) {
            const cameraBindGroup = this.uniformManager.getBindGroup('camera');
            const lightingBindGroup = this.uniformManager.getBindGroup('lighting');
            
            if (cameraBindGroup && lightingBindGroup) {
                // Note: This is simplified - in practice we'd need to create a proper bind group
                // that combines camera and lighting uniforms into a single group
            }
        }
    }
    
    render(commandEncoder: GPUCommandEncoder, surfaceTexture: GPUTexture, camera: Camera): void {
        if (!this.gBufferTextures || !this.geometryPipeline || !this.lightingPipeline) {
            console.error('Render pipeline not properly initialized');
            return;
        }
        
        const startTime = performance.now();
        
        // Update camera uniforms
        this.updateCameraUniforms(camera);
        this.updateLightingUniforms();
        
        // Flush uniform buffer updates
        this.uniformManager.flushUpdates();
        
        // Geometry pass
        this.renderGeometryPass(commandEncoder);
        
        const geometryTime = performance.now();
        
        // Lighting pass
        this.renderLightingPass(commandEncoder, surfaceTexture);
        
        const endTime = performance.now();
        
        // Update performance stats
        this.renderStats.geometryPassTime = geometryTime - startTime;
        this.renderStats.lightingPassTime = endTime - geometryTime;
    }
    
    private updateCameraUniforms(camera: Camera): void {
        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix();
        const viewProjectionMatrix = camera.getViewProjectionMatrix();
        const position = camera.getPosition();
        const direction = camera.getForward();
        const config = camera.getConfiguration();
        
        this.uniformManager.updateUniformBuffer('camera', CameraUniformsLayout, {
            viewMatrix,
            projectionMatrix,
            viewProjectionMatrix,
            cameraPosition: position,
            cameraDirection: direction,
            nearFar: [config.near, config.far],
            viewport: [this.width, this.height],
        });
    }
    
    private updateLightingUniforms(): void {
        // Simplified lighting setup - in practice this would come from a lighting system
        const time = Date.now() / 1000;
        const sunAngle = (time * 0.1) % (Math.PI * 2);
        
        this.uniformManager.updateUniformBuffer('lighting', LightingUniformsLayout, {
            sunDirection: new Vector3(
                Math.sin(sunAngle) * 0.5,
                -Math.cos(sunAngle),
                0.3
            ).normalize(),
            sunIntensity: 3.0,
            sunColor: new Vector3(1.0, 0.95, 0.8),
            ambientColor: 0.1,
            atmosphereColor: new Vector3(0.5, 0.7, 1.0),
            time,
            exposureCompensation: 0,
            gamma: 2.2,
            fogDensity: 0.00005,
            fogColor: 0,
        });
    }
    
    private renderGeometryPass(commandEncoder: GPUCommandEncoder): void {
        if (!this.gBufferTextures || !this.geometryPipeline) return;
        
        const renderPassConfig: RenderPassConfig = {
            label: 'Geometry Pass',
            colorTargets: [
                {
                    view: this.gBufferTextures.albedoView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
                {
                    view: this.gBufferTextures.normalView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
                {
                    view: this.gBufferTextures.motionView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
                {
                    view: this.gBufferTextures.materialView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: this.gBufferTextures.depthView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };
        
        const geometryPass = commandEncoder.beginRenderPass(renderPassConfig);
        geometryPass.setPipeline(this.geometryPipeline);
        
        // TODO: Render scene objects here
        // This would involve:
        // 1. Setting bind groups for camera, model, and material uniforms
        // 2. Setting vertex/index buffers
        // 3. Drawing geometry with draw/drawIndexed calls
        
        // For now, just end the pass
        geometryPass.end();
        
        this.renderStats.drawCalls = 0; // Update when actual geometry is rendered
    }
    
    private renderLightingPass(commandEncoder: GPUCommandEncoder, surfaceTexture: GPUTexture): void {
        if (!this.lightingPipeline || !this.gBufferBindGroup) return;
        
        const lightingPassConfig: RenderPassConfig = {
            label: 'Lighting Pass',
            colorTargets: [
                {
                    view: surfaceTexture.createView(),
                    clearValue: [0, 0, 0, 1],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };
        
        const lightingPass = commandEncoder.beginRenderPass(lightingPassConfig);
        lightingPass.setPipeline(this.lightingPipeline);
        
        // Bind G-buffer textures
        lightingPass.setBindGroup(1, this.gBufferBindGroup);
        
        // Render fullscreen quad (no vertex buffer needed, generated in vertex shader)
        lightingPass.draw(3, 1, 0, 0);
        
        lightingPass.end();
        
        this.renderStats.drawCalls += 1;
    }
    
    resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;
        
        this.width = width;
        this.height = height;
        
        // Recreate G-buffer textures with new dimensions
        this.createGBufferTextures(width, height);
    }
    
    updateQualitySettings(settings: QualitySettings): void {
        const needsRecreation = 
            settings.msaaSamples !== this.qualitySettings.msaaSamples ||
            settings.shadowMapSize !== this.qualitySettings.shadowMapSize;
        
        this.qualitySettings = { ...settings };
        
        if (needsRecreation) {
            // Recreate pipelines and textures that depend on quality settings
            this.createGBufferTextures(this.width, this.height);
            this.createRenderPipelines();
        }
    }
    
    getRenderStats() {
        return { ...this.renderStats };
    }
    
    destroy(): void {
        // Destroy G-buffer textures
        if (this.gBufferTextures) {
            this.gBufferTextures.albedo.destroy();
            this.gBufferTextures.normal.destroy();
            this.gBufferTextures.motion.destroy();
            this.gBufferTextures.material.destroy();
            this.gBufferTextures.depth.destroy();
        }
        
        // Destroy other textures
        if (this.finalColorTexture) {
            this.finalColorTexture.destroy();
        }
        
        if (this.msaaTexture) {
            this.msaaTexture.destroy();
        }
        
        // Clear references
        this.geometryPipeline = null;
        this.lightingPipeline = null;
        this.gBufferTextures = null;
        this.gBufferBindGroup = null;
    }
}