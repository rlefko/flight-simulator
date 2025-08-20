import { Camera } from './Camera';
import { Matrix4, Vector3 } from '../core/math';

interface TreeInstance {
    position: Vector3;
    scale: number;
    rotation: number;
    species?: number; // Tree species for variation
    ageVariation?: number; // Age-based size variation
    healthVariation?: number; // Health-based color variation
    id?: string; // Unique identifier for consistent properties
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

        // Create instance buffer with expanded data
        this.instanceBuffer = device.createBuffer({
            label: 'Vegetation Instance Buffer',
            size: this.maxInstances * 48, // position(12) + scale(4) + rotation(4) + species(4) + variations(8) + padding(16) = 48 bytes
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Initialize the vegetation pipeline
     */
    public async initialize(): Promise<void> {
        console.log('SimpleVegetationRenderer: Starting initialization...');

        // Create tree geometry
        this.createTreeGeometry();

        if (!this.treeGeometry) {
            throw new Error('SimpleVegetationRenderer: Failed to create tree geometry');
        }

        console.log(
            'SimpleVegetationRenderer: Tree geometry created with',
            this.treeGeometry.indexCount,
            'indices'
        );

        // Load shader
        const shaderCode = this.getShaderCode();
        console.log(
            'SimpleVegetationRenderer: Shader code length:',
            shaderCode.length,
            'characters'
        );

        let shaderModule;
        try {
            shaderModule = this.device.createShaderModule({
                label: 'Simple Vegetation Shader',
                code: shaderCode,
            });
            console.log('SimpleVegetationRenderer: Shader module created successfully');
        } catch (error) {
            console.error('SimpleVegetationRenderer: Shader compilation failed:', error);
            throw error;
        }

        // Create pipeline
        try {
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
                        // Instance buffer with enhanced data
                        {
                            arrayStride: 48,
                            stepMode: 'instance',
                            attributes: [
                                { format: 'float32x3', offset: 0, shaderLocation: 3 }, // instance position
                                { format: 'float32', offset: 12, shaderLocation: 4 }, // scale
                                { format: 'float32', offset: 16, shaderLocation: 5 }, // rotation
                                { format: 'float32', offset: 20, shaderLocation: 6 }, // species
                                { format: 'float32', offset: 24, shaderLocation: 7 }, // age variation
                                { format: 'float32', offset: 28, shaderLocation: 8 }, // health variation
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
                    cullMode: 'back', // Enable back-face culling for performance and proper lighting
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
            console.log('SimpleVegetationRenderer: Pipeline created successfully');
        } catch (error) {
            console.error('SimpleVegetationRenderer: Pipeline creation failed:', error);
            throw error;
        }

        console.log('SimpleVegetationRenderer: Initialization complete');
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
                seasonFactor: f32,      // 0.0 = spring, 0.25 = summer, 0.5 = autumn, 0.75 = winter
                temperatureFactor: f32, // -1.0 = cold, 0.0 = temperate, 1.0 = hot
                precipitationFactor: f32, // 0.0 = dry, 1.0 = wet
                padding: f32,
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
                @location(6) species: f32,
                @location(7) ageVariation: f32,
                @location(8) healthVariation: f32,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) color: vec3<f32>,
                @location(3) instancePosition: vec3<f32>,
                @location(4) rotation: f32,
                @location(5) species: f32,
                @location(6) variations: vec2<f32>, // age and health variations
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
                
                // Apply species-based and variation-based scaling
                var speciesScale = 1.0;
                if (input.species < 0.5) {        // Oak - large
                    speciesScale = 1.2;
                } else if (input.species < 1.5) { // Pine - tall
                    speciesScale = 1.1;
                } else if (input.species < 2.5) { // Palm - very tall
                    speciesScale = 1.4;
                } else if (input.species < 3.5) { // Birch - medium
                    speciesScale = 0.9;
                } else {                          // Cactus - small
                    speciesScale = 0.6;
                }
                
                let totalScale = input.scale * speciesScale * input.ageVariation;
                let worldPos = rotatedPos * totalScale + input.instancePosition;
                
                // Transform to clip space
                output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
                output.worldPos = worldPos;
                
                // Rotate normal
                output.normal = normalize(vec3<f32>(
                    input.normal.x * cosRot - input.normal.z * sinRot,
                    input.normal.y,
                    input.normal.x * sinRot + input.normal.z * cosRot
                ));
                
                // Pass instance data to fragment shader
                output.instancePosition = input.instancePosition;
                output.rotation = input.rotation;
                output.species = input.species;
                output.variations = vec2<f32>(input.ageVariation, input.healthVariation);
                
                // Enhanced tree coloring based on height and tree parts with realistic PBR colors
                let heightFactor = clamp(input.position.y / 25.0, 0.0, 1.0);
                let trunkHeightThreshold = 0.35; // 35% of tree is trunk (matching geometry)
                
                var finalColor: vec3<f32>;
                
                if (heightFactor < trunkHeightThreshold) {
                    // Realistic bark coloring with species variation
                    var barkBaseColor: vec3<f32>;
                    
                    if (input.species < 0.5) {        // Oak - rough dark bark
                        barkBaseColor = vec3<f32>(0.35, 0.22, 0.12);
                    } else if (input.species < 1.5) { // Pine - reddish bark
                        barkBaseColor = vec3<f32>(0.42, 0.25, 0.15);
                    } else if (input.species < 2.5) { // Palm - smooth brown bark
                        barkBaseColor = vec3<f32>(0.38, 0.28, 0.18);
                    } else if (input.species < 3.5) { // Birch - white bark with dark markings
                        barkBaseColor = vec3<f32>(0.65, 0.55, 0.45);
                    } else {                          // Cactus - green-brown bark
                        barkBaseColor = vec3<f32>(0.25, 0.35, 0.15);
                    }
                    
                    // Add realistic bark texture and aging
                    let barkNoise = sin(input.position.y * 2.0) * cos(input.rotation * 8.0) * 0.12;
                    let ageEffect = sin(input.instancePosition.x * 0.02) * 0.08;
                    let verticalLines = sin(input.rotation * 15.0) * 0.06; // Vertical bark texture
                    
                    finalColor = barkBaseColor + vec3<f32>(
                        barkNoise + ageEffect + verticalLines,
                        (barkNoise + ageEffect) * 0.6,
                        (barkNoise + ageEffect) * 0.3
                    );
                    
                    // Darken lower trunk (dirt/moisture)
                    let moistureFactor = clamp(1.0 - heightFactor * 3.0, 0.0, 0.3);
                    finalColor *= (1.0 - moistureFactor);
                    
                } else {
                    // Realistic foliage coloring with natural variation
                    let crownFactor = (heightFactor - trunkHeightThreshold) / (1.0 - trunkHeightThreshold);
                    
                    // Base foliage colors - more realistic and varied
                    let innerGreen = vec3<f32>(0.12, 0.35, 0.08);   // Deep shadow green
                    let midGreen = vec3<f32>(0.18, 0.52, 0.12);     // Main foliage green
                    let outerGreen = vec3<f32>(0.25, 0.65, 0.18);   // Sunlit green
                    let tipGreen = vec3<f32>(0.32, 0.75, 0.22);     // New growth green
                    
                    // Multi-layer color mixing for realistic foliage depth
                    var foliageColor: vec3<f32>;
                    if (crownFactor < 0.25) {
                        foliageColor = mix(innerGreen, midGreen, crownFactor / 0.25);
                    } else if (crownFactor < 0.6) {
                        foliageColor = mix(midGreen, outerGreen, (crownFactor - 0.25) / 0.35);
                    } else if (crownFactor < 0.85) {
                        foliageColor = mix(outerGreen, tipGreen, (crownFactor - 0.6) / 0.25);
                    } else {
                        // Uppermost tips - brightest new growth
                        foliageColor = mix(tipGreen, vec3<f32>(0.4, 0.85, 0.3), (crownFactor - 0.85) / 0.15);
                    }
                    
                    // Apply seasonal variation first
                    foliageColor = applySeasonalVariation(foliageColor, input.species, uniforms.seasonFactor, uniforms.temperatureFactor);
                    
                    // Apply species-specific realistic coloring
                    if (input.species < 0.5) {        // Oak - rich temperate green
                        foliageColor *= vec3<f32>(0.95, 1.08, 0.85);
                    } else if (input.species < 1.5) { // Pine - darker evergreen
                        foliageColor *= vec3<f32>(0.75, 0.88, 0.65);
                    } else if (input.species < 2.5) { // Palm - tropical bright green
                        foliageColor *= vec3<f32>(0.85, 1.15, 0.75);
                    } else if (input.species < 3.5) { // Birch - lighter deciduous green
                        foliageColor *= vec3<f32>(1.05, 0.98, 0.88);
                    } else {                          // Cactus - desert green-gray
                        foliageColor *= vec3<f32>(0.75, 0.85, 0.55);
                    }
                    
                    // Add natural micro-variation and wind effects
                    let microVariation = sin(input.instancePosition.x * 0.15) * cos(input.instancePosition.z * 0.12) * 0.1;
                    let windVariation = sin(input.position.x * 0.3 + input.position.z * 0.25) * 0.08;
                    let seasonalShift = sin(input.instancePosition.x * 0.03 + input.instancePosition.z * 0.04) * 0.06;
                    
                    foliageColor += vec3<f32>(
                        microVariation + windVariation + seasonalShift,
                        (microVariation + windVariation) * 0.7,
                        (microVariation + windVariation) * 0.4
                    );
                    
                    // Add subtle branch shadow effect
                    let branchShadow = sin(crownFactor * 12.0) * cos(input.rotation * 6.0) * 0.05;
                    foliageColor *= (1.0 - branchShadow);
                    
                    finalColor = foliageColor;
                }
                
                output.color = finalColor;
                output.instancePosition = input.instancePosition;
                output.rotation = input.rotation;
                output.species = input.species;
                output.variations = vec2<f32>(input.ageVariation, input.healthVariation);
                
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                // Enhanced realistic lighting with improved material properties
                let sunDir = normalize(vec3<f32>(0.6, 1.0, 0.4));
                let skyDir = normalize(vec3<f32>(0.0, 1.0, 0.0));
                let normal = normalize(input.normal);
                
                // Determine if this is trunk or foliage based on height
                let trunkThreshold = input.instancePosition.y + 8.75; // 35% of 25 units
                let isTrunk = input.worldPos.y < trunkThreshold;
                
                // Enhanced lighting calculations
                let sunDot = max(dot(normal, sunDir), 0.0);
                let skyDot = max(dot(normal, skyDir), 0.0);
                let groundDir = vec3<f32>(0.0, -1.0, 0.0);
                let groundDot = max(dot(normal, groundDir), 0.0);
                
                // Material-specific lighting
                var directLight: f32;
                var ambientLight: f32;
                var specularLight: f32;
                
                if (isTrunk) {
                    // Trunk material - rougher, more diffuse
                    directLight = sunDot * 0.7;
                    ambientLight = 0.3 + skyDot * 0.2 + groundDot * 0.1;
                    specularLight = 0.0; // No specular for bark
                } else {
                    // Foliage material - softer, more translucent
                    directLight = sunDot * 0.9;
                    ambientLight = 0.4 + skyDot * 0.4 + groundDot * 0.2;
                    
                    // Subtle specular for waxy leaves
                    let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
                    let halfDir = normalize(sunDir + viewDir);
                    let specDot = max(dot(normal, halfDir), 0.0);
                    specularLight = pow(specDot, 16.0) * 0.1;
                }
                
                // Apply health variation to color
                var healthAdjustedColor = input.color * input.variations.y;
                
                // Add natural color variation and micro-detail
                let worldNoise = sin(input.worldPos.x * 0.5) * cos(input.worldPos.z * 0.3) * 0.08;
                let heightNoise = sin(input.worldPos.y * 0.8) * 0.05;
                healthAdjustedColor += vec3<f32>(worldNoise + heightNoise, worldNoise * 0.7, worldNoise * 0.4);
                
                // Add subtle wind-based color shifting for foliage
                if (!isTrunk) {
                    let windEffect = sin(uniforms.time * 2.0 + input.worldPos.x * 0.1) * 0.02;
                    healthAdjustedColor += vec3<f32>(windEffect, windEffect * 0.5, windEffect * 0.3);
                }
                
                // Calculate total lighting
                let totalLighting = ambientLight + directLight;
                var finalColor = healthAdjustedColor * totalLighting;
                
                // Add specular highlight
                finalColor += vec3<f32>(1.0, 0.9, 0.7) * specularLight;
                
                // Enhanced subsurface scattering for leaves only
                if (!isTrunk) {
                    let backLight = max(0.0, -dot(normal, sunDir)) * 0.4;
                    let thickness = 0.3 + sin(input.worldPos.x * 2.0 + input.worldPos.z * 1.5) * 0.1;
                    let scatterColor = vec3<f32>(0.3, 0.7, 0.2) * backLight * thickness;
                    finalColor += scatterColor;
                    
                    // Add translucency effect
                    let translucency = pow(max(0.0, -dot(normal, sunDir)), 0.5) * 0.2;
                    finalColor += healthAdjustedColor * translucency;
                }
                
                // Improved material roughness simulation
                if (isTrunk) {
                    // Add bark roughness - slight darkening in crevices
                    let barkRoughness = sin(input.worldPos.y * 3.0) * cos(atan2(input.worldPos.z, input.worldPos.x) * 8.0) * 0.1;
                    finalColor *= (1.0 + barkRoughness);
                } else {
                    // Add leaf surface variation
                    let leafVariation = sin(input.worldPos.x * 8.0) * sin(input.worldPos.z * 6.0) * 0.05;
                    finalColor *= (1.0 + leafVariation);
                }
                
                // Distance-based atmospheric perspective
                let distance = length(uniforms.cameraPosition - input.worldPos);
                let fogStart = 1500.0;
                let fogEnd = 6000.0;
                let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
                let fogColor = vec3<f32>(0.65, 0.75, 0.85);
                finalColor = mix(fogColor, finalColor, fogFactor);
                
                // Tone mapping for more realistic colors
                finalColor = finalColor / (finalColor + vec3<f32>(1.0));
                finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2)); // Gamma correction
                
                return vec4<f32>(clamp(finalColor, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
            }
            
            // Apply seasonal color variations to foliage
            fn applySeasonalVariation(baseColor: vec3<f32>, species: f32, seasonFactor: f32, temperatureFactor: f32) -> vec3<f32> {
                let seasonCycle = seasonFactor * 4.0; // Convert to 0-4 range
                var seasonalColor = baseColor;
                
                // Different tree species respond differently to seasons
                if (species < 1.5 || species >= 2.5) { // Deciduous trees (Oak, Birch) - strong seasonal variation
                    let springGreen = vec3<f32>(0.4, 0.9, 0.3);    // Bright spring green
                    let summerGreen = vec3<f32>(0.2, 0.7, 0.2);    // Deep summer green
                    let autumnYellow = vec3<f32>(0.8, 0.6, 0.1);   // Golden autumn
                    let autumnRed = vec3<f32>(0.7, 0.2, 0.1);      // Red autumn
                    let winterBrown = vec3<f32>(0.3, 0.2, 0.1);    // Bare branches
                    
                    if (seasonCycle < 1.0) {        // Spring
                        seasonalColor = mix(winterBrown, springGreen, seasonCycle);
                    } else if (seasonCycle < 2.0) { // Summer
                        seasonalColor = mix(springGreen, summerGreen, seasonCycle - 1.0);
                    } else if (seasonCycle < 3.0) { // Autumn
                        let autumnMix = mix(autumnYellow, autumnRed, sin(seasonCycle * 3.14159) * 0.5 + 0.5);
                        seasonalColor = mix(summerGreen, autumnMix, seasonCycle - 2.0);
                    } else {                        // Winter
                        seasonalColor = mix(seasonalColor, winterBrown, (seasonCycle - 3.0) * 0.8);
                    }
                    
                } else if (species < 2.5) { // Evergreens (Pine) - minimal seasonal variation
                    let summerGreen = baseColor;
                    let winterGreen = baseColor * 0.8; // Slightly darker in winter
                    
                    if (seasonCycle >= 3.0) { // Winter darkening
                        seasonalColor = mix(summerGreen, winterGreen, (seasonCycle - 3.0) * 0.5);
                    }
                    
                } else { // Tropical/Desert plants - temperature-based variation only
                    let coldTolerance = clamp(-temperatureFactor, 0.0, 1.0);
                    seasonalColor = mix(baseColor, baseColor * 0.7, coldTolerance * 0.3);
                }
                
                // Temperature effects on all species
                let coldEffect = clamp(-temperatureFactor, 0.0, 1.0);
                seasonalColor = mix(seasonalColor, seasonalColor * vec3<f32>(0.8, 0.6, 0.4), coldEffect * 0.2);
                
                return seasonalColor;
            }
        `;
    }

    /**
     * Create highly detailed, organic tree geometry with realistic trunk and crown
     */
    private createTreeGeometry(): void {
        const vertices: number[] = [];
        const indices: number[] = [];

        // Enhanced tree geometry with detailed trunk and layered foliage crown
        const totalDesiredHeight = 25.0; // Match VegetationSystem expectation
        const trunkHeightRatio = 0.35; // 35% trunk, 65% crown for better proportions
        const trunkHeight = totalDesiredHeight * trunkHeightRatio; // 8.75 units
        const crownHeight = totalDesiredHeight * (1 - trunkHeightRatio); // 16.25 units
        const baseTrunkRadius = 1.8; // Larger base radius for realism
        const topTrunkRadius = 1.2; // Tapered trunk top
        const crownRadius = 9.0; // Larger crown for realistic proportions
        const segments = 32; // High detail for smooth curves
        const trunkLayers = 6; // Multiple trunk layers for organic taper
        const crownLayers = 8; // Multiple crown layers for volume

        let vertexIndex = 0;

        // === DETAILED TRUNK GEOMETRY ===
        // Create multi-layered trunk with organic taper and bark texture detail
        const trunkLayerStarts: number[] = [];

        for (let layer = 0; layer <= trunkLayers; layer++) {
            const layerHeight = (layer / trunkLayers) * trunkHeight;
            const heightRatio = layer / trunkLayers;

            // Organic trunk taper - wider at base, narrower at top with subtle curves
            const radiusRatio = 1.0 - heightRatio * 0.4 + Math.sin(heightRatio * Math.PI) * 0.1;
            const layerRadius = baseTrunkRadius * radiusRatio;

            trunkLayerStarts.push(vertexIndex);

            for (let i = 0; i < segments; i++) {
                const angle = (i / segments) * Math.PI * 2;

                // Add subtle bark texture variation
                const barkVariation = Math.sin(angle * 3) * Math.cos(layerHeight * 0.8) * 0.05;
                const radiusWithBark = layerRadius + barkVariation;

                const x = Math.cos(angle) * radiusWithBark;
                const z = Math.sin(angle) * radiusWithBark;

                // Calculate smooth normal for organic appearance
                const normalAngle = angle + barkVariation * 0.5;
                const nx = Math.cos(normalAngle);
                const nz = Math.sin(normalAngle);
                const ny = layer === 0 ? -0.1 : layer === trunkLayers ? 0.2 : 0.05;
                const normal = new Vector3(nx, ny, nz).normalize();

                // UV coordinates for bark texture mapping
                const u = i / segments;
                const v = heightRatio * 0.35; // Trunk uses lower portion of texture

                vertices.push(x, layerHeight, z, normal.x, normal.y, normal.z, u, v);
                vertexIndex++;
            }
        }

        // === DETAILED CROWN GEOMETRY ===
        // Create multi-layered crown with organic shape and varied density
        const crownLayerStarts: number[] = [];

        for (let layer = 0; layer <= crownLayers; layer++) {
            const layerHeight = trunkHeight + (layer / crownLayers) * crownHeight;
            const heightRatio = layer / crownLayers;

            // Organic crown shape - narrow at base, widest at 60%, then tapering to point
            let radiusMultiplier;
            if (heightRatio < 0.2) {
                // Base of crown - starts narrow
                radiusMultiplier = 0.3 + heightRatio * 1.5; // 0.3 to 0.6
            } else if (heightRatio < 0.6) {
                // Middle expansion - reaches full width
                const midRatio = (heightRatio - 0.2) / 0.4;
                radiusMultiplier = 0.6 + midRatio * 0.4; // 0.6 to 1.0
            } else if (heightRatio < 0.9) {
                // Upper taper - gradual narrowing
                const upperRatio = (heightRatio - 0.6) / 0.3;
                radiusMultiplier = 1.0 - upperRatio * 0.6; // 1.0 to 0.4
            } else {
                // Crown tip - sharp taper to point
                const tipRatio = (heightRatio - 0.9) / 0.1;
                radiusMultiplier = 0.4 - tipRatio * 0.4; // 0.4 to 0.0
            }

            crownLayerStarts.push(vertexIndex);

            // Add organic irregularity to crown shape
            for (let i = 0; i < segments; i++) {
                const angle = (i / segments) * Math.PI * 2;

                // Natural foliage variation - some branches extend further
                const foliageVariation = Math.sin(angle * 2.3) * Math.cos(angle * 1.7) * 0.15;
                const windEffect = Math.sin(angle * 4) * 0.08; // Subtle asymmetry
                const layerRadius =
                    crownRadius * (radiusMultiplier + foliageVariation + windEffect);

                const x = Math.cos(angle) * Math.max(0, layerRadius);
                const z = Math.sin(angle) * Math.max(0, layerRadius);

                // Calculate outward-facing normal with upward component for leaves
                const normalRadial = new Vector3(x, 0, z).normalize();
                const upwardComponent = 0.3 + heightRatio * 0.4; // More upward at top
                const normal = new Vector3(
                    normalRadial.x,
                    upwardComponent,
                    normalRadial.z
                ).normalize();

                // UV coordinates for foliage texture mapping
                const u = i / segments;
                const v = 0.35 + heightRatio * 0.65; // Crown uses upper portion of texture

                vertices.push(x, layerHeight, z, normal.x, normal.y, normal.z, u, v);
                vertexIndex++;
            }
        }

        // Crown tip vertex for sharp top
        vertices.push(0, trunkHeight + crownHeight, 0, 0, 1, 0, 0.5, 1.0);
        const crownTip = vertexIndex++;

        // === TRUNK INDICES ===
        // Connect trunk layers with quad faces
        for (let layer = 0; layer < trunkLayers; layer++) {
            const currentLayerStart = trunkLayerStarts[layer];
            const nextLayerStart = trunkLayerStarts[layer + 1];

            for (let i = 0; i < segments; i++) {
                const next = (i + 1) % segments;

                // Create quad from two triangles
                indices.push(
                    currentLayerStart + i,
                    currentLayerStart + next,
                    nextLayerStart + i,

                    nextLayerStart + i,
                    currentLayerStart + next,
                    nextLayerStart + next
                );
            }
        }

        // === CROWN INDICES ===
        // Connect crown layers with quad faces
        for (let layer = 0; layer < crownLayers; layer++) {
            const currentLayerStart = crownLayerStarts[layer];
            const nextLayerStart = crownLayerStarts[layer + 1];

            for (let i = 0; i < segments; i++) {
                const next = (i + 1) % segments;

                // Create quad from two triangles
                indices.push(
                    currentLayerStart + i,
                    currentLayerStart + next,
                    nextLayerStart + i,

                    nextLayerStart + i,
                    currentLayerStart + next,
                    nextLayerStart + next
                );
            }
        }

        // Connect final crown layer to tip
        const finalCrownLayer = crownLayerStarts[crownLayers];
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(crownTip, finalCrownLayer + i, finalCrownLayer + next);
        }

        // === ADD BRANCH DETAIL ===
        // Add some simple branch geometry for extra detail (optional for performance)
        const branchCount = 8;
        const branchLayerStart = vertexIndex;

        for (let b = 0; b < branchCount; b++) {
            const branchAngle = (b / branchCount) * Math.PI * 2;
            const branchHeight = trunkHeight * (0.6 + (b % 3) * 0.15); // Varied heights
            const branchLength = crownRadius * (0.3 + (b % 2) * 0.2);
            const branchRadius = 0.3;

            // Branch base (at trunk)
            const baseX = Math.cos(branchAngle) * (baseTrunkRadius * 0.9);
            const baseZ = Math.sin(branchAngle) * (baseTrunkRadius * 0.9);

            // Branch tip
            const tipX = Math.cos(branchAngle) * branchLength;
            const tipZ = Math.sin(branchAngle) * branchLength;
            const tipY = branchHeight + branchLength * 0.1; // Slight upward angle

            // Simple branch geometry (cylinder)
            for (let seg = 0; seg < 6; seg++) {
                const segAngle = (seg / 6) * Math.PI * 2;
                const segX = Math.cos(segAngle) * branchRadius;
                const segZ = Math.sin(segAngle) * branchRadius;

                // Rotate around branch direction
                const branchCos = Math.cos(branchAngle);
                const branchSin = Math.sin(branchAngle);

                const rotX = segX * branchCos - segZ * branchSin;
                const rotZ = segX * branchSin + segZ * branchCos;

                // Branch base vertex
                vertices.push(
                    baseX + rotX,
                    branchHeight,
                    baseZ + rotZ,
                    rotX / branchRadius,
                    0,
                    rotZ / branchRadius,
                    seg / 6,
                    0.2
                );

                // Branch tip vertex
                vertices.push(
                    tipX + rotX * 0.5,
                    tipY,
                    tipZ + rotZ * 0.5,
                    rotX / branchRadius,
                    0.2,
                    rotZ / branchRadius,
                    seg / 6,
                    0.3
                );

                vertexIndex += 2;
            }
        }

        // Branch indices (connect base to tip segments)
        for (let b = 0; b < branchCount; b++) {
            const branchStart = branchLayerStart + b * 12; // 6 segments * 2 vertices

            for (let seg = 0; seg < 6; seg++) {
                const nextSeg = (seg + 1) % 6;
                const baseIdx = branchStart + seg * 2;
                const tipIdx = branchStart + seg * 2 + 1;
                const nextBaseIdx = branchStart + nextSeg * 2;
                const nextTipIdx = branchStart + nextSeg * 2 + 1;

                // Create quad
                indices.push(baseIdx, nextBaseIdx, tipIdx, tipIdx, nextBaseIdx, nextTipIdx);
            }
        }

        // Create GPU buffers
        const vertexData = new Float32Array(vertices);
        const indexData = new Uint16Array(indices);

        const vertexBuffer = this.device.createBuffer({
            label: 'Detailed Tree Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: 'Detailed Tree Index Buffer',
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, indexData);

        this.treeGeometry = {
            vertexBuffer,
            indexBuffer,
            indexCount: indices.length,
        };

        console.log('SimpleVegetationRenderer: Created detailed tree geometry');
        console.log('- Vertices:', vertices.length / 8, 'vertices'); // 8 floats per vertex
        console.log('- Indices:', indices.length, 'indices');
        console.log('- Triangles:', indices.length / 3, 'triangles');
        console.log('- Trunk layers:', trunkLayers + 1);
        console.log('- Crown layers:', crownLayers + 1);
        console.log('- Branches:', branchCount);
        console.log('- Segments per layer:', segments);
    }

    /**
     * Update tree instances with consistent deterministic properties
     */
    public updateInstances(trees: TreeInstance[]): void {
        if (!this.instanceBuffer) {
            console.error('SimpleVegetationRenderer: No instance buffer available');
            return;
        }

        console.log('SimpleVegetationRenderer: Updating instances with', trees.length, 'trees');

        // ADD DEBUG TREE: Place a large tree at origin for testing
        const debugTree = {
            position: { x: 0, y: 50, z: 0 }, // 50 units above ground at origin
            scale: 5.0, // Very large scale
            rotation: 0,
            species: 0,
        };

        const allTrees = [debugTree, ...trees]; // Add debug tree first
        console.log(
            'SimpleVegetationRenderer: Added debug tree at origin, total trees:',
            allTrees.length
        );

        // Limit instances to prevent buffer overflow
        const instancesToRender = Math.min(allTrees.length, this.maxInstances);
        if (allTrees.length > this.maxInstances) {
            console.warn(
                `SimpleVegetationRenderer: Limiting trees from ${allTrees.length} to ${this.maxInstances}`
            );
        }

        const instanceData = new Float32Array(instancesToRender * 12); // 48 bytes / 4 = 12 floats
        let offset = 0;

        for (let i = 0; i < instancesToRender; i++) {
            const tree = allTrees[i];

            // Debug first few trees
            if (i < 3) {
                console.log(`Tree ${i}:`, {
                    position: tree.position,
                    scale: tree.scale,
                    rotation: tree.rotation,
                });
            }

            // Use deterministic variations based on tree position (no random flickering)
            const positionSeed = tree.position.x * 1000 + tree.position.z * 100 + tree.position.y;
            const scaleVariation = this.seededRandom(positionSeed, 1) * 0.6 + 0.7; // 0.7 to 1.3 scale variation
            const ageVariation = this.seededRandom(positionSeed, 2) * 0.4 + 0.8; // 0.8 to 1.2 age variation
            const healthVariation = this.seededRandom(positionSeed, 3) * 0.2 + 0.9; // 0.9 to 1.1 health variation
            const speciesVariation = Math.floor(this.seededRandom(positionSeed, 4) * 5); // 0-4 tree species

            // Position (exact as provided)
            instanceData[offset++] = tree.position.x;
            instanceData[offset++] = tree.position.y;
            instanceData[offset++] = tree.position.z;

            // Scale with consistent variation - ensure it's not too small
            const baseScale = tree.scale || 1.0;
            let finalScale;

            if (i === 0) {
                // Debug tree - always large and visible
                finalScale = 5.0;
            } else {
                finalScale = Math.max(0.5, baseScale * scaleVariation); // Minimum 0.5 scale
            }

            instanceData[offset++] = finalScale;

            // Rotation (use original rotation without random variation)
            instanceData[offset++] = tree.rotation;

            // Species and variations (all deterministic)
            instanceData[offset++] = tree.species !== undefined ? tree.species : speciesVariation;
            instanceData[offset++] =
                tree.ageVariation !== undefined ? tree.ageVariation : ageVariation;
            instanceData[offset++] =
                tree.healthVariation !== undefined ? tree.healthVariation : healthVariation;

            // Padding for alignment
            offset += 4;
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);
        this.instanceCount = instancesToRender;

        console.log(
            'SimpleVegetationRenderer: Updated instance buffer with',
            instancesToRender,
            'trees (including debug tree)'
        );
    }

    /**
     * Deterministic seeded random number generator
     */
    private seededRandom(seed: number, salt: number): number {
        const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
        return x - Math.floor(x);
    }

    /**
     * Render vegetation
     */
    public render(renderPass: GPURenderPassEncoder, camera: Camera, time: number): void {
        if (!this.pipeline) {
            console.warn('SimpleVegetationRenderer: No pipeline available for rendering');
            return;
        }

        if (!this.treeGeometry) {
            console.warn('SimpleVegetationRenderer: No tree geometry available for rendering');
            return;
        }

        if (this.instanceCount === 0) {
            console.warn('SimpleVegetationRenderer: No instances to render');
            return;
        }

        console.log('SimpleVegetationRenderer: Rendering', this.instanceCount, 'tree instances');

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

        // Environmental parameters for seasonal effects
        const currentTime = Date.now() / 1000;
        const seasonCycle = (currentTime / (365 * 24 * 3600)) % 1.0; // Annual cycle
        const temperatureFactor = 0.0; // Can be set based on location/elevation
        const precipitationFactor = 0.7; // Can be set based on weather/biome

        uniformData[36] = seasonCycle; // Season factor (0-1)
        uniformData[37] = temperatureFactor; // Temperature factor (-1 to 1)
        uniformData[38] = precipitationFactor; // Precipitation factor (0-1)
        uniformData[39] = 0.0; // Padding

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

        try {
            renderPass.drawIndexed(this.treeGeometry.indexCount, this.instanceCount);
            console.log(
                'SimpleVegetationRenderer: Draw call successful -',
                this.treeGeometry.indexCount,
                'indices,',
                this.instanceCount,
                'instances'
            );
        } catch (error) {
            console.error('SimpleVegetationRenderer: Draw call failed:', error);
        }
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
