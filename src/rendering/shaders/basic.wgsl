// Basic geometry pass shaders for deferred rendering pipeline
// These shaders fill the G-buffer with geometry information

// ========================= VERTEX SHADER =========================

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) tangent: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPosition: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) tangent: vec3<f32>,
    @location(4) bitangent: vec3<f32>,
    @location(5) viewPosition: vec3<f32>,
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

struct ModelUniforms {
    modelMatrix: mat4x4<f32>,
    normalMatrix: mat4x4<f32>,
}

struct MaterialUniforms {
    albedo: vec4<f32>,
    metallicRoughnessEmissive: vec4<f32>, // r=metallic, g=roughness, b=emissive, a=emissiveStrength
    normalScale: f32,
    occlusionStrength: f32,
    alphaCutoff: f32,
    flags: u32, // Material feature flags
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> model: ModelUniforms;
@group(2) @binding(0) var<uniform> material: MaterialUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Transform position to world space
    let worldPosition = model.modelMatrix * vec4<f32>(input.position, 1.0);
    output.worldPosition = worldPosition.xyz;
    
    // Transform to view space
    let viewPosition = camera.viewMatrix * worldPosition;
    output.viewPosition = viewPosition.xyz;
    
    // Transform to clip space
    output.position = camera.projectionMatrix * viewPosition;
    
    // Transform normal, tangent to world space
    output.normal = normalize((model.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
    output.tangent = normalize((model.normalMatrix * vec4<f32>(input.tangent, 0.0)).xyz);
    
    // Calculate bitangent (assuming right-handed coordinate system)
    output.bitangent = normalize(cross(output.normal, output.tangent));
    
    // Pass through UV coordinates
    output.uv = input.uv;
    
    return output;
}

// ========================= FRAGMENT SHADER =========================

struct GBufferOutput {
    @location(0) albedo: vec4<f32>,          // RGB: albedo, A: metallic
    @location(1) normal: vec4<f32>,          // RGB: world normal, A: roughness
    @location(2) motion: vec4<f32>,          // RG: motion vectors, BA: depth derivatives
    @location(3) material: vec4<f32>,        // R: occlusion, G: emissive, BA: custom
}

// Material textures
@group(2) @binding(1) var albedoTexture: texture_2d<f32>;
@group(2) @binding(2) var normalTexture: texture_2d<f32>;
@group(2) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;
@group(2) @binding(4) var occlusionTexture: texture_2d<f32>;
@group(2) @binding(5) var emissiveTexture: texture_2d<f32>;
@group(2) @binding(6) var materialSampler: sampler;

// Utility functions
fn packNormal(normal: vec3<f32>) -> vec2<f32> {
    // Octahedral normal encoding for better precision
    let p = normal * (1.0 / (abs(normal.x) + abs(normal.y) + abs(normal.z)));
    let octWrap = (1.0 - abs(p.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), p.xy >= 0.0);
    return select(octWrap, p.xy, normal.z >= 0.0);
}

fn sampleNormalMap(uv: vec2<f32>, normalScale: f32, TBN: mat3x3<f32>) -> vec3<f32> {
    let normalSample = textureSample(normalTexture, materialSampler, uv).rgb * 2.0 - 1.0;
    let scaledNormal = vec3<f32>(normalSample.xy * normalScale, normalSample.z);
    return normalize(TBN * scaledNormal);
}

@fragment 
fn fs_main(input: VertexOutput) -> GBufferOutput {
    var output: GBufferOutput;
    
    // Sample material textures
    let albedoSample = textureSample(albedoTexture, materialSampler, input.uv);
    let metallicRoughnessSample = textureSample(metallicRoughnessTexture, materialSampler, input.uv);
    let occlusionSample = textureSample(occlusionTexture, materialSampler, input.uv).r;
    let emissiveSample = textureSample(emissiveTexture, materialSampler, input.uv).rgb;
    
    // Apply material properties
    let baseColor = material.albedo * albedoSample;
    let metallic = material.metallicRoughnessEmissive.r * metallicRoughnessSample.b;
    let roughness = material.metallicRoughnessEmissive.g * metallicRoughnessSample.g;
    let emissive = material.metallicRoughnessEmissive.b * emissiveSample * material.metallicRoughnessEmissive.a;
    let occlusion = mix(1.0, occlusionSample, material.occlusionStrength);
    
    // Alpha testing
    if (baseColor.a < material.alphaCutoff) {
        discard;
    }
    
    // Calculate TBN matrix for normal mapping
    let T = normalize(input.tangent);
    let B = normalize(input.bitangent);
    let N = normalize(input.normal);
    let TBN = mat3x3<f32>(T, B, N);
    
    // Sample normal map and transform to world space
    let worldNormal = sampleNormalMap(input.uv, material.normalScale, TBN);
    
    // Calculate motion vectors (simplified - would need previous frame matrices for full implementation)
    let currentClip = camera.viewProjectionMatrix * vec4<f32>(input.worldPosition, 1.0);
    let currentScreen = currentClip.xy / currentClip.w;
    // For now, just output zero motion vectors
    let motionVector = vec2<f32>(0.0);
    
    // Calculate depth derivatives for various effects
    let depthDdx = dpdx(input.viewPosition.z);
    let depthDdy = dpdy(input.viewPosition.z);
    
    // Pack G-buffer data
    output.albedo = vec4<f32>(baseColor.rgb, metallic);
    output.normal = vec4<f32>(packNormal(worldNormal), roughness);
    output.motion = vec4<f32>(motionVector, depthDdx, depthDdy);
    output.material = vec4<f32>(occlusion, length(emissive), 0.0, 0.0);
    
    return output;
}