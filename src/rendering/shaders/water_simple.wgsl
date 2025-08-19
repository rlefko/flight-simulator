// Simplified water shader for stable rendering
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

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Simple transformation - no wave displacement
    output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
    output.worldPos = input.position;
    output.normal = vec3<f32>(0.0, 1.0, 0.0); // Always point up for water
    output.uv = input.uv;
    
    // Calculate depth for shading
    let viewPos = uniforms.viewMatrix * vec4<f32>(input.position, 1.0);
    output.depth = -viewPos.z;
    
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Simple water colors
    let shallowColor = vec3<f32>(0.2, 0.6, 0.8); // Light blue
    let deepColor = vec3<f32>(0.05, 0.2, 0.4);   // Dark blue
    
    // Depth-based color mixing
    let depthFactor = clamp(input.depth * 0.01, 0.0, 1.0);
    let waterColor = mix(shallowColor, deepColor, depthFactor);
    
    // Simple lighting
    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let ndotl = max(dot(input.normal, lightDir), 0.3);
    
    // Add slight transparency
    let alpha = 0.85;
    
    return vec4<f32>(waterColor * ndotl, alpha);
}