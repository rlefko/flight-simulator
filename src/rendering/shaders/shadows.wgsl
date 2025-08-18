// Shadow mapping utilities and functions
// Cascaded Shadow Map implementation with PCF filtering

struct ShadowUniforms {
    lightMatrix0: mat4x4<f32>,
    lightMatrix1: mat4x4<f32>,
    lightMatrix2: mat4x4<f32>,
    lightMatrix3: mat4x4<f32>,
    cascadeDistances: vec4<f32>,
    lightDirection: vec3<f32>,
    shadowBias: f32,
    lightColor: vec3<f32>,
    lightIntensity: f32,
};

// Shadow map textures and samplers
@group(1) @binding(0) var shadowMap0: texture_depth_2d;
@group(1) @binding(1) var shadowMap1: texture_depth_2d;
@group(1) @binding(2) var shadowMap2: texture_depth_2d;
@group(1) @binding(3) var shadowMap3: texture_depth_2d;
@group(1) @binding(4) var shadowSampler: sampler_comparison;
@group(1) @binding(5) var<uniform> shadowUniforms: ShadowUniforms;

/**
 * Calculate shadow cascade index based on view depth
 */
fn getShadowCascadeIndex(viewDepth: f32) -> i32 {
    if (viewDepth < shadowUniforms.cascadeDistances.x) {
        return 0;
    } else if (viewDepth < shadowUniforms.cascadeDistances.y) {
        return 1;
    } else if (viewDepth < shadowUniforms.cascadeDistances.z) {
        return 2;
    } else if (viewDepth < shadowUniforms.cascadeDistances.w) {
        return 3;
    }
    return -1; // Outside shadow range
}

/**
 * Get light space matrix for specific cascade
 */
fn getLightMatrix(cascadeIndex: i32) -> mat4x4<f32> {
    switch (cascadeIndex) {
        case 0: { return shadowUniforms.lightMatrix0; }
        case 1: { return shadowUniforms.lightMatrix1; }
        case 2: { return shadowUniforms.lightMatrix2; }
        case 3: { return shadowUniforms.lightMatrix3; }
        default: { return shadowUniforms.lightMatrix0; }
    }
}

/**
 * Sample all shadow maps and blend based on cascade index
 * This avoids non-uniform control flow for texture sampling
 */
