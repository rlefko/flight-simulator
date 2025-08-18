import { Matrix4, Vector3 } from '../../core/math';

interface UniformBuffer {
    buffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    layout: GPUBindGroupLayout;
    size: number;
    data: ArrayBuffer;
    isDirty: boolean;
    lastUpdateFrame: number;
}

interface UniformDescriptor {
    name: string;
    size: number;
    offset: number;
    type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'uint32' | 'int32';
}

// Standard uniform buffer layouts following WebGPU alignment rules
export const CameraUniformsLayout: UniformDescriptor[] = [
    { name: 'viewMatrix', type: 'mat4', size: 64, offset: 0 },
    { name: 'projectionMatrix', type: 'mat4', size: 64, offset: 64 },
    { name: 'viewProjectionMatrix', type: 'mat4', size: 64, offset: 128 },
    { name: 'cameraPosition', type: 'vec3', size: 12, offset: 192 },
    { name: 'padding1', type: 'float', size: 4, offset: 204 },
    { name: 'cameraDirection', type: 'vec3', size: 12, offset: 208 },
    { name: 'padding2', type: 'float', size: 4, offset: 220 },
    { name: 'nearFar', type: 'vec2', size: 8, offset: 224 },
    { name: 'viewport', type: 'vec2', size: 8, offset: 232 },
];

export const ModelUniformsLayout: UniformDescriptor[] = [
    { name: 'modelMatrix', type: 'mat4', size: 64, offset: 0 },
    { name: 'normalMatrix', type: 'mat4', size: 64, offset: 64 },
];

export const MaterialUniformsLayout: UniformDescriptor[] = [
    { name: 'albedo', type: 'vec4', size: 16, offset: 0 },
    { name: 'metallicRoughnessEmissive', type: 'vec4', size: 16, offset: 16 },
    { name: 'normalScale', type: 'float', size: 4, offset: 32 },
    { name: 'occlusionStrength', type: 'float', size: 4, offset: 36 },
    { name: 'alphaCutoff', type: 'float', size: 4, offset: 40 },
    { name: 'flags', type: 'uint32', size: 4, offset: 44 },
];

export const LightingUniformsLayout: UniformDescriptor[] = [
    { name: 'sunDirection', type: 'vec3', size: 12, offset: 0 },
    { name: 'sunIntensity', type: 'float', size: 4, offset: 12 },
    { name: 'sunColor', type: 'vec3', size: 12, offset: 16 },
    { name: 'ambientColor', type: 'float', size: 4, offset: 28 },
    { name: 'atmosphereColor', type: 'vec3', size: 12, offset: 32 },
    { name: 'time', type: 'float', size: 4, offset: 44 },
    { name: 'exposureCompensation', type: 'float', size: 4, offset: 48 },
    { name: 'gamma', type: 'float', size: 4, offset: 52 },
    { name: 'fogDensity', type: 'float', size: 4, offset: 56 },
    { name: 'fogColor', type: 'float', size: 4, offset: 60 },
];

export class UniformBufferManager {
    private device: GPUDevice | null = null;
    private buffers: Map<string, UniformBuffer> = new Map();
    private bindGroupLayouts: Map<string, GPUBindGroupLayout> = new Map();
    private frameCounter = 0;
    
    initialize(device: GPUDevice): void {
        this.device = device;
        this.createStandardLayouts();
    }
    
