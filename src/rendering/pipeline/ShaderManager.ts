interface ShaderModuleCache {
    [key: string]: GPUShaderModule;
}

interface ShaderSource {
    vertex: string;
    fragment: string;
    compute?: string;
}

export interface ShaderBindingInfo {
    group: number;
    binding: number;
    type: 'uniform' | 'texture' | 'sampler' | 'storage';
    name: string;
}

export interface ShaderInfo {
    bindings: ShaderBindingInfo[];
    workgroupSize?: [number, number, number];
}

export class ShaderManager {
    private device: GPUDevice | null = null;
    private shaderCache: ShaderModuleCache = {};
    private shaderInfo: Map<string, ShaderInfo> = new Map();
    private includeResolver: Map<string, string> = new Map();

    async initialize(device: GPUDevice): Promise<void> {
        this.device = device;
        await this.loadBuiltinShaders();
        this.setupIncludeResolver();
    }

    private async loadBuiltinShaders(): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');

        // Load basic geometry pass shader
        const basicShaderSource = await this.loadShaderSource('/src/rendering/shaders/basic.wgsl');
        const basicModule = this.device.createShaderModule({
            label: 'Basic Shader Module',
            code: basicShaderSource,
        });

        this.shaderCache['basic'] = basicModule;
        this.shaderInfo.set('basic', {
            bindings: [
                { group: 0, binding: 0, type: 'uniform', name: 'camera' },
                { group: 1, binding: 0, type: 'uniform', name: 'model' },
                { group: 2, binding: 0, type: 'uniform', name: 'material' },
                { group: 2, binding: 1, type: 'texture', name: 'albedoTexture' },
                { group: 2, binding: 2, type: 'texture', name: 'normalTexture' },
                { group: 2, binding: 3, type: 'texture', name: 'metallicRoughnessTexture' },
                { group: 2, binding: 4, type: 'texture', name: 'occlusionTexture' },
                { group: 2, binding: 5, type: 'texture', name: 'emissiveTexture' },
                { group: 2, binding: 6, type: 'sampler', name: 'materialSampler' },
            ],
        });

        // Load deferred lighting shader
        const lightingShaderSource = await this.loadShaderSource(
            '/src/rendering/shaders/lighting.wgsl'
        );
        const lightingModule = this.device.createShaderModule({
            label: 'Lighting Shader Module',
            code: lightingShaderSource,
        });

        this.shaderCache['lighting'] = lightingModule;
        this.shaderInfo.set('lighting', {
            bindings: [
                { group: 0, binding: 0, type: 'uniform', name: 'camera' },
                { group: 0, binding: 1, type: 'uniform', name: 'lighting' },
                { group: 1, binding: 0, type: 'texture', name: 'gBufferAlbedo' },
                { group: 1, binding: 1, type: 'texture', name: 'gBufferNormal' },
                { group: 1, binding: 2, type: 'texture', name: 'gBufferMotion' },
                { group: 1, binding: 3, type: 'texture', name: 'gBufferMaterial' },
                { group: 1, binding: 4, type: 'texture', name: 'depthTexture' },
                { group: 1, binding: 5, type: 'sampler', name: 'gBufferSampler' },
                { group: 2, binding: 0, type: 'texture', name: 'skyboxTexture' },
                { group: 2, binding: 1, type: 'sampler', name: 'skyboxSampler' },
                { group: 3, binding: 0, type: 'texture', name: 'shadowMap' },
                { group: 3, binding: 1, type: 'sampler', name: 'shadowSampler' },
            ],
        });

        // Load vegetation shader
        const vegetationShaderSource = await this.loadShaderSource(
            '/src/rendering/shaders/vegetation.wgsl'
        );
        const vegetationModule = this.device.createShaderModule({
            label: 'Vegetation Shader Module',
            code: vegetationShaderSource,
        });

