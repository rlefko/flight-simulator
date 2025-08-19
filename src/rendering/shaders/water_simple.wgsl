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
    
    // Realistic ocean water colors based on depth
    let coastalColor = vec3<f32>(0.4, 0.7, 0.8);   // Light turquoise for shallow water
    let shallowColor = vec3<f32>(0.2, 0.5, 0.7);   // Medium blue for shallow ocean
    let midColor = vec3<f32>(0.1, 0.3, 0.5);       // Deeper blue for mid ocean  
    let deepColor = vec3<f32>(0.05, 0.15, 0.3);    // Dark blue for deep ocean
    
    // Calculate depth-based color
    let cameraDistance = length(uniforms.cameraPosition - input.worldPos);
    let normalizedDistance = clamp(cameraDistance * 0.001, 0.0, 3.0);
    
    let depthFactor1 = clamp(normalizedDistance, 0.0, 1.0);
    let depthFactor2 = clamp(normalizedDistance - 1.0, 0.0, 1.0); 
    let depthFactor3 = clamp(normalizedDistance - 2.0, 0.0, 1.0);
    
    var waterColor = mix(coastalColor, shallowColor, depthFactor1);
    waterColor = mix(waterColor, midColor, depthFactor2);
    waterColor = mix(waterColor, deepColor, depthFactor3);
    
    // Enhanced lighting and reflections
    let lightDir = normalize(vec3<f32>(0.4, 0.8, 0.3));
    let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
    
    // Add small-scale normal perturbation for surface detail
    let detailNormal = vec3<f32>(
        sin(input.worldPos.x * 0.2 + waveTime * 2.0) * 0.08 + sin(input.worldPos.x * 0.5 + waveTime * 3.5) * 0.04,
        1.0,
        cos(input.worldPos.z * 0.18 + waveTime * 1.8) * 0.08 + cos(input.worldPos.z * 0.45 + waveTime * 2.8) * 0.04
    );
    let surfaceNormal = normalize(mix(input.normal, detailNormal, 0.3));
    
    // Fresnel reflection calculation
    let F0 = 0.02;
    let cosTheta = max(dot(viewDir, surfaceNormal), 0.0);
    let fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
    
    // Sky reflection (realistic sky color)
    let skyZenith = vec3<f32>(0.3, 0.6, 1.0);
    let skyHorizon = vec3<f32>(0.8, 0.9, 1.0);
    let upDot = max(dot(reflect(-viewDir, surfaceNormal), vec3<f32>(0.0, 1.0, 0.0)), 0.0);
    let skyColor = mix(skyHorizon, skyZenith, upDot);
    let skyReflection = skyColor * fresnel * 0.8;
    
    // Sun reflection
    let sunDir = lightDir;
    let reflectDir = reflect(-lightDir, surfaceNormal);
    let specularPower = mix(32.0, 128.0, fresnel);
    let sunReflection = pow(max(dot(viewDir, reflectDir), 0.0), specularPower) * fresnel;
    let sunColor = vec3<f32>(1.0, 0.95, 0.8);
    
    // Caustics for shallow water
    let causticsStrength = 1.0 - smoothstep(0.0, 1.5, normalizedDistance);
    let causticTime = waveTime * 0.8;
    let causticUV = input.worldPos.xz * 0.03;
    let causticPattern1 = sin(causticUV.x * 8.0 + causticTime) * cos(causticUV.y * 6.0 + causticTime * 1.3);
    let causticPattern2 = sin(causticUV.x * 12.0 - causticTime * 1.5) * cos(causticUV.y * 9.0 + causticTime * 0.8);
    let caustics = causticsStrength * max(0.0, causticPattern1 * causticPattern2) * 0.15;
    
    // Foam from wave crests
    let waveHeight = input.worldPos.y;
    let foamThreshold = 0.8;
    let foamIntensity = smoothstep(foamThreshold, foamThreshold + 0.5, waveHeight);
    let foamColor = vec3<f32>(0.9, 0.95, 1.0);
    
    // Basic lighting
    let ndotl = max(dot(surfaceNormal, lightDir), 0.2);
    
    // Volumetric absorption (Beer-Lambert law)
    let absorptionCoeff = vec3<f32>(0.45, 0.03, 0.01); // Red absorbed more than blue
    let absorption = exp(-absorptionCoeff * normalizedDistance * 10.0);
    
    // Final color composition
    var finalColor = waterColor * absorption * ndotl;
    finalColor += skyReflection;
    finalColor += sunColor * sunReflection * 2.0;
    finalColor += vec3<f32>(0.7, 0.9, 1.0) * caustics;
    finalColor = mix(finalColor, foamColor, foamIntensity * 0.6);
    
    // Add subsurface scattering
    let backscatter = max(0.0, -dot(viewDir, lightDir)) * (1.0 - depthFactor1) * 0.3;
    finalColor += vec3<f32>(0.2, 0.5, 0.8) * backscatter;
    
    // Depth-based transparency
    let alpha = mix(0.8, 0.95, clamp(fresnel + normalizedDistance * 0.3, 0.0, 1.0));
    alpha = max(alpha, 0.75); // Ensure water is never too transparent
    
    return vec4<f32>(finalColor, alpha);
}