    private createStandardLayouts(): void {
        if (!this.device) throw new Error('Device not initialized');
        
        // Camera uniforms layout (group 0)
        this.bindGroupLayouts.set('camera', this.device.createBindGroupLayout({
            label: 'Camera Uniforms Layout',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    minBindingSize: this.calculateLayoutSize(CameraUniformsLayout),
                },
            }],
        }));
        
        // Model uniforms layout (group 1)
        this.bindGroupLayouts.set('model', this.device.createBindGroupLayout({
            label: 'Model Uniforms Layout',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    minBindingSize: this.calculateLayoutSize(ModelUniformsLayout),
                },
            }],
        }));
        
        // Material uniforms layout (group 2) - includes textures and samplers
        this.bindGroupLayouts.set('material', this.device.createBindGroupLayout({
            label: 'Material Uniforms Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: this.calculateLayoutSize(MaterialUniformsLayout),
                    },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {},
                },
            ],
        }));
        
        // Lighting uniforms layout
        this.bindGroupLayouts.set('lighting', this.device.createBindGroupLayout({
            label: 'Lighting Uniforms Layout',
            entries: [{
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    minBindingSize: this.calculateLayoutSize(LightingUniformsLayout),
                },
            }],
        }));
    }
    
    private calculateLayoutSize(layout: UniformDescriptor[]): number {
        if (layout.length === 0) return 0;
        const lastDescriptor = layout[layout.length - 1];
        return lastDescriptor.offset + lastDescriptor.size;
    }
    
    createUniformBuffer(
        name: string,
        layout: UniformDescriptor[],
        bindGroupLayout: GPUBindGroupLayout,
        initialData?: Record<string, any>
    ): void {
        if (!this.device) throw new Error('Device not initialized');
        
        const size = this.calculateLayoutSize(layout);
        const buffer = this.device.createBuffer({
            label: `${name} Uniform Buffer`,
            size: size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        const data = new ArrayBuffer(size);
        
        const bindGroup = this.device.createBindGroup({
            label: `${name} Bind Group`,
            layout: bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer,
                    offset: 0,
                    size,
                },
            }],
        });
        
        const uniformBuffer: UniformBuffer = {
            buffer,
            bindGroup,
            layout: bindGroupLayout,
            size,
            data,
            isDirty: true,
            lastUpdateFrame: -1,
        };
        
        this.buffers.set(name, uniformBuffer);
        
        // Set initial data if provided
        if (initialData) {
            this.updateUniformBuffer(name, layout, initialData);
        }
    }
    
    updateUniformBuffer(
        name: string,
        layout: UniformDescriptor[],
        data: Record<string, any>
    ): void {
        const uniformBuffer = this.buffers.get(name);
        if (!uniformBuffer) {
            console.error(`Uniform buffer not found: ${name}`);
            return;
        }
        
        let hasChanges = false;
        const dataView = new DataView(uniformBuffer.data);
        
        for (const descriptor of layout) {
            const value = data[descriptor.name];
            if (value === undefined) continue;
            
            const changed = this.writeUniformValue(dataView, descriptor, value);
            if (changed) hasChanges = true;
        }
        
        if (hasChanges) {
            uniformBuffer.isDirty = true;
        }
    }
    
    private writeUniformValue(
        dataView: DataView,
        descriptor: UniformDescriptor,
        value: any
    ): boolean {
        const offset = descriptor.offset;
        let changed = false;
        
        switch (descriptor.type) {
            case 'float':
                if (dataView.getFloat32(offset, true) !== value) {
                    dataView.setFloat32(offset, value, true);
                    changed = true;
                }
                break;
                
            case 'uint32':
                if (dataView.getUint32(offset, true) !== value) {
                    dataView.setUint32(offset, value, true);
                    changed = true;
                }
                break;
                
            case 'int32':
                if (dataView.getInt32(offset, true) !== value) {
                    dataView.setInt32(offset, value, true);
                    changed = true;
                }
                break;
                
            case 'vec2':
                if (Array.isArray(value) && value.length >= 2) {
                    const oldX = dataView.getFloat32(offset, true);
                    const oldY = dataView.getFloat32(offset + 4, true);
                    if (oldX !== value[0] || oldY !== value[1]) {
                        dataView.setFloat32(offset, value[0], true);
                        dataView.setFloat32(offset + 4, value[1], true);
                        changed = true;
                    }
                }
                break;
                
            case 'vec3':
                if (value instanceof Vector3) {
                    const oldX = dataView.getFloat32(offset, true);
                    const oldY = dataView.getFloat32(offset + 4, true);
                    const oldZ = dataView.getFloat32(offset + 8, true);
                    if (oldX !== value.x || oldY !== value.y || oldZ !== value.z) {
                        dataView.setFloat32(offset, value.x, true);
                        dataView.setFloat32(offset + 4, value.y, true);
                        dataView.setFloat32(offset + 8, value.z, true);
                        changed = true;
                    }
                } else if (Array.isArray(value) && value.length >= 3) {
                    const oldX = dataView.getFloat32(offset, true);
                    const oldY = dataView.getFloat32(offset + 4, true);
                    const oldZ = dataView.getFloat32(offset + 8, true);
                    if (oldX !== value[0] || oldY !== value[1] || oldZ !== value[2]) {
                        dataView.setFloat32(offset, value[0], true);
                        dataView.setFloat32(offset + 4, value[1], true);
                        dataView.setFloat32(offset + 8, value[2], true);
                        changed = true;
                    }
                }
                break;
                
            case 'vec4':
                if (Array.isArray(value) && value.length >= 4) {
                    let hasChanged = false;
                    for (let i = 0; i < 4; i++) {
                        const oldValue = dataView.getFloat32(offset + i * 4, true);
                        if (oldValue !== value[i]) {
                            dataView.setFloat32(offset + i * 4, value[i], true);
                            hasChanged = true;
                        }
                    }
                    changed = hasChanged;
                }
                break;
                
            case 'mat4':
                if (value instanceof Matrix4) {
                    const elements = value.elements;
                    let hasChanged = false;
                    for (let i = 0; i < 16; i++) {
                        const oldValue = dataView.getFloat32(offset + i * 4, true);
                        if (oldValue !== elements[i]) {
                            dataView.setFloat32(offset + i * 4, elements[i], true);
                            hasChanged = true;
                        }
                    }
                    changed = hasChanged;
                } else if (Array.isArray(value) && value.length >= 16) {
                    let hasChanged = false;
                    for (let i = 0; i < 16; i++) {
                        const oldValue = dataView.getFloat32(offset + i * 4, true);
                        if (oldValue !== value[i]) {
                            dataView.setFloat32(offset + i * 4, value[i], true);
                            hasChanged = true;
                        }
                    }
                    changed = hasChanged;
                }
                break;
        }
        
        return changed;
    }
    
    flushUpdates(): void {
        if (!this.device) return;
        
        for (const [name, uniformBuffer] of this.buffers) {
            if (uniformBuffer.isDirty && uniformBuffer.lastUpdateFrame !== this.frameCounter) {
                this.device.queue.writeBuffer(
                    uniformBuffer.buffer,
                    0,
                    uniformBuffer.data
                );
                
                uniformBuffer.isDirty = false;
                uniformBuffer.lastUpdateFrame = this.frameCounter;
            }
        }
        
        this.frameCounter++;
    }
    
    getBindGroup(name: string): GPUBindGroup | undefined {
        const buffer = this.buffers.get(name);
        return buffer?.bindGroup;
    }
    
    getBindGroupLayout(name: string): GPUBindGroupLayout | undefined {
        return this.bindGroupLayouts.get(name);
    }
    
    hasBuffer(name: string): boolean {
        return this.buffers.has(name);
    }
    
    // Standard uniform buffer creation methods
    createCameraUniforms(name = 'camera'): void {
        const layout = this.bindGroupLayouts.get('camera');
        if (!layout) throw new Error('Camera layout not found');
        
        this.createUniformBuffer(name, CameraUniformsLayout, layout, {
            viewMatrix: new Matrix4(),
            projectionMatrix: new Matrix4(),
            viewProjectionMatrix: new Matrix4(),
            cameraPosition: new Vector3(),
            cameraDirection: new Vector3(0, 0, -1),
            nearFar: [0.1, 1000],
            viewport: [1920, 1080],
        });
    }
    
    createModelUniforms(name: string): void {
        const layout = this.bindGroupLayouts.get('model');
        if (!layout) throw new Error('Model layout not found');
        
        this.createUniformBuffer(name, ModelUniformsLayout, layout, {
            modelMatrix: new Matrix4(),
            normalMatrix: new Matrix4(),
        });
    }
    
    createMaterialUniforms(name: string): void {
        const layout = this.bindGroupLayouts.get('material');
        if (!layout) throw new Error('Material layout not found');
        
        this.createUniformBuffer(name, MaterialUniformsLayout, layout, {
            albedo: [1, 1, 1, 1],
            metallicRoughnessEmissive: [0, 0.5, 0, 1],
            normalScale: 1.0,
            occlusionStrength: 1.0,
            alphaCutoff: 0.5,
            flags: 0,
        });
    }
    
    createLightingUniforms(name = 'lighting'): void {
        const layout = this.bindGroupLayouts.get('lighting');
        if (!layout) throw new Error('Lighting layout not found');
        
        this.createUniformBuffer(name, LightingUniformsLayout, layout, {
            sunDirection: new Vector3(0, -1, 0),
            sunIntensity: 3.0,
            sunColor: new Vector3(1, 1, 1),
            ambientColor: 0.1,
            atmosphereColor: new Vector3(0.5, 0.8, 1.0),
            time: 0,
            exposureCompensation: 0,
            gamma: 2.2,
            fogDensity: 0.0001,
            fogColor: 0,
        });
    }
    
    // Memory management
    destroyBuffer(name: string): void {
        const buffer = this.buffers.get(name);
        if (buffer) {
            buffer.buffer.destroy();
            this.buffers.delete(name);
        }
    }
    
    getMemoryUsage(): { totalSize: number; bufferCount: number } {
        let totalSize = 0;
        for (const buffer of this.buffers.values()) {
            totalSize += buffer.size;
        }
        return {
            totalSize,
            bufferCount: this.buffers.size,
        };
    }
    
    destroy(): void {
        for (const [name, buffer] of this.buffers) {
            buffer.buffer.destroy();
        }
        this.buffers.clear();
        this.bindGroupLayouts.clear();
        this.device = null;
    }
}