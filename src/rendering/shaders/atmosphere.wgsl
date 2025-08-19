// Atmospheric Scattering Shader for Photorealistic Flight Simulator
// Implements physically-based Rayleigh and Mie scattering with proper aerial perspective

// Atmospheric constants based on real-world values
const EARTH_RADIUS = 6371000.0;
const ATMOSPHERE_HEIGHT = 100000.0;
const RAYLEIGH_SCALE_HEIGHT = 8000.0;
const MIE_SCALE_HEIGHT = 1200.0;

// Scattering coefficients at sea level (per meter)
const RAYLEIGH_COEFFICIENT = vec3<f32>(5.8e-6, 13.5e-6, 33.1e-6); // Blue scatters more
const MIE_COEFFICIENT = 21e-6;

// Atmospheric parameters
const SUN_INTENSITY = 20.0;
const NUM_SCATTERING_SAMPLES = 16;
const NUM_OPTICAL_DEPTH_SAMPLES = 8;

struct AtmosphereUniforms {
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    earthRadius: f32,
    atmosphereRadius: f32,
    rayleighScaleHeight: f32,
    mieScaleHeight: f32,
    rayleighCoeff: vec3<f32>,
    mieCoeff: f32,
    mieG: f32, // Mie scattering asymmetry parameter
    exposure: f32,
    fogDensity: f32,
    fogHeightFalloff: f32,
};

// Calculate atmospheric density at given height using exponential falloff
fn getAtmosphericDensity(height: f32, scaleHeight: f32) -> f32 {
    return exp(-height / scaleHeight);
}

// Calculate Rayleigh scattering phase function
fn rayleighPhase(cosTheta: f32) -> f32 {
    return 3.0 / (16.0 * 3.14159) * (1.0 + cosTheta * cosTheta);
}

// Calculate Mie scattering phase function using Henyey-Greenstein
fn miePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let cos2 = cosTheta * cosTheta;
    return 3.0 / (8.0 * 3.14159) * ((1.0 - g2) / (2.0 + g2)) * 
           (1.0 + cos2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
}

// Ray-sphere intersection for atmospheric scattering calculations
fn raySphereIntersection(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, sphereRadius: f32) -> vec2<f32> {
    let b = dot(rayOrigin, rayDirection);
    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    let discriminant = b * b - c;
    
    if (discriminant < 0.0) {
        return vec2<f32>(-1.0, -1.0); // No intersection
    }
    
    let sqrtD = sqrt(discriminant);
    return vec2<f32>(-b - sqrtD, -b + sqrtD);
}

// Calculate optical depth along a ray through the atmosphere
fn calculateOpticalDepth(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, rayLength: f32, 
                        scaleHeight: f32, numSamples: i32) -> f32 {
    let stepSize = rayLength / f32(numSamples);
    var opticalDepth = 0.0;
    
    for (var i = 0; i < numSamples; i++) {
        let samplePoint = rayOrigin + rayDirection * (f32(i) + 0.5) * stepSize;
        let height = length(samplePoint) - EARTH_RADIUS;
        let density = getAtmosphericDensity(height, scaleHeight);
        opticalDepth += density * stepSize;
    }
    
    return opticalDepth;
}

