import { EventBus } from '../core/events/EventBus';
import { Matrix4, Vector3 } from '../core/math';
import { Camera } from './Camera';

interface WebGL2Capabilities {
    maxTextureSize: number;
    maxTextureUnits: number;
    maxUniformBufferBindings: number;
    maxVertexAttributes: number;
    supportsFloatTextures: boolean;
    supportsDepthTextures: boolean;
    supportsInstancing: boolean;
    supportsVAO: boolean;
    extensions: string[];
}

interface WebGL2RenderStats {
    drawCalls: number;
    triangles: number;
    vertices: number;
    textureBinds: number;
    shaderSwitches: number;
}

export class WebGL2Fallback {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | null = null;
    private eventBus: EventBus;
    
    private capabilities: WebGL2Capabilities | null = null;
    private isInitialized = false;
    
    // Shader management
    private shaderPrograms: Map<string, WebGLProgram> = new Map();
    private currentProgram: WebGLProgram | null = null;
    
    // Buffer management
    private vertexArrays: Map<string, WebGLVertexArrayObject> = new Map();
    private buffers: Map<string, WebGLBuffer> = new Map();
    
    // Texture management
    private textures: Map<string, WebGLTexture> = new Map();
    private activeTextureUnit = 0;
    
    // Uniform management
    private uniformBuffers: Map<string, WebGLBuffer> = new Map();
    private uniformLocations: Map<string, Map<string, WebGLUniformLocation>> = new Map();
    
    // Framebuffer management
    private framebuffers: Map<string, WebGLFramebuffer> = new Map();
    
    // Render state
    private renderStats: WebGL2RenderStats = {
        drawCalls: 0,
        triangles: 0,
        vertices: 0,
        textureBinds: 0,
        shaderSwitches: 0,
    };
    
    constructor(canvas: HTMLCanvasElement, eventBus: EventBus) {
        this.canvas = canvas;
        this.eventBus = eventBus;
    }
    
    async initialize(): Promise<void> {
        try {
            this.initializeWebGL2();
            this.detectCapabilities();
            this.setupDefaultState();
            await this.createFallbackShaders();
            this.isInitialized = true;
            
            console.warn('WebGL2 fallback renderer initialized');
            this.eventBus.emit('fallback-renderer:initialized', { renderer: this });
            
        } catch (error) {
            console.error('Failed to initialize WebGL2 fallback:', error);
            throw new Error('WebGL2 fallback initialization failed');
        }
    }
    
    private initializeWebGL2(): void {
        const contextOptions: WebGLContextAttributes = {
            alpha: false,
            depth: true,
            stencil: true,
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
        };
        
        this.gl = this.canvas.getContext('webgl2', contextOptions);
        
        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }
        
        // Set up error handling
        const originalGetError = this.gl.getError.bind(this.gl);
        let errorLogged = false;
        
