// Enhanced water shader with Gerstner waves, reflections, and caustics
struct Uniforms {
    mvpMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    cameraPosition: vec3<f32>,
    time: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) depth: f32,
}

// Gerstner wave function for realistic ocean waves
fn gerstnerWave(pos: vec2<f32>, direction: vec2<f32>, amplitude: f32, wavelength: f32, speed: f32, time: f32) -> vec3<f32> {
    let k = 2.0 * 3.14159265 / wavelength;
    let c = sqrt(9.8 / k);
    let d = normalize(direction);
    let f = k * dot(d, pos) - c * speed * time;
    let a = amplitude / k;
    
    return vec3<f32>(
        d.x * a * sin(f),
        a * cos(f),
        d.y * a * sin(f)
    );
}

// Calculate Gerstner wave normal
fn gerstnerWaveNormal(pos: vec2<f32>, direction: vec2<f32>, amplitude: f32, wavelength: f32, speed: f32, time: f32) -> vec3<f32> {
    let k = 2.0 * 3.14159265 / wavelength;
    let c = sqrt(9.8 / k);
    let d = normalize(direction);
    let f = k * dot(d, pos) - c * speed * time;
    let dPdf = amplitude * sin(f);
    
    return vec3<f32>(
        -d.x * dPdf,
        1.0,
        -d.y * dPdf
    );
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    var worldPos = input.position;
    let waveTime = uniforms.time;
    
    // Combine multiple Gerstner waves for realistic ocean surface
    var displacement = vec3<f32>(0.0);
    var normal = vec3<f32>(0.0, 1.0, 0.0);
    
    // Large ocean swells
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(1.0, 0.3), 1.2, 180.0, 1.0, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(1.0, 0.3), 1.2, 180.0, 1.0, waveTime);
    
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(0.7, -1.0), 0.8, 120.0, 1.2, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(0.7, -1.0), 0.8, 120.0, 1.2, waveTime);
    
    // Medium waves
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(-0.5, 1.2), 0.6, 45.0, 1.5, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(-0.5, 1.2), 0.6, 45.0, 1.5, waveTime);
    
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(1.3, 0.8), 0.4, 28.0, 1.8, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(1.3, 0.8), 0.4, 28.0, 1.8, waveTime);
    
    // Small ripples
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(0.9, -0.6), 0.15, 8.0, 2.5, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(0.9, -0.6), 0.15, 8.0, 2.5, waveTime);
    
    displacement += gerstnerWave(worldPos.xz, vec2<f32>(-1.1, 1.4), 0.1, 3.5, 3.0, waveTime);
    normal += gerstnerWaveNormal(worldPos.xz, vec2<f32>(-1.1, 1.4), 0.1, 3.5, 3.0, waveTime);
    
    // Apply wave displacement
    worldPos += displacement;
    
    output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
    output.worldPos = worldPos;
    output.normal = normalize(normal);
    output.uv = input.uv;
    
    // Calculate depth for shading
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
    output.depth = -viewPos.z;
    
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let waveTime = uniforms.time;
    
    // More realistic ocean water colors - much darker and more saturated
    let coastalColor = vec3<f32>(0.15, 0.35, 0.45);   // Darker coastal water
    let shallowColor = vec3<f32>(0.08, 0.25, 0.40);   // Darker shallow ocean
    let midColor = vec3<f32>(0.04, 0.12, 0.24);       // Deep ocean blue (as requested)
    let deepColor = vec3<f32>(0.02, 0.08, 0.18);      // Very deep ocean
    
    // Calculate depth-based color using both distance and actual wave depth
    let cameraDistance = length(uniforms.cameraPosition - input.worldPos);
    let normalizedDistance = clamp(cameraDistance * 0.0008, 0.0, 4.0); // Slower transition
    
    // Use wave height as additional depth factor
    let waveDepth = max(0.0, -input.worldPos.y); // Depth below sea level
    let depthFactor = clamp(waveDepth * 0.1, 0.0, 1.0);
    
    let distanceFactor1 = clamp(normalizedDistance, 0.0, 1.0);
    let distanceFactor2 = clamp(normalizedDistance - 1.0, 0.0, 1.0); 
    let distanceFactor3 = clamp(normalizedDistance - 2.0, 0.0, 1.0);
    
    var waterColor = mix(coastalColor, shallowColor, distanceFactor1);
    waterColor = mix(waterColor, midColor, distanceFactor2);
    waterColor = mix(waterColor, deepColor, distanceFactor3);
    
    // Apply depth-based darkening
    waterColor = mix(waterColor, deepColor, depthFactor);
    
    // Enhanced lighting and reflections
    let lightDir = normalize(vec3<f32>(0.3, 0.7, 0.4)); // Softer light angle
    let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
    
    // Add small-scale normal perturbation for surface detail
    let detailNormal = vec3<f32>(
        sin(input.worldPos.x * 0.15 + waveTime * 1.8) * 0.06 + sin(input.worldPos.x * 0.4 + waveTime * 3.2) * 0.03,
        1.0,
        cos(input.worldPos.z * 0.13 + waveTime * 1.6) * 0.06 + cos(input.worldPos.z * 0.38 + waveTime * 2.6) * 0.03
    );
    let surfaceNormal = normalize(mix(input.normal, detailNormal, 0.4));
    
    // More accurate Fresnel reflection calculation
    let F0 = 0.02; // Water's reflectance at normal incidence
    let cosTheta = max(dot(viewDir, surfaceNormal), 0.0);
    let fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
    
    // More realistic sky reflection colors
    let skyZenith = vec3<f32>(0.15, 0.35, 0.65);    // Darker, more realistic sky
    let skyHorizon = vec3<f32>(0.55, 0.65, 0.85);   // Softer horizon
    let upDot = max(dot(reflect(-viewDir, surfaceNormal), vec3<f32>(0.0, 1.0, 0.0)), 0.0);
    let skyColor = mix(skyHorizon, skyZenith, upDot);
    let skyReflection = skyColor * fresnel * 0.6; // Reduced reflection intensity
    
    // Sun reflection - more controlled
    let sunDir = lightDir;
    let reflectDir = reflect(-lightDir, surfaceNormal);
    let specularPower = mix(64.0, 256.0, fresnel); // Sharper highlights
    let sunReflection = pow(max(dot(viewDir, reflectDir), 0.0), specularPower) * fresnel;
    let sunColor = vec3<f32>(1.0, 0.9, 0.7); // Warmer sun color
    
    // Improved caustics for shallow water
    let causticsStrength = 1.0 - smoothstep(0.0, 2.0, normalizedDistance);
    let causticTime = waveTime * 0.6;
    let causticUV = input.worldPos.xz * 0.02;
    let causticPattern1 = sin(causticUV.x * 12.0 + causticTime) * cos(causticUV.y * 8.0 + causticTime * 1.2);
    let causticPattern2 = sin(causticUV.x * 16.0 - causticTime * 1.3) * cos(causticUV.y * 11.0 + causticTime * 0.9);
    let causticPattern3 = sin((causticUV.x + causticUV.y) * 7.0 + causticTime * 2.0) * 0.5;
    let caustics = causticsStrength * max(0.0, (causticPattern1 * causticPattern2 + causticPattern3)) * 0.08;
    
    // Foam from wave crests - more realistic
    let waveHeight = input.worldPos.y;
    let foamThreshold = 0.6;
    let foamFalloff = 0.4;
    var foamIntensity = smoothstep(foamThreshold, foamThreshold + foamFalloff, waveHeight);
    
    // Add foam based on wave steepness
    let normalSteepness = 1.0 - surfaceNormal.y;
    let steepnessFoam = smoothstep(0.2, 0.5, normalSteepness);
    foamIntensity = max(foamIntensity, steepnessFoam * 0.7);
    
    let foamColor = vec3<f32>(0.85, 0.9, 0.95); // Slightly blue-tinted foam
    
    // Improved lighting calculation
    let ndotl = max(dot(surfaceNormal, lightDir), 0.15); // Darker ambient
    let halfVector = normalize(lightDir + viewDir);
    let specular = pow(max(dot(surfaceNormal, halfVector), 0.0), 32.0) * 0.3;
    
    // Enhanced Beer-Lambert absorption
    let absorptionCoeff = vec3<f32>(0.6, 0.05, 0.02); // More realistic absorption
    let absorption = exp(-absorptionCoeff * normalizedDistance * 8.0);
    
    // Subsurface scattering - more subtle
    let backscatter = max(0.0, -dot(viewDir, lightDir)) * (1.0 - distanceFactor1) * 0.15;
    let scatterColor = vec3<f32>(0.1, 0.3, 0.5);
    
    // Final color composition with improved blending
    var finalColor = waterColor * absorption * ndotl;
    finalColor += skyReflection;
    finalColor += sunColor * sunReflection * 1.5;
    finalColor += sunColor * specular;
    finalColor += vec3<f32>(0.4, 0.6, 0.8) * caustics;
    finalColor += scatterColor * backscatter;
    finalColor = mix(finalColor, foamColor, foamIntensity * 0.8);
    
    // Improved transparency calculation
    let baseAlpha = 0.85;
    let fresnelAlpha = mix(0.7, 0.95, fresnel);
    let depthAlpha = 1.0 - exp(-normalizedDistance * 0.5);
    var alpha = mix(baseAlpha, fresnelAlpha, 0.6);
    alpha = mix(alpha, 0.98, depthAlpha);
    alpha = max(alpha, 0.7); // Minimum transparency
    
    // Color grading for more realistic look
    finalColor = pow(finalColor, vec3<f32>(1.1)); // Slight gamma adjustment
    finalColor *= 0.9; // Reduce overall brightness
    
    return vec4<f32>(finalColor, alpha);
}