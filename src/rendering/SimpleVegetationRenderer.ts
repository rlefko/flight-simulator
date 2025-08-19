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
                    cullMode: 'none', // Disable culling for debugging
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
                
                // Enhanced tree coloring based on height and tree parts
                let heightFactor = clamp(input.position.y / 25.0, 0.0, 1.0);
                let trunkHeightThreshold = 0.3; // 30% of tree is trunk
                
                var finalColor: vec3<f32>;
                
                if (heightFactor < trunkHeightThreshold) {
                    // Trunk coloring - brown bark
                    let trunkBase = vec3<f32>(0.4, 0.25, 0.1);  // Dark brown
                    let trunkTop = vec3<f32>(0.5, 0.35, 0.2);   // Lighter brown
                    let trunkFactor = heightFactor / trunkHeightThreshold;
                    finalColor = mix(trunkBase, trunkTop, trunkFactor);
                    
                    // Add bark texture variation
                    let barkNoise = sin(input.position.y * 0.5) * cos(input.rotation * 10.0) * 0.1;
                    finalColor += vec3<f32>(barkNoise, barkNoise * 0.5, barkNoise * 0.2);
                } else {
                    // Crown/foliage coloring - multiple green shades
                    let crownFactor = (heightFactor - trunkHeightThreshold) / (1.0 - trunkHeightThreshold);
                    
                    // Create varied green colors for more natural look
                    let innerGreen = vec3<f32>(0.15, 0.4, 0.1);   // Deep forest green
                    let midGreen = vec3<f32>(0.25, 0.6, 0.15);    // Medium green
                    let outerGreen = vec3<f32>(0.35, 0.7, 0.2);   // Bright green
                    let tipGreen = vec3<f32>(0.4, 0.8, 0.25);     // Light green tips
                    
                    // Multi-layer color mixing for realistic foliage
                    var foliageColor: vec3<f32>;
                    if (crownFactor < 0.3) {
                        foliageColor = mix(innerGreen, midGreen, crownFactor / 0.3);
                    } else if (crownFactor < 0.7) {
                        foliageColor = mix(midGreen, outerGreen, (crownFactor - 0.3) / 0.4);
                    } else {
                        foliageColor = mix(outerGreen, tipGreen, (crownFactor - 0.7) / 0.3);
                    }
                    
                    // Apply seasonal variation first
                    foliageColor = applySeasonalVariation(foliageColor, input.species, uniforms.seasonFactor, uniforms.temperatureFactor);
                    
                    // Apply species-specific coloring
                    if (input.species < 0.5) {        // Oak - rich green
                        foliageColor *= vec3<f32>(0.9, 1.1, 0.8);
                    } else if (input.species < 1.5) { // Pine - darker green (evergreen, less seasonal change)
                        foliageColor *= vec3<f32>(0.7, 0.9, 0.6);
                    } else if (input.species < 2.5) { // Palm - tropical green (no seasonal change)
                        foliageColor *= vec3<f32>(0.8, 1.2, 0.7);
                    } else if (input.species < 3.5) { // Birch - lighter green
                        foliageColor *= vec3<f32>(1.1, 1.0, 0.9);
                    } else {                          // Cactus - desert green (minimal seasonal change)
                        foliageColor *= vec3<f32>(0.8, 0.8, 0.5);
                    }
                    
                    // Add natural color variation using position-based noise
                    let colorNoise = sin(input.instancePosition.x * 0.1) * cos(input.instancePosition.z * 0.1) * 0.15;
                    let seasonalVariation = sin(input.instancePosition.x * 0.05 + input.instancePosition.z * 0.05) * 0.1;
                    foliageColor += vec3<f32>(colorNoise + seasonalVariation, colorNoise * 0.5, colorNoise * 0.3);
                    
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
                // Enhanced lighting with multiple light sources
                let sunDir = normalize(vec3<f32>(0.6, 1.0, 0.4));
                let skyDir = normalize(vec3<f32>(0.0, 1.0, 0.0));
                let normal = normalize(input.normal);
                
                // Direct sunlight
                let sunDot = max(dot(normal, sunDir), 0.0);
                let sunLight = sunDot * 0.8;
                
                // Sky ambient lighting
                let skyDot = max(dot(normal, skyDir), 0.0);
                let skyLight = skyDot * 0.3;
                
                // Ground bounce lighting (simulate light bouncing from ground)
                let groundDir = vec3<f32>(0.0, -1.0, 0.0);
                let groundDot = max(dot(normal, groundDir), 0.0);
                let groundLight = groundDot * 0.15;
                
                // Base ambient lighting
                let ambient = 0.25;
                
                // Combine lighting
                let totalLighting = ambient + sunLight + skyLight + groundLight;
                
                // Apply health variation to color
                var healthAdjustedColor = input.color * input.variations.y;
                
                // Add subtle wind-based color shifting
                var windAdjustedColor = healthAdjustedColor;
                if (input.worldPos.y > (input.instancePosition.y + 7.5)) { // Only affect crown (above trunk)
                    let windEffect = sin(uniforms.time * 2.0 + input.worldPos.x * 0.1) * 0.02;
                    windAdjustedColor += vec3<f32>(windEffect, windEffect * 0.5, windEffect * 0.3);
                }
                
                // Apply lighting to color
                var finalColor = windAdjustedColor * totalLighting;
                
                // Add subtle subsurface scattering for leaves
                if (input.worldPos.y > (input.instancePosition.y + 7.5)) { // Crown only
                    let backLight = max(0.0, -dot(normal, sunDir)) * 0.3;
                    let scatterColor = vec3<f32>(0.4, 0.8, 0.2) * backLight;
                    finalColor += scatterColor;
                }
                
                // Distance-based fog
                let distance = length(uniforms.cameraPosition - input.worldPos);
                let fogStart = 2000.0;
                let fogEnd = 8000.0;
                let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
                let fogColor = vec3<f32>(0.7, 0.8, 0.9);
                finalColor = mix(fogColor, finalColor, fogFactor);
                
                return vec4<f32>(finalColor, 1.0);
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
     * Create volumetric tree geometry with trunk and crown
     */
    private createTreeGeometry(): void {
        const vertices: number[] = [];
        const indices: number[] = [];

        // Enhanced tree geometry with trunk and foliage crown - scale to match VegetationSystem expectations (25 units)
        const totalDesiredHeight = 25.0; // Match VegetationSystem expectation
        const trunkHeightRatio = 0.3; // 30% trunk, 70% crown
        const trunkHeight = totalDesiredHeight * trunkHeightRatio; // 7.5 units
        const crownHeight = totalDesiredHeight * (1 - trunkHeightRatio); // 17.5 units
        const trunkRadius = 1.5;
        const crownRadius = 8.0; // Proportional crown radius
        const segments = 12; // Reduced for performance

        let vertexIndex = 0;

        // === TRUNK GEOMETRY ===
        // Trunk bottom center
        vertices.push(0, 0, 0, 0, -1, 0, 0.5, 0.0); // pos, normal, uv
        const trunkBottomCenter = vertexIndex++;

        // Trunk top center
        vertices.push(0, trunkHeight, 0, 0, 1, 0, 0.5, 0.3); // pos, normal, uv
        const trunkTopCenter = vertexIndex++;

        // Trunk bottom ring
        const trunkBottomStart = vertexIndex;
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * trunkRadius;
            const z = Math.sin(angle) * trunkRadius;

            vertices.push(x, 0, z, x / trunkRadius, 0, z / trunkRadius, i / segments, 0.0);
            vertexIndex++;
        }

        // Trunk top ring
        const trunkTopStart = vertexIndex;
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * trunkRadius * 0.8; // Slightly tapered trunk
            const z = Math.sin(angle) * trunkRadius * 0.8;

            vertices.push(
                x,
                trunkHeight,
                z,
                x / trunkRadius,
                0.2,
                z / trunkRadius,
                i / segments,
                0.3
            );
            vertexIndex++;
        }

        // === CROWN GEOMETRY ===
        // Crown top vertex
        vertices.push(0, trunkHeight + crownHeight, 0, 0, 1, 0, 0.5, 1.0);
        const crownTop = vertexIndex++;

        // Crown base ring (at trunk top)
        const crownBaseStart = vertexIndex;
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * crownRadius * 0.4; // Start smaller at base
            const z = Math.sin(angle) * crownRadius * 0.4;
            const normal = new Vector3(x, 0.3, z).normalize();

            vertices.push(x, trunkHeight, z, normal.x, normal.y, normal.z, i / segments, 0.3);
            vertexIndex++;
        }

        // Crown middle ring (widest part)
        const crownMidStart = vertexIndex;
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * crownRadius;
            const z = Math.sin(angle) * crownRadius;
            const normal = new Vector3(x, 0.1, z).normalize();

            vertices.push(
                x,
                trunkHeight + crownHeight * 0.4,
                z,
                normal.x,
                normal.y,
                normal.z,
                i / segments,
                0.6
            );
            vertexIndex++;
        }

        // Crown upper ring
        const crownUpperStart = vertexIndex;
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * crownRadius * 0.6; // Taper towards top
            const z = Math.sin(angle) * crownRadius * 0.6;
            const normal = new Vector3(x, 0.6, z).normalize();

            vertices.push(
                x,
                trunkHeight + crownHeight * 0.8,
                z,
                normal.x,
                normal.y,
                normal.z,
                i / segments,
                0.8
            );
            vertexIndex++;
        }

        // === TRUNK INDICES ===
        // Trunk bottom
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(trunkBottomCenter, trunkBottomStart + next, trunkBottomStart + i);
        }

        // Trunk sides
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(
                trunkBottomStart + i,
                trunkBottomStart + next,
                trunkTopStart + i,
                trunkTopStart + i,
                trunkBottomStart + next,
                trunkTopStart + next
            );
        }

        // === CROWN INDICES ===
        // Crown base to middle
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(
                crownBaseStart + i,
                crownBaseStart + next,
                crownMidStart + i,
                crownMidStart + i,
                crownBaseStart + next,
                crownMidStart + next
            );
        }

        // Crown middle to upper
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(
                crownMidStart + i,
                crownMidStart + next,
                crownUpperStart + i,
                crownUpperStart + i,
                crownMidStart + next,
                crownUpperStart + next
            );
        }

        // Crown upper to top
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            indices.push(crownTop, crownUpperStart + i, crownUpperStart + next);
        }

        // Create GPU buffers
        const vertexData = new Float32Array(vertices);
        const indexData = new Uint16Array(indices);

        const vertexBuffer = this.device.createBuffer({
            label: 'Tree Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        const indexBuffer = this.device.createBuffer({
            label: 'Tree Index Buffer',
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, indexData);

        this.treeGeometry = {
            vertexBuffer,
            indexBuffer,
            indexCount: indices.length,
        };

        console.log('SimpleVegetationRenderer: Created tree geometry');
        console.log('- Vertices:', vertices.length / 8, 'vertices'); // 8 floats per vertex
        console.log('- Indices:', indices.length, 'indices');
        console.log('- Triangles:', indices.length / 3, 'triangles');
        console.log('- First few vertices:', vertices.slice(0, 24)); // First 3 vertices
        console.log('- First few indices:', indices.slice(0, 12)); // First 4 triangles
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
