// Advanced water surface rendering with reflections and refraction
// Includes realistic wave simulation, Fresnel effects, and foam rendering

struct WaterUniforms {
    mvpMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    invViewProjection: mat4x4<f32>,
    cameraPosition: vec3<f32>,
    time: f32,
    waveDirection: vec2<f32>,
    waveAmplitude: f32,
    waveFrequency: f32,
    waveSpeed: f32,
    waveChoppiness: f32,
    windSpeed: f32,
    reflectionStrength: f32,
    refractionStrength: f32,
    fresnelPower: f32,
    normalMapScale: f32,
    foamScale: f32,
};

struct WaterMaterial {
    deepColor: vec3<f32>,
    shallowColor: vec3<f32>,
    foamColor: vec3<f32>,
    scatteringColor: vec3<f32>,
    absorptionColor: vec3<f32>,
    transparency: f32,
    roughness: f32,
    metallic: f32,
    refractionIndex: f32,
    depthFalloff: f32,
    foamCutoff: f32,
    foamFalloff: f32,
};

// Textures and samplers
@group(0) @binding(0) var<uniform> waterUniforms: WaterUniforms;
@group(0) @binding(1) var<uniform> waterMaterial: WaterMaterial;
@group(0) @binding(2) var reflectionTexture: texture_2d<f32>;
@group(0) @binding(3) var refractionTexture: texture_2d<f32>;
@group(0) @binding(4) var depthTexture: texture_depth_2d;
@group(0) @binding(5) var normalMap0: texture_2d<f32>;
@group(0) @binding(6) var normalMap1: texture_2d<f32>;
@group(0) @binding(7) var foamTexture: texture_2d<f32>;
@group(0) @binding(8) var dudvTexture: texture_2d<f32>;
@group(0) @binding(9) var linearSampler: sampler;
@group(0) @binding(10) var depthSampler: sampler;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) worldPos: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) viewPos: vec4<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) clipSpacePos: vec4<f32>,
    @location(4) toCameraVector: vec3<f32>,
    @location(5) fromLightVector: vec3<f32>,
    @location(6) normal: vec3<f32>,
};

/**
 * Generate wave height using Gerstner waves
 */
fn calculateGerstnerWave(
    position: vec2<f32>,
    direction: vec2<f32>,
    steepness: f32,
    wavelength: f32,
    time: f32
) -> vec3<f32> {
    let k = 2.0 * 3.14159 / wavelength;
    let c = sqrt(9.8 / k);
    let d = normalize(direction);
    let f = k * (dot(d, position) - c * time);
    let a = steepness / k;
    
    return vec3<f32>(
        d.x * a * sin(f),
        a * cos(f),
        d.y * a * sin(f)
    );
}

/**
 * Calculate composite wave displacement and normal
 */
fn calculateWaveDisplacement(worldPos: vec2<f32>, time: f32) -> vec4<f32> {
    var displacement = vec3<f32>(0.0);
    var normal = vec3<f32>(0.0, 1.0, 0.0);
    
    // Multiple wave components for realistic water
    let wave1 = calculateGerstnerWave(worldPos, vec2<f32>(1.0, 0.0), 0.25, 60.0, time);
    let wave2 = calculateGerstnerWave(worldPos, vec2<f32>(1.0, 0.6), 0.15, 31.0, time * 1.3);
    let wave3 = calculateGerstnerWave(worldPos, vec2<f32>(1.0, 1.3), 0.1, 18.0, time * 1.7);
    let wave4 = calculateGerstnerWave(worldPos, vec2<f32>(1.0, -0.8), 0.05, 9.0, time * 2.1);
    
    displacement += wave1 + wave2 + wave3 + wave4;
    displacement *= waterUniforms.waveAmplitude;
    
    // Calculate normal from wave gradients
    let epsilon = 1.0;
    let pos = worldPos;
    let heightR = calculateGerstnerWave(pos + vec2<f32>(epsilon, 0.0), vec2<f32>(1.0, 0.0), 0.25, 60.0, time).y;
    let heightL = calculateGerstnerWave(pos - vec2<f32>(epsilon, 0.0), vec2<f32>(1.0, 0.0), 0.25, 60.0, time).y;
    let heightU = calculateGerstnerWave(pos + vec2<f32>(0.0, epsilon), vec2<f32>(1.0, 0.0), 0.25, 60.0, time).y;
    let heightD = calculateGerstnerWave(pos - vec2<f32>(0.0, epsilon), vec2<f32>(1.0, 0.0), 0.25, 60.0, time).y;
    
    normal = normalize(vec3<f32>(
        (heightL - heightR) / (2.0 * epsilon),
        1.0,
        (heightD - heightU) / (2.0 * epsilon)
    ));
    
    return vec4<f32>(displacement, normal.y);
}