// Calculate atmospheric scattering for a given ray
fn calculateAtmosphericScattering(
    rayOrigin: vec3<f32>, 
    rayDirection: vec3<f32>, 
    rayLength: f32,
    sunDirection: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> vec3<f32> {
    // Sample points along the ray
    let stepSize = rayLength / f32(NUM_SCATTERING_SAMPLES);
    var rayleighResult = vec3<f32>(0.0);
    var mieResult = vec3<f32>(0.0);
    
    // Calculate phase functions
    let cosTheta = dot(rayDirection, sunDirection);
    let rayleighPhaseValue = rayleighPhase(cosTheta);
    let miePhaseValue = miePhase(cosTheta, atmosphere.mieG);
    
    for (var i = 0; i < NUM_SCATTERING_SAMPLES; i++) {
        let samplePoint = rayOrigin + rayDirection * (f32(i) + 0.5) * stepSize;
        let height = length(samplePoint) - atmosphere.earthRadius;
        
        // Calculate atmospheric densities
        let rayleighDensity = getAtmosphericDensity(height, atmosphere.rayleighScaleHeight);
        let mieDensity = getAtmosphericDensity(height, atmosphere.mieScaleHeight);
        
        // Calculate optical depth from sample point to sun
        let sunIntersection = raySphereIntersection(samplePoint, sunDirection, atmosphere.atmosphereRadius);
        if (sunIntersection.y > 0.0) {
            let sunRayLength = sunIntersection.y;
            let rayleighOpticalDepthSun = calculateOpticalDepth(
                samplePoint, sunDirection, sunRayLength, 
                atmosphere.rayleighScaleHeight, NUM_OPTICAL_DEPTH_SAMPLES
            );
            let mieOpticalDepthSun = calculateOpticalDepth(
                samplePoint, sunDirection, sunRayLength, 
                atmosphere.mieScaleHeight, NUM_OPTICAL_DEPTH_SAMPLES
            );
            
            // Calculate optical depth from ray origin to sample point
            let rayleighOpticalDepthRay = calculateOpticalDepth(
                rayOrigin, rayDirection, (f32(i) + 0.5) * stepSize,
                atmosphere.rayleighScaleHeight, i + 1
            );
            let mieOpticalDepthRay = calculateOpticalDepth(
                rayOrigin, rayDirection, (f32(i) + 0.5) * stepSize,
                atmosphere.mieScaleHeight, i + 1
            );
            
            // Calculate total optical depth
            let rayleighOpticalDepth = rayleighOpticalDepthSun + rayleighOpticalDepthRay;
            let mieOpticalDepth = mieOpticalDepthSun + mieOpticalDepthRay;
            
            // Calculate transmittance
            let rayleighTransmittance = exp(-atmosphere.rayleighCoeff * rayleighOpticalDepth);
            let mieTransmittance = exp(-atmosphere.mieCoeff * mieOpticalDepth);
            
            // Accumulate scattering
            rayleighResult += rayleighTransmittance * rayleighDensity;
            mieResult += mieTransmittance * mieDensity;
        }
    }
    
    // Apply phase functions and coefficients
    rayleighResult *= atmosphere.rayleighCoeff * rayleighPhaseValue * stepSize;
    mieResult *= atmosphere.mieCoeff * miePhaseValue * stepSize;
    
    return (rayleighResult + mieResult) * atmosphere.sunIntensity;
}

// Calculate simple atmospheric scattering for performance
fn calculateSimpleAtmosphericScattering(
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    sunDirection: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> vec3<f32> {
    let viewDirection = normalize(worldPos - cameraPos);
    let distance = length(worldPos - cameraPos);
    
    // Simple distance-based scattering
    let scatteringFactor = 1.0 - exp(-distance * 0.00001);
    
    // Calculate phase function
    let cosTheta = dot(viewDirection, sunDirection);
    let rayleighPhaseValue = rayleighPhase(cosTheta);
    let miePhaseValue = miePhase(cosTheta, atmosphere.mieG);
    
    // Simplified atmospheric colors
    let rayleighColor = vec3<f32>(0.3, 0.6, 1.0); // Blue sky
    let mieColor = vec3<f32>(1.0, 0.9, 0.8); // Warm haze
    
    // Sun disk enhancement
    let sunFactor = pow(max(0.0, cosTheta), 32.0);
    let sunColor = vec3<f32>(1.0, 0.9, 0.7);
    
    return (rayleighColor * rayleighPhaseValue + mieColor * miePhaseValue + 
            sunColor * sunFactor) * scatteringFactor * atmosphere.sunIntensity;
}

// Calculate exponential height fog
fn calculateHeightFog(
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> f32 {
    let distance = length(worldPos - cameraPos);
    let heightDifference = abs(worldPos.y - cameraPos.y);
    
    // Exponential height falloff
    let heightFactor = exp(-heightDifference * atmosphere.fogHeightFalloff);
    
    // Distance-based fog density
    let fogFactor = 1.0 - exp(-distance * atmosphere.fogDensity * heightFactor);
    
    return clamp(fogFactor, 0.0, 1.0);
}

// Calculate aerial perspective (distance-based color shifts)
fn calculateAerialPerspective(
    originalColor: vec3<f32>,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    sunDirection: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> vec3<f32> {
    let distance = length(worldPos - cameraPos);
    let viewDirection = normalize(worldPos - cameraPos);
    
    // Distance-based perspective shifts
    let perspectiveFactor = 1.0 - exp(-distance * 0.00005);
    
    // Blue shift at distance (Rayleigh scattering dominance)
    let blueShift = vec3<f32>(0.7, 0.8, 1.0);
    
    // Contrast reduction at distance
    let contrastReduction = mix(1.0, 0.3, perspectiveFactor);
    
    // Apply aerial perspective
    var aerialColor = mix(originalColor, blueShift, perspectiveFactor * 0.3);
    
    // Reduce contrast
    let luminance = dot(aerialColor, vec3<f32>(0.299, 0.587, 0.114));
    aerialColor = mix(vec3<f32>(luminance), aerialColor, contrastReduction);
    
    return aerialColor;
}

// Calculate sky ambient lighting based on atmospheric scattering
fn calculateSkyAmbient(
    normal: vec3<f32>,
    sunDirection: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> vec3<f32> {
    // Sky dome sampling for ambient lighting
    let skyUp = vec3<f32>(0.0, 1.0, 0.0);
    let skyColor = vec3<f32>(0.4, 0.7, 1.0); // Blue sky
    let groundColor = vec3<f32>(0.2, 0.15, 0.1); // Earth tones
    
    // Hemisphere lighting
    let skyFactor = max(0.0, dot(normal, skyUp));
    let ambientColor = mix(groundColor, skyColor, skyFactor);
    
    // Sun influence on ambient
    let sunInfluence = max(0.0, sunDirection.y) * 0.5 + 0.5;
    
    return ambientColor * sunInfluence * atmosphere.sunIntensity * 0.2;
}

// Enhanced tone mapping with ACES approximation
fn toneMapACES(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    let exposedColor = color * exposure;
    
    // ACES tone mapping approximation
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    
    return clamp((exposedColor * (a * exposedColor + b)) / 
                 (exposedColor * (c * exposedColor + d) + e), 
                 vec3<f32>(0.0), vec3<f32>(1.0));
}

// Time-of-day sun positioning
fn calculateSunPosition(timeOfDay: f32) -> vec3<f32> {
    // timeOfDay: 0.0 = midnight, 0.5 = noon, 1.0 = midnight
    let sunAngle = (timeOfDay - 0.5) * 2.0 * 3.14159;
    
    // Sun path across the sky
    let sunHeight = sin(sunAngle);
    let sunAzimuth = cos(sunAngle);
    
    return normalize(vec3<f32>(sunAzimuth, sunHeight, 0.0));
}

// Calculate atmospheric lighting contribution for terrain
fn calculateAtmosphericLighting(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    albedo: vec3<f32>,
    cameraPos: vec3<f32>,
    sunDirection: vec3<f32>,
    atmosphere: AtmosphereUniforms
) -> vec3<f32> {
    // Base lighting calculation
    var finalColor = albedo;
    
    // Direct sunlight
    let sunDot = max(0.0, dot(normal, sunDirection));
    let sunColor = vec3<f32>(1.0, 0.95, 0.8) * atmosphere.sunIntensity;
    finalColor += albedo * sunColor * sunDot * 0.8;
    
    // Sky ambient lighting
    let ambientLight = calculateSkyAmbient(normal, sunDirection, atmosphere);
    finalColor += albedo * ambientLight;
    
    // Atmospheric scattering
    let scatteredLight = calculateSimpleAtmosphericScattering(
        worldPos, cameraPos, sunDirection, atmosphere
    );
    finalColor += scatteredLight * 0.1;
    
    // Aerial perspective
    finalColor = calculateAerialPerspective(
        finalColor, worldPos, cameraPos, sunDirection, atmosphere
    );
    
    // Height fog
    let fogFactor = calculateHeightFog(worldPos, cameraPos, atmosphere);
    let skyColor = vec3<f32>(0.6, 0.8, 1.0) * atmosphere.sunIntensity * 0.3;
    finalColor = mix(finalColor, skyColor, fogFactor);
    
    return finalColor;
}

// Simplified atmospheric effect for integration into existing shaders
fn applyAtmosphericEffects(
    color: vec3<f32>,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    fogDensity: f32
) -> vec3<f32> {
    let distance = length(worldPos - cameraPos);
    let viewDirection = normalize(worldPos - cameraPos);
    
    // Atmospheric scattering
    let cosTheta = dot(viewDirection, sunDirection);
    let scatteringFactor = 1.0 - exp(-distance * 0.000015);
    
    // Rayleigh scattering (blue)
    let rayleighPhaseValue = 3.0 / (16.0 * 3.14159) * (1.0 + cosTheta * cosTheta);
    let rayleighColor = vec3<f32>(0.3, 0.6, 1.0) * rayleighPhaseValue;
    
    // Mie scattering (haze)
    let mieG = 0.8;
    let miePhaseValue = 3.0 / (8.0 * 3.14159) * ((1.0 - mieG * mieG) / (2.0 + mieG * mieG)) * 
                       (1.0 + cosTheta * cosTheta) / pow(1.0 + mieG * mieG - 2.0 * mieG * cosTheta, 1.5);
    let mieColor = vec3<f32>(1.0, 0.9, 0.8) * miePhaseValue;
    
    // Sun glow
    let sunFactor = pow(max(0.0, cosTheta), 16.0);
    let sunColor = vec3<f32>(1.0, 0.9, 0.7);
    
    // Combine atmospheric effects
    let atmosphericLight = (rayleighColor + mieColor + sunColor * sunFactor) * 
                          scatteringFactor * sunIntensity * 0.15;
    
    // Distance fog
    let fogFactor = 1.0 - exp(-distance * fogDensity);
    let fogColor = (rayleighColor + mieColor * 0.5) * sunIntensity * 0.5;
    
    // Apply effects
    var finalColor = color + atmosphericLight;
    finalColor = mix(finalColor, fogColor, fogFactor);
    
    return finalColor;
}