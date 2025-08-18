// Deferred lighting pass shader for PBR shading
// Reads from G-buffer and calculates final lighting

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct LightingUniforms {
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    sunColor: vec3<f32>,
    ambientColor: f32,
    atmosphereColor: vec3<f32>,
    time: f32,
    exposureCompensation: f32,
    gamma: f32,
    fogDensity: f32,
    fogColor: f32,
}

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    viewProjectionMatrix: mat4x4<f32>,
    cameraPosition: vec3<f32>,
    padding1: f32,
    cameraDirection: vec3<f32>,
    padding2: f32,
    nearFar: vec2<f32>,
    viewport: vec2<f32>,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> lighting: LightingUniforms;

// G-buffer textures
@group(1) @binding(0) var gBufferAlbedo: texture_2d<f32>;
@group(1) @binding(1) var gBufferNormal: texture_2d<f32>;
@group(1) @binding(2) var gBufferMotion: texture_2d<f32>;
@group(1) @binding(3) var gBufferMaterial: texture_2d<f32>;
@group(1) @binding(4) var depthTexture: texture_depth_2d;
@group(1) @binding(5) var gBufferSampler: sampler;

// Environment textures
@group(2) @binding(0) var skyboxTexture: texture_cube<f32>;
@group(2) @binding(1) var skyboxSampler: sampler;

// Shadow maps (if implemented)
@group(3) @binding(0) var shadowMap: texture_depth_2d;
@group(3) @binding(1) var shadowSampler: sampler_comparison;

// Fullscreen quad vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate fullscreen quad without vertex buffer
    let x = f32((vertexIndex << 1u) & 2u) - 1.0;
    let y = f32(vertexIndex & 2u) - 1.0;
    
    output.position = vec4<f32>(x, -y, 0.0, 1.0); // Flip Y for correct UV orientation
    output.uv = vec2<f32>(x * 0.5 + 0.5, y * 0.5 + 0.5);
    
    return output;
}

// Utility functions for PBR calculations

fn unpackNormal(packedNormal: vec2<f32>) -> vec3<f32> {
    // Decode octahedral normal encoding
    let nxny = packedNormal * 2.0 - 1.0;
    let nz = 1.0 - abs(nxny.x) - abs(nxny.y);
    let nxy = select(nxny, (1.0 - abs(nxny.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), nxny >= vec2<f32>(0.0)), nz >= 0.0);
    return normalize(vec3<f32>(nxy, nz));
}

fn reconstructWorldPosition(screenUV: vec2<f32>, depth: f32) -> vec3<f32> {
    let clipSpacePos = vec4<f32>(screenUV * 2.0 - 1.0, depth, 1.0);
    let viewSpacePos = camera.projectionMatrix * clipSpacePos; // Should be inverse projection
    let worldSpacePos = camera.viewMatrix * (viewSpacePos / viewSpacePos.w); // Should be inverse view
    return worldSpacePos.xyz;
}

// PBR calculation functions
fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom);
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