@vertex
fn vs_water(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Calculate wave displacement
    let waveData = calculateWaveDisplacement(input.worldPos.xz, waterUniforms.time);
    let displacedPos = input.worldPos + waveData.xyz;
    
    output.worldPos = displacedPos;
    output.position = waterUniforms.mvpMatrix * vec4<f32>(displacedPos, 1.0);
    output.viewPos = waterUniforms.viewMatrix * vec4<f32>(displacedPos, 1.0);
    output.clipSpacePos = output.position;
    output.uv = input.uv;
    output.toCameraVector = waterUniforms.cameraPosition - displacedPos;
    output.fromLightVector = vec3<f32>(0.3, -0.8, 0.5); // Light direction
    output.normal = input.normal; // Will be modified in fragment shader
    
    return output;
}

/**
 * Sample normal map with animation
 */
fn sampleNormalMap(uv: vec2<f32>, time: f32, scale: f32) -> vec3<f32> {
    let speed = 0.03;
    let uv1 = uv * scale + vec2<f32>(time * speed, 0.0);
    let uv2 = uv * scale * 0.7 + vec2<f32>(-time * speed * 0.8, time * speed * 0.6);
    
    let normal1 = textureSample(normalMap0, linearSampler, uv1).xyz * 2.0 - 1.0;
    let normal2 = textureSample(normalMap1, linearSampler, uv2).xyz * 2.0 - 1.0;
    
    return normalize(normal1 + normal2);
}

/**
 * Calculate Fresnel reflectance
 */
fn calculateFresnel(viewVector: vec3<f32>, normal: vec3<f32>, refractionIndex: f32) -> f32 {
    let cosTheta = abs(dot(viewVector, normal));
    let r0 = pow((1.0 - refractionIndex) / (1.0 + refractionIndex), 2.0);
    return r0 + (1.0 - r0) * pow(1.0 - cosTheta, waterUniforms.fresnelPower);
}

/**
 * Calculate water depth from depth buffer
 */
fn calculateWaterDepth(screenPos: vec2<f32>, waterDepth: f32) -> f32 {
    let sceneDepth = textureSample(depthTexture, depthSampler, screenPos).r;
    let linearSceneDepth = linearizeDepth(sceneDepth);
    let linearWaterDepth = linearizeDepth(waterDepth);
    return linearSceneDepth - linearWaterDepth;
}

/**
 * Convert depth buffer value to linear depth
 */
fn linearizeDepth(depth: f32) -> f32 {
    let near = 0.1;
    let far = 100000.0;
    return (2.0 * near) / (far + near - depth * (far - near));
}

/**
 * Calculate foam based on wave height and shore proximity
 */
fn calculateFoam(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    waveHeight: f32,
    depth: f32,
    time: f32
) -> f32 {
    // Foam from wave crests
    let wavefoam = smoothstep(waterMaterial.foamCutoff, 1.0, waveHeight);
    
    // Foam from shallow water/shore
    let depthFoam = 1.0 - smoothstep(0.0, waterMaterial.foamFalloff, depth);
    
    // Animate foam texture
    let foamUV = worldPos.xz * waterUniforms.foamScale + time * 0.1;
    let foamPattern = textureSample(foamTexture, linearSampler, foamUV).r;
    
    let totalFoam = max(wavefoam, depthFoam) * foamPattern;
    return smoothstep(0.4, 0.8, totalFoam);
}

/**
 * Calculate subsurface scattering approximation
 */
fn calculateSubsurfaceScattering(
    lightDir: vec3<f32>,
    viewDir: vec3<f32>,
    normal: vec3<f32>,
    depth: f32
) -> vec3<f32> {
    let scatterDir = lightDir + normal * 0.3;
    let scatter = pow(max(0.0, dot(viewDir, -scatterDir)), 4.0);
    let scatterColor = waterMaterial.scatteringColor;
    let depthAttenuation = exp(-depth * 0.1);
    
    return scatterColor * scatter * depthAttenuation;
}