        this.shaderCache['vegetation'] = vegetationModule;
        this.shaderInfo.set('vegetation', {
            bindings: [
                { group: 0, binding: 0, type: 'uniform', name: 'camera' },
                { group: 0, binding: 1, type: 'uniform', name: 'wind' },
                { group: 0, binding: 2, type: 'texture', name: 'textureAtlas' },
                { group: 0, binding: 3, type: 'sampler', name: 'textureSampler' },
            ],
        });
    }

    private setupIncludeResolver(): void {
        // Common shader includes for reusability
        this.includeResolver.set(
            'common.wgsl',
            `
            // Common constants and utility functions
            const PI: f32 = 3.14159265359;
            const TWO_PI: f32 = 6.28318530718;
            const HALF_PI: f32 = 1.57079632679;
            const INV_PI: f32 = 0.31830988618;
            
            fn luminance(color: vec3<f32>) -> f32 {
                return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
            }
            
            fn linearToSRGB(linear: vec3<f32>) -> vec3<f32> {
                return pow(linear, vec3<f32>(1.0 / 2.2));
            }
            
            fn sRGBToLinear(srgb: vec3<f32>) -> vec3<f32> {
                return pow(srgb, vec3<f32>(2.2));
            }
        `
        );

        this.includeResolver.set(
            'atmosphere.wgsl',
            `
            // Atmospheric scattering functions
            struct AtmosphereParams {
                rayleighScale: f32,
                mieScale: f32,
                sunIntensity: f32,
                planetRadius: f32,
                atmosphereRadius: f32,
            }
            
            fn rayleighPhase(cosTheta: f32) -> f32 {
                return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
            }
            
            fn miePhase(cosTheta: f32, g: f32) -> f32 {
                let g2 = g * g;
                let denom = 1.0 + g2 - 2.0 * g * cosTheta;
                return (3.0 * (1.0 - g2)) / (2.0 * (2.0 + g2)) * (1.0 + cosTheta * cosTheta) / pow(denom, 1.5);
            }
        `
        );
    }

    private async loadShaderSource(path: string): Promise<string> {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load shader: ${path}`);
            }
            let source = await response.text();

            // Process includes
            source = this.processIncludes(source);

            return source;
        } catch (error) {
            console.error(`Error loading shader from ${path}:`, error);
            throw error;
        }
    }

    private processIncludes(source: string): string {
        const includeRegex = /#include\s+"([^"]+)"/g;

        return source.replace(includeRegex, (match, includePath) => {
            const includeContent = this.includeResolver.get(includePath);
            if (!includeContent) {
                console.warn(`Include not found: ${includePath}`);
                return match;
            }
            return includeContent;
        });
    }

    async loadShader(name: string, source: ShaderSource): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');

        // Create vertex shader module
        const vertexModule = this.device.createShaderModule({
            label: `${name} Vertex Shader`,
            code: this.processIncludes(source.vertex),
        });

        // Create fragment shader module
        const fragmentModule = this.device.createShaderModule({
            label: `${name} Fragment Shader`,
            code: this.processIncludes(source.fragment),
        });

        // Store modules
        this.shaderCache[`${name}_vertex`] = vertexModule;
        this.shaderCache[`${name}_fragment`] = fragmentModule;

        // Create compute shader module if provided
        if (source.compute) {
            const computeModule = this.device.createShaderModule({
                label: `${name} Compute Shader`,
                code: this.processIncludes(source.compute),
            });
            this.shaderCache[`${name}_compute`] = computeModule;
        }

        // Parse shader bindings from source
        const bindings = this.parseShaderBindings(source.vertex + '\n' + source.fragment);
        this.shaderInfo.set(name, { bindings });
    }

    private parseShaderBindings(source: string): ShaderBindingInfo[] {
        const bindings: ShaderBindingInfo[] = [];

        // Regex patterns for different binding types
        const uniformRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var<uniform>\s+(\w+):/g;
        const textureRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var\s+(\w+):\s+texture_/g;
        const samplerRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var\s+(\w+):\s+sampler/g;
        const storageRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var<storage/g;

        let match;

        // Parse uniform buffers
        while ((match = uniformRegex.exec(source)) !== null) {
            bindings.push({
                group: parseInt(match[1]),
                binding: parseInt(match[2]),
                type: 'uniform',
                name: match[3],
            });
        }

        // Parse textures
        while ((match = textureRegex.exec(source)) !== null) {
            bindings.push({
                group: parseInt(match[1]),
                binding: parseInt(match[2]),
                type: 'texture',
                name: match[3],
            });
        }

        // Parse samplers
        while ((match = samplerRegex.exec(source)) !== null) {
            bindings.push({
                group: parseInt(match[1]),
                binding: parseInt(match[2]),
                type: 'sampler',
                name: match[3],
            });
        }

        // Parse storage buffers
        while ((match = storageRegex.exec(source)) !== null) {
            bindings.push({
                group: parseInt(match[1]),
                binding: parseInt(match[2]),
                type: 'storage',
                name: 'storageBuffer', // Default name
            });
        }

        return bindings.sort((a, b) => {
            if (a.group !== b.group) return a.group - b.group;
            return a.binding - b.binding;
        });
    }

    getShaderModule(name: string): GPUShaderModule {
        const module = this.shaderCache[name];
        if (!module) {
            throw new Error(`Shader module not found: ${name}`);
        }
        return module;
    }

    getShaderInfo(name: string): ShaderInfo | undefined {
        return this.shaderInfo.get(name);
    }

    hasShader(name: string): boolean {
        return this.shaderCache.hasOwnProperty(name);
    }

    async reloadShader(name: string): Promise<void> {
        // Remove from cache
        delete this.shaderCache[name];
        delete this.shaderCache[`${name}_vertex`];
        delete this.shaderCache[`${name}_fragment`];
        delete this.shaderCache[`${name}_compute`];
        this.shaderInfo.delete(name);

        // Reload built-in shaders
        if (name === 'basic' || name === 'lighting') {
            await this.loadBuiltinShaders();
        }
    }

    createRenderPipeline(config: {
        vertex: string;
        fragment: string;
        layout: GPUPipelineLayout;
        targets: GPUColorTargetState[];
        depthStencil?: GPUDepthStencilState;
        primitive?: GPUPrimitiveState;
        multisample?: GPUMultisampleState;
        label?: string;
    }): GPURenderPipeline {
        if (!this.device) throw new Error('Device not initialized');

        const vertexModule = this.getShaderModule(config.vertex);
        const fragmentModule = this.getShaderModule(config.fragment);

        return this.device.createRenderPipeline({
            label: config.label || 'Render Pipeline',
            layout: config.layout,
            vertex: {
                module: vertexModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'fs_main',
                targets: config.targets,
            },
            depthStencil: config.depthStencil,
            primitive: config.primitive || {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            multisample: config.multisample,
        });
    }

    createComputePipeline(config: {
        compute: string;
        layout: GPUPipelineLayout;
        label?: string;
    }): GPUComputePipeline {
        if (!this.device) throw new Error('Device not initialized');

        const computeModule = this.getShaderModule(config.compute);

        return this.device.createComputePipeline({
            label: config.label || 'Compute Pipeline',
            layout: config.layout,
            compute: {
                module: computeModule,
                entryPoint: 'cs_main',
            },
        });
    }

    // Utility method to get all available shaders
    getAvailableShaders(): string[] {
        return Object.keys(this.shaderCache).filter((name) => !name.includes('_'));
    }

    // Shader validation and error reporting
    async validateShader(source: string): Promise<boolean> {
        if (!this.device) return false;

        try {
            const testModule = this.device.createShaderModule({
                code: this.processIncludes(source),
            });

            // Check for compilation errors
            const info = await testModule.getCompilationInfo();

            if (info.messages.length > 0) {
                console.warn('Shader compilation messages:', info.messages);
                return info.messages.every((msg) => msg.type !== 'error');
            }

            return true;
        } catch (error) {
            console.error('Shader validation error:', error);
            return false;
        }
    }

    destroy(): void {
        this.shaderCache = {};
        this.shaderInfo.clear();
        this.includeResolver.clear();
        this.device = null;
    }
}