fn sampleShadowMapUniform(lightSpacePos: vec3<f32>, cascadeWeights: vec4<f32>) -> f32 {
    let shadow0 = textureSampleCompare(shadowMap0, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
    let shadow1 = textureSampleCompare(shadowMap1, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
    let shadow2 = textureSampleCompare(shadowMap2, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
    let shadow3 = textureSampleCompare(shadowMap3, shadowSampler, lightSpacePos.xy, lightSpacePos.z);
    
    // Use weights to select the appropriate cascade result
    return shadow0 * cascadeWeights.x + 
           shadow1 * cascadeWeights.y + 
           shadow2 * cascadeWeights.z + 
           shadow3 * cascadeWeights.w;
}

/**
 * Calculate cascade weights based on cascade index
 */
fn getCascadeWeights(cascadeIndex: i32) -> vec4<f32> {
    if (cascadeIndex == 0) { return vec4<f32>(1.0, 0.0, 0.0, 0.0); }
    if (cascadeIndex == 1) { return vec4<f32>(0.0, 1.0, 0.0, 0.0); }
    if (cascadeIndex == 2) { return vec4<f32>(0.0, 0.0, 1.0, 0.0); }
    if (cascadeIndex == 3) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}

/**
 * Calculate shadow factor with PCF (Percentage Closer Filtering)
 */
fn calculateShadowPCF(cascadeIndex: i32, lightSpacePos: vec3<f32>, filterSize: f32) -> f32 {
    let texelSize = 1.0 / 2048.0; // Shadow map resolution
    let cascadeWeights = getCascadeWeights(cascadeIndex);
    var shadowSum = 0.0;
    var sampleCount = 0.0;
    
    // 5x5 PCF kernel
    for (var x = -2; x <= 2; x++) {
        for (var y = -2; y <= 2; y++) {
            let offset = vec2<f32>(f32(x), f32(y)) * texelSize * filterSize;
            let samplePos = vec3<f32>(lightSpacePos.xy + offset, lightSpacePos.z);
            shadowSum += sampleShadowMapUniform(samplePos, cascadeWeights);
            sampleCount += 1.0;
        }
    }
    
    return shadowSum / sampleCount;
}

/**
 * Calculate dynamic bias based on surface normal and light direction
 */
fn calculateShadowBias(normal: vec3<f32>, lightDir: vec3<f32>) -> f32 {
    let baseBias = shadowUniforms.shadowBias;
    let slopeScaleBias = 0.005;
    let NdotL = dot(normal, lightDir);
    return baseBias + slopeScaleBias * (1.0 - abs(NdotL));
}

/**
 * Main shadow calculation function
 */
fn calculateShadow(worldPos: vec3<f32>, normal: vec3<f32>, viewDepth: f32) -> f32 {
    // Determine which cascade to use
    let cascadeIndex = getShadowCascadeIndex(viewDepth);
    if (cascadeIndex < 0) {
        return 1.0; // No shadow outside cascade range
    }
    
    // Transform to light space
    let lightMatrix = getLightMatrix(cascadeIndex);
    let lightSpacePos4 = lightMatrix * vec4<f32>(worldPos, 1.0);
    var lightSpacePos = lightSpacePos4.xyz / lightSpacePos4.w;
    
    // Convert to texture coordinates
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * -0.5 + 0.5; // Flip Y for texture sampling
    
    // Check if position is within shadow map bounds
    if (lightSpacePos.x < 0.0 || lightSpacePos.x > 1.0 || 
        lightSpacePos.y < 0.0 || lightSpacePos.y > 1.0 || 
        lightSpacePos.z < 0.0 || lightSpacePos.z > 1.0) {
        return 1.0; // Outside shadow map bounds
    }
    
    // Apply bias to prevent shadow acne
    let bias = calculateShadowBias(normal, shadowUniforms.lightDirection);
    lightSpacePos.z -= bias;
    
    // Calculate soft shadow with PCF
    let filterSize = 1.0 + f32(cascadeIndex) * 0.5; // Larger filter for distant cascades
    return calculateShadowPCF(cascadeIndex, lightSpacePos, filterSize);
}

/**
 * Calculate directional lighting with shadows
 */
fn calculateDirectionalLight(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    viewDir: vec3<f32>,
    albedo: vec3<f32>,
    roughness: f32,
    metallic: f32,
    viewDepth: f32
) -> vec3<f32> {
    let lightDir = -shadowUniforms.lightDirection;
    let lightColor = shadowUniforms.lightColor * shadowUniforms.lightIntensity;
    
    // Calculate shadow factor
    let shadowFactor = calculateShadow(worldPos, normal, viewDepth);
    
    // Basic Blinn-Phong lighting
    let NdotL = max(dot(normal, lightDir), 0.0);
    let halfVector = normalize(lightDir + viewDir);
    let NdotH = max(dot(normal, halfVector), 0.0);
    
    // Diffuse term
    let diffuse = albedo * NdotL;
    
    // Specular term (simplified)
    let shininess = (1.0 - roughness) * 256.0;
    let specular = pow(NdotH, shininess) * (1.0 - metallic);
    
    // Combine lighting with shadow
    return (diffuse + specular) * lightColor * shadowFactor;
}

/**
 * Visualize shadow cascades (debug function)
 */
fn debugCascadeColor(viewDepth: f32) -> vec3<f32> {
    let cascadeIndex = getShadowCascadeIndex(viewDepth);
    switch (cascadeIndex) {
        case 0: { return vec3<f32>(1.0, 0.0, 0.0); } // Red
        case 1: { return vec3<f32>(0.0, 1.0, 0.0); } // Green
        case 2: { return vec3<f32>(0.0, 0.0, 1.0); } // Blue
        case 3: { return vec3<f32>(1.0, 1.0, 0.0); } // Yellow
        default: { return vec3<f32>(1.0, 1.0, 1.0); } // White
    }
}

/**
 * Atmospheric scattering for distance fog
 */
fn calculateAtmosphericScattering(
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    lightDir: vec3<f32>
) -> vec3<f32> {
    let distance = length(worldPos - cameraPos);
    let scatteringCoeff = 0.00001;
    let scattering = 1.0 - exp(-distance * scatteringCoeff);
    
    // Simple Rayleigh scattering approximation
    let sunDirection = -lightDir;
    let viewDirection = normalize(worldPos - cameraPos);
    let cosTheta = dot(viewDirection, sunDirection);
    
    // Mie scattering for haze
    let miePhase = (1.0 + cosTheta * cosTheta) * 0.5;
    
    // Sky color based on sun angle
    let skyColor = mix(
        vec3<f32>(0.5, 0.7, 1.0), // Blue sky
        vec3<f32>(1.0, 0.8, 0.6), // Sunset colors
        max(0.0, sunDirection.y) * 0.5
    );
    
    return skyColor * scattering * miePhase;
}

/**
 * Calculate distance-based fog
 */
fn calculateDistanceFog(
    color: vec3<f32>,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    fogStart: f32,
    fogEnd: f32,
    fogColor: vec3<f32>
) -> vec3<f32> {
    let distance = length(worldPos - cameraPos);
    let fogFactor = clamp((fogEnd - distance) / (fogEnd - fogStart), 0.0, 1.0);
    return mix(fogColor, color, fogFactor);
}