fn geometrySmith(NdotL: f32, NdotV: f32, roughness: f32) -> f32 {
    return geometrySchlickGGX(NdotL, roughness) * geometrySchlickGGX(NdotV, roughness);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn calculatePBR(
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
    normal: vec3<f32>,
    viewDir: vec3<f32>,
    lightDir: vec3<f32>,
    lightColor: vec3<f32>,
    lightIntensity: f32
) -> vec3<f32> {
    let halfwayDir = normalize(viewDir + lightDir);
    
    // Calculate angles
    let NdotL = max(dot(normal, lightDir), 0.0);
    let NdotV = max(dot(normal, viewDir), 0.0);
    let NdotH = max(dot(normal, halfwayDir), 0.0);
    
    // Calculate F0 (surface reflection at zero incidence)
    let F0 = mix(vec3<f32>(0.04), albedo, metallic);
    
    // Cook-Torrance BRDF
    let D = distributionGGX(NdotH, roughness);
    let G = geometrySmith(NdotL, NdotV, roughness);
    let F = fresnelSchlick(max(dot(halfwayDir, viewDir), 0.0), F0);
    
    // Calculate specular component
    let numerator = D * G * F;
    let denominator = 4.0 * NdotV * NdotL + 0.0001; // Add small value to prevent division by zero
    let specular = numerator / denominator;
    
    // Calculate diffuse component (energy conservation)
    let kS = F;
    let kD = (vec3<f32>(1.0) - kS) * (1.0 - metallic);
    
    // Lambert diffuse
    let diffuse = kD * albedo / 3.14159265;
    
    return (diffuse + specular) * lightColor * lightIntensity * NdotL;
}

fn calculateAtmosphericScattering(viewDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
    // Simplified atmospheric scattering based on Rayleigh scattering
    let cosTheta = dot(viewDir, -sunDir);
    let rayleighPhase = (3.0 / (16.0 * 3.14159265)) * (1.0 + cosTheta * cosTheta);
    
    // Simple atmospheric color based on sun angle
    let sunElevation = sunDir.y;
    let atmosphereColor = mix(
        vec3<f32>(1.0, 0.6, 0.3), // Sunset/sunrise color
        vec3<f32>(0.5, 0.8, 1.0), // Midday sky color
        clamp(sunElevation * 4.0, 0.0, 1.0)
    );
    
    return atmosphereColor * rayleighPhase * 0.1;
}

fn calculateFog(distance: f32, viewDir: vec3<f32>) -> f32 {
    // Exponential fog falloff
    return 1.0 - exp(-distance * lighting.fogDensity);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample G-buffer
    let albedoMetallic = textureSample(gBufferAlbedo, gBufferSampler, input.uv);
    let normalRoughness = textureSample(gBufferNormal, gBufferSampler, input.uv);
    let motionDerivatives = textureSample(gBufferMotion, gBufferSampler, input.uv);
    let materialData = textureSample(gBufferMaterial, gBufferSampler, input.uv);
    let depth = textureSample(depthTexture, gBufferSampler, input.uv);
    
    // Unpack G-buffer data
    let albedo = albedoMetallic.rgb;
    let metallic = albedoMetallic.a;
    let normal = unpackNormal(normalRoughness.xy);
    let roughness = normalRoughness.z;
    let occlusion = materialData.r;
    let emissive = materialData.g;
    
    // Reconstruct world position
    let worldPos = reconstructWorldPosition(input.uv, depth);
    let viewDir = normalize(camera.cameraPosition - worldPos);
    let distanceToCamera = length(camera.cameraPosition - worldPos);
    
    // Always sample skybox for both sky and ambient lighting (avoids uniform control flow issues)
    let skyboxDirection = viewDir;
    let skyColor = textureSample(skyboxTexture, skyboxSampler, skyboxDirection).rgb;
    let atmosphereColor = calculateAtmosphericScattering(viewDir, lighting.sunDirection);
    let skyResult = skyColor + atmosphereColor;
    
    // Check if this is a skybox pixel (depth >= 1.0)
    let isSkybox = depth >= 1.0;
    
    // Calculate lighting for geometry
    var finalColor = vec3<f32>(0.0);
    
    // Sun lighting (directional light)
    if (lighting.sunIntensity > 0.0) {
        let sunContribution = calculatePBR(
            albedo,
            metallic,
            roughness,
            normal,
            viewDir,
            -lighting.sunDirection,
            lighting.sunColor,
            lighting.sunIntensity
        );
        finalColor = finalColor + sunContribution;
    }
    
    // Ambient lighting (simplified IBL)
    let F0 = mix(vec3<f32>(0.04), albedo, metallic);
    let kS = fresnelSchlick(max(dot(normal, viewDir), 0.0), F0);
    let kD = (1.0 - kS) * (1.0 - metallic);
    
    let ambientDiffuse = kD * albedo * lighting.ambientColor;
    let ambientSpecular = textureSample(skyboxTexture, skyboxSampler, reflect(-viewDir, normal)).rgb * (1.0 - roughness);
    let ambient = (ambientDiffuse + ambientSpecular * kS) * occlusion;
    
    finalColor = finalColor + ambient;
    
    // Add emissive
    finalColor = finalColor + albedo * emissive;
    
    // Apply atmospheric perspective (fog)
    let fogFactor = calculateFog(distanceToCamera, viewDir);
    let foggedColor = mix(finalColor, lighting.atmosphereColor, fogFactor);
    
    // Tone mapping and gamma correction
    let exposedColor = foggedColor * exp2(lighting.exposureCompensation);
    let toneMappedColor = exposedColor / (exposedColor + 1.0); // Simple Reinhard tone mapping
    let gammaCorrectColor = pow(toneMappedColor, vec3<f32>(1.0 / lighting.gamma));
    
    // Select between skybox and lit geometry based on depth
    let finalResult = select(gammaCorrectColor, skyResult, isSkybox);
    
    return vec4<f32>(finalResult, 1.0);
}