@fragment
fn fs_water(input: VertexOutput) -> @location(0) vec4<f32> {
    // Screen space coordinates for sampling reflection/refraction
    let screenPos = input.clipSpacePos.xy / input.clipSpacePos.w;
    let screenUV = screenPos * 0.5 + 0.5;
    let correctedUV = vec2<f32>(screenUV.x, 1.0 - screenUV.y);
    
    // Calculate view direction
    let viewDirection = normalize(input.toCameraVector);
    let distance = length(input.toCameraVector);
    
    // Sample and combine normal maps
    let normalMapSample = sampleNormalMap(input.uv, waterUniforms.time, waterUniforms.normalMapScale);
    let surfaceNormal = normalize(input.normal + normalMapSample * 0.3);
    
    // Calculate water depth
    let waterDepth = calculateWaterDepth(correctedUV, input.clipSpacePos.z);
    let clampedDepth = max(0.0, waterDepth);
    
    // Calculate distortion for reflection/refraction
    let dudvSample = textureSample(dudvTexture, linearSampler, input.uv + waterUniforms.time * 0.02).rg;
    let distortion = (dudvSample * 2.0 - 1.0) * 0.02;
    
    // Sample reflection with distortion
    let reflectionUV = clamp(correctedUV + distortion * waterUniforms.reflectionStrength, 0.0, 1.0);
    let reflectionColor = textureSample(reflectionTexture, linearSampler, reflectionUV).rgb;
    
    // Sample refraction with distortion
    let refractionUV = clamp(correctedUV + distortion * waterUniforms.refractionStrength, 0.0, 1.0);
    let refractionColor = textureSample(refractionTexture, linearSampler, refractionUV).rgb;
    
    // Calculate Fresnel factor
    let fresnel = calculateFresnel(viewDirection, surfaceNormal, waterMaterial.refractionIndex);
    
    // Water color based on depth
    let depthFactor = 1.0 - exp(-clampedDepth * waterMaterial.depthFalloff);
    let waterColor = mix(waterMaterial.shallowColor, waterMaterial.deepColor, depthFactor);
    
    // Modulate refraction with water color
    let modulatedRefraction = mix(refractionColor, refractionColor * waterColor, depthFactor);
    
    // Combine reflection and refraction based on Fresnel
    var finalColor = mix(modulatedRefraction, reflectionColor, fresnel);
    
    // Add subsurface scattering
    let lightDirection = normalize(input.fromLightVector);
    let scattering = calculateSubsurfaceScattering(
        lightDirection, viewDirection, surfaceNormal, clampedDepth
    );
    finalColor += scattering;
    
    // Calculate and apply foam
    let waveHeight = calculateWaveDisplacement(input.worldPos.xz, waterUniforms.time).w;
    let foam = calculateFoam(input.worldPos, surfaceNormal, waveHeight, clampedDepth, waterUniforms.time);
    finalColor = mix(finalColor, waterMaterial.foamColor, foam);
    
    // Apply absorption based on depth
    let absorption = exp(-clampedDepth * waterMaterial.absorptionColor);
    finalColor *= absorption;
    
    // Calculate transparency
    let depthTransparency = exp(-clampedDepth * 0.3);
    let alpha = waterMaterial.transparency + (1.0 - waterMaterial.transparency) * depthTransparency;
    
    // Distance fog
    let fogStart = 5000.0;
    let fogEnd = 50000.0;
    let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
    let fogColor = vec3<f32>(0.7, 0.8, 0.9);
    finalColor = mix(fogColor, finalColor, fogFactor);
    
    return vec4<f32>(finalColor, alpha);
}

/**
 * Utility functions for water rendering
 */

// Generate procedural water texture coordinates
fn getWaterUV(worldPos: vec3<f32>, time: f32, scale: f32, speed: f32) -> vec2<f32> {
    return worldPos.xz * scale + time * speed;
}

// Calculate wave foam intensity based on steepness
fn calculateWaveFoam(normal: vec3<f32>, steepness: f32) -> f32 {
    let foam = 1.0 - normal.y;
    return pow(foam * steepness, 2.0);
}

// Simulate underwater caustics effect
fn calculateCaustics(worldPos: vec3<f32>, time: f32) -> f32 {
    let causticUV = worldPos.xz * 0.1 + time * 0.05;
    let caustic1 = sin(causticUV.x * 6.28) * cos(causticUV.y * 6.28);
    let caustic2 = sin((causticUV.x + causticUV.y) * 4.0 + time) * 0.5;
    return max(0.0, caustic1 + caustic2) * 0.3;
}

// Calculate edge foam near shoreline
fn calculateEdgeFoam(depth: f32, waveHeight: f32) -> f32 {
    let edgeDetection = smoothstep(0.0, 2.0, depth);
    let waveContribution = waveHeight * 0.5;
    return (1.0 - edgeDetection) + waveContribution;
}