        // Override getError for better debugging
        this.gl.getError = () => {
            const error = originalGetError();
            if (error !== this.gl!.NO_ERROR && !errorLogged) {
                console.error('WebGL2 Error:', this.getErrorString(error));
                errorLogged = true;
                setTimeout(() => { errorLogged = false; }, 1000); // Reset error logging
            }
            return error;
        };
    }
    
    private detectCapabilities(): void {
        if (!this.gl) throw new Error('WebGL2 context not initialized');
        
        const gl = this.gl;
        
        // Get basic capabilities
        this.capabilities = {
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
            maxUniformBufferBindings: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
            maxVertexAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
            supportsFloatTextures: this.checkExtension('EXT_color_buffer_float'),
            supportsDepthTextures: true, // WebGL2 always supports depth textures
            supportsInstancing: true, // WebGL2 always supports instancing
            supportsVAO: true, // WebGL2 always supports VAO
            extensions: gl.getSupportedExtensions() || [],
        };
        
        console.log('WebGL2 Capabilities:', this.capabilities);
    }
    
    private checkExtension(name: string): boolean {
        if (!this.gl) return false;
        return this.gl.getExtension(name) !== null;
    }
    
    private setupDefaultState(): void {
        if (!this.gl) return;
        
        const gl = this.gl;
        
        // Enable depth testing
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        
        // Enable face culling
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.frontFace(gl.CCW);
        
        // Set clear color
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        
        // Set viewport
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    
    private async createFallbackShaders(): Promise<void> {
        // Create basic vertex shader source (GLSL ES 3.00)
        const basicVertexSource = `#version 300 es
            precision highp float;
            
            layout(location = 0) in vec3 a_position;
            layout(location = 1) in vec3 a_normal;
            layout(location = 2) in vec2 a_uv;
            
            uniform mat4 u_modelMatrix;
            uniform mat4 u_viewMatrix;
            uniform mat4 u_projectionMatrix;
            uniform mat4 u_normalMatrix;
            
            out vec3 v_worldPosition;
            out vec3 v_normal;
            out vec2 v_uv;
            out vec3 v_viewPosition;
            
            void main() {
                vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
                v_worldPosition = worldPosition.xyz;
                
                vec4 viewPosition = u_viewMatrix * worldPosition;
                v_viewPosition = viewPosition.xyz;
                
                gl_Position = u_projectionMatrix * viewPosition;
                
                v_normal = normalize((u_normalMatrix * vec4(a_normal, 0.0)).xyz);
                v_uv = a_uv;
            }
        `;
        
        // Create basic fragment shader source (GLSL ES 3.00)
        const basicFragmentSource = `#version 300 es
            precision highp float;
            
            in vec3 v_worldPosition;
            in vec3 v_normal;
            in vec2 v_uv;
            in vec3 v_viewPosition;
            
            uniform vec3 u_cameraPosition;
            uniform vec3 u_sunDirection;
            uniform vec3 u_sunColor;
            uniform float u_sunIntensity;
            uniform vec3 u_ambientColor;
            
            uniform sampler2D u_albedoTexture;
            uniform vec4 u_albedoColor;
            uniform float u_metallic;
            uniform float u_roughness;
            
            out vec4 fragColor;
            
            // Simplified PBR calculation
            vec3 calculatePBR(vec3 albedo, float metallic, float roughness, vec3 normal, vec3 viewDir, vec3 lightDir, vec3 lightColor, float lightIntensity) {
                float NdotL = max(dot(normal, lightDir), 0.0);
                float NdotV = max(dot(normal, viewDir), 0.0);
                
                vec3 F0 = mix(vec3(0.04), albedo, metallic);
                vec3 diffuse = albedo * (1.0 - metallic) * NdotL;
                vec3 specular = F0 * pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 32.0 * (1.0 - roughness));
                
                return (diffuse + specular) * lightColor * lightIntensity;
            }
            
            void main() {
                vec3 albedo = texture(u_albedoTexture, v_uv).rgb * u_albedoColor.rgb;
                vec3 normal = normalize(v_normal);
                vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);
                
                // Sun lighting
                vec3 lighting = calculatePBR(
                    albedo,
                    u_metallic,
                    u_roughness,
                    normal,
                    viewDir,
                    -u_sunDirection,
                    u_sunColor,
                    u_sunIntensity
                );
                
                // Ambient lighting
                lighting += albedo * u_ambientColor;
                
                // Simple tone mapping and gamma correction
                lighting = lighting / (lighting + vec3(1.0));
                lighting = pow(lighting, vec3(1.0 / 2.2));
                
                fragColor = vec4(lighting, u_albedoColor.a);
            }
        `;
        
        // Create shader program
        const basicProgram = this.createShaderProgram('basic', basicVertexSource, basicFragmentSource);
        if (basicProgram) {
            this.shaderPrograms.set('basic', basicProgram);
            this.cacheUniformLocations('basic', basicProgram);
        }
    }
    
    private createShaderProgram(name: string, vertexSource: string, fragmentSource: string): WebGLProgram | null {
        if (!this.gl) return null;
        
        const gl = this.gl;
        
        // Create and compile vertex shader
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        if (!vertexShader) return null;
        
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);
        
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error(`Vertex shader compilation error (${name}):`, gl.getShaderInfoLog(vertexShader));
            gl.deleteShader(vertexShader);
            return null;
        }
        
        // Create and compile fragment shader
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        if (!fragmentShader) {
            gl.deleteShader(vertexShader);
            return null;
        }
        
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);
        
        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error(`Fragment shader compilation error (${name}):`, gl.getShaderInfoLog(fragmentShader));
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            return null;
        }
        
        // Create and link program
        const program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            return null;
        }
        
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`Shader program link error (${name}):`, gl.getProgramInfoLog(program));
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            gl.deleteProgram(program);
            return null;
        }
        
        // Clean up shaders (they're now part of the program)
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        
        return program;
    }
    
    private cacheUniformLocations(programName: string, program: WebGLProgram): void {
        if (!this.gl) return;
        
        const gl = this.gl;
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        const locations = new Map<string, WebGLUniformLocation>();
        
        for (let i = 0; i < uniformCount; i++) {
            const uniformInfo = gl.getActiveUniform(program, i);
            if (uniformInfo) {
                const location = gl.getUniformLocation(program, uniformInfo.name);
                if (location) {
                    locations.set(uniformInfo.name, location);
                }
            }
        }
        
        this.uniformLocations.set(programName, locations);
    }
    
    render(deltaTime: number, camera: Camera): void {
        if (!this.gl || !this.isInitialized) {
            console.warn('WebGL2 fallback not initialized');
            return;
        }
        
        // Reset render stats
        this.renderStats.drawCalls = 0;
        this.renderStats.triangles = 0;
        this.renderStats.vertices = 0;
        this.renderStats.textureBinds = 0;
        this.renderStats.shaderSwitches = 0;
        
        const gl = this.gl;
        
        // Clear buffers
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        
        // Use basic shader program
        const basicProgram = this.shaderPrograms.get('basic');
        if (basicProgram) {
            this.useProgram('basic');
            
            // Update camera uniforms
            this.updateCameraUniforms('basic', camera);
            this.updateLightingUniforms('basic');
            
            // TODO: Render scene objects
            // This is where actual geometry would be rendered
            // For now, this serves as a working fallback foundation
        }
        
        // Check for GL errors
        const error = gl.getError();
        if (error !== gl.NO_ERROR) {
            console.error('WebGL2 render error:', this.getErrorString(error));
        }
    }
    
    private useProgram(programName: string): boolean {
        const program = this.shaderPrograms.get(programName);
        if (!program || !this.gl) return false;
        
        if (this.currentProgram !== program) {
            this.gl.useProgram(program);
            this.currentProgram = program;
            this.renderStats.shaderSwitches++;
        }
        
        return true;
    }
    
    private updateCameraUniforms(programName: string, camera: Camera): void {
        if (!this.gl) return;
        
        const locations = this.uniformLocations.get(programName);
        if (!locations) return;
        
        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix();
        const position = camera.getPosition();
        
        // Model matrix (identity for now)
        const modelMatrix = new Matrix4();
        const normalMatrix = modelMatrix.clone().invert().transpose();
        
        // Set uniform matrices
        const modelLoc = locations.get('u_modelMatrix');
        if (modelLoc) {
            this.gl.uniformMatrix4fv(modelLoc, false, modelMatrix.elements);
        }
        
        const viewLoc = locations.get('u_viewMatrix');
        if (viewLoc) {
            this.gl.uniformMatrix4fv(viewLoc, false, viewMatrix.elements);
        }
        
        const projLoc = locations.get('u_projectionMatrix');
        if (projLoc) {
            this.gl.uniformMatrix4fv(projLoc, false, projectionMatrix.elements);
        }
        
        const normalLoc = locations.get('u_normalMatrix');
        if (normalLoc) {
            this.gl.uniformMatrix4fv(normalLoc, false, normalMatrix.elements);
        }
        
        const cameraLoc = locations.get('u_cameraPosition');
        if (cameraLoc) {
            this.gl.uniform3f(cameraLoc, position.x, position.y, position.z);
        }
    }
    
    private updateLightingUniforms(programName: string): void {
        if (!this.gl) return;
        
        const locations = this.uniformLocations.get(programName);
        if (!locations) return;
        
        // Simple sun lighting
        const sunDirection = new Vector3(0.3, -0.8, 0.2).normalize();
        const sunColor = new Vector3(1.0, 0.95, 0.8);
        const sunIntensity = 3.0;
        const ambientColor = new Vector3(0.1, 0.1, 0.2);
        
        const sunDirLoc = locations.get('u_sunDirection');
        if (sunDirLoc) {
            this.gl.uniform3f(sunDirLoc, sunDirection.x, sunDirection.y, sunDirection.z);
        }
        
        const sunColorLoc = locations.get('u_sunColor');
        if (sunColorLoc) {
            this.gl.uniform3f(sunColorLoc, sunColor.x, sunColor.y, sunColor.z);
        }
        
        const sunIntensityLoc = locations.get('u_sunIntensity');
        if (sunIntensityLoc) {
            this.gl.uniform1f(sunIntensityLoc, sunIntensity);
        }
        
        const ambientLoc = locations.get('u_ambientColor');
        if (ambientLoc) {
            this.gl.uniform3f(ambientLoc, ambientColor.x, ambientColor.y, ambientColor.z);
        }
    }
    
    private getErrorString(error: number): string {
        if (!this.gl) return 'Unknown error';
        
        switch (error) {
            case this.gl.NO_ERROR: return 'NO_ERROR';
            case this.gl.INVALID_ENUM: return 'INVALID_ENUM';
            case this.gl.INVALID_VALUE: return 'INVALID_VALUE';
            case this.gl.INVALID_OPERATION: return 'INVALID_OPERATION';
            case this.gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';
            case this.gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
            case this.gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
            default: return `Unknown error: ${error}`;
        }
    }
    
    resize(width: number, height: number): void {
        if (!this.gl) return;
        
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }
    
    getCapabilities(): WebGL2Capabilities | null {
        return this.capabilities;
    }
    
    getRenderStats(): WebGL2RenderStats {
        return { ...this.renderStats };
    }
    
    destroy(): void {
        if (!this.gl) return;
        
        // Clean up resources
        for (const program of this.shaderPrograms.values()) {
            this.gl.deleteProgram(program);
        }
        this.shaderPrograms.clear();
        
        for (const buffer of this.buffers.values()) {
            this.gl.deleteBuffer(buffer);
        }
        this.buffers.clear();
        
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.textures.clear();
        
        for (const framebuffer of this.framebuffers.values()) {
            this.gl.deleteFramebuffer(framebuffer);
        }
        this.framebuffers.clear();
        
        this.uniformLocations.clear();
        this.isInitialized = false;
        this.gl = null;
    }
}