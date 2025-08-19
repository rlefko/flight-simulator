// Advanced grass rendering shader with detailed blade geometry and wind animation
// Supports multiple LOD levels: individual blades, grass patches, and terrain overlays

struct Uniforms {
    view_projection_matrix: mat4x4<f32>,
    wind_direction: vec3<f32>,
    wind_strength: f32,
    wind_frequency: f32,
    wind_gust_strength: f32,
    wind_time: f32,
    padding1: f32,
    lod_blade_distance: f32,
    lod_patch_distance: f32,
    lod_overlay_distance: f32,
    padding2: f32,
    padding3: f32,
    padding4: f32,
    padding5: f32,
    padding6: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var grass_texture: texture_2d<f32>;
@group(0) @binding(2) var grass_sampler: sampler;

// =============================================================================
// INDIVIDUAL GRASS BLADE RENDERING (LOD 0)
// =============================================================================

struct BladeVertexInput {
    @location(0) position: vec3<f32>,        // Local blade vertex position
    @location(1) normal: vec3<f32>,          // Vertex normal
    @location(2) uv: vec2<f32>,             // Texture coordinates
    @location(3) segment: f32,               // Segment index for wind bending
    @location(4) instance_position: vec3<f32>, // World position of blade
    @location(5) instance_scale: vec2<f32>,    // Width and height scale
    @location(6) instance_rotation: f32,       // Rotation around Y axis
    @location(7) wind_phase: f32,             // Random wind phase offset
    @location(8) grass_type: f32,             // Grass type for texture atlas
}

struct BladeVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) grass_type: f32,
    @location(4) wind_factor: f32,
    @location(5) segment_height: f32,
}

@vertex
fn vs_blade(input: BladeVertexInput) -> BladeVertexOutput {
    var output: BladeVertexOutput;
    
    // Scale the blade geometry
    var local_position = input.position;
    local_position.x *= input.instance_scale.x;  // Width scale
    local_position.y *= input.instance_scale.y;  // Height scale
    
    // Calculate wind effect based on segment height
    let segment_factor = input.segment / 4.0;  // 0 at base, 1 at tip
    let height_factor = segment_factor * segment_factor; // Quadratic falloff
    
    // Multi-frequency wind simulation
    let wind_time = uniforms.wind_time + input.wind_phase;
    let primary_wind = sin(wind_time * uniforms.wind_frequency) * uniforms.wind_strength;
    let secondary_wind = sin(wind_time * uniforms.wind_frequency * 2.7 + 1.3) * uniforms.wind_strength * 0.4;
    let gust_wind = sin(wind_time * uniforms.wind_frequency * 0.3 + 2.1) * uniforms.wind_gust_strength;
    let micro_wind = sin(wind_time * uniforms.wind_frequency * 8.1 + input.wind_phase * 3.0) * uniforms.wind_strength * 0.1;
    
    let total_wind = (primary_wind + secondary_wind + gust_wind + micro_wind) * height_factor;
    
    // Apply wind displacement with realistic blade bending
    local_position.x += uniforms.wind_direction.x * total_wind * (1.0 + segment_factor * 0.5);
    local_position.z += uniforms.wind_direction.z * total_wind * (1.0 + segment_factor * 0.5);
    
    // Add slight backward bend from wind resistance
    local_position.y -= abs(total_wind) * height_factor * 0.1;
    
    // Create rotation matrix for blade orientation
    let cos_rot = cos(input.instance_rotation);
    let sin_rot = sin(input.instance_rotation);
    let rotation_matrix = mat3x3<f32>(
        vec3<f32>(cos_rot, 0.0, -sin_rot),
        vec3<f32>(0.0, 1.0, 0.0),
        vec3<f32>(sin_rot, 0.0, cos_rot)
    );
    
    // Apply rotation to local position and normal
    let rotated_position = rotation_matrix * local_position;
    let rotated_normal = rotation_matrix * input.normal;
    
    // Transform to world space
    let world_position = input.instance_position + rotated_position;
    
    // Calculate wind-affected normal for lighting
    var world_normal = normalize(rotated_normal);
    
    // Adjust normal based on wind bending
    if (segment_factor > 0.1) {
        let wind_normal_offset = normalize(uniforms.wind_direction) * total_wind * 0.3;
        world_normal = normalize(world_normal + vec3<f32>(wind_normal_offset.x, 0.0, wind_normal_offset.z));
    }
    
    output.clip_position = uniforms.view_projection_matrix * vec4<f32>(world_position, 1.0);
    output.world_position = world_position;
    output.normal = world_normal;
    output.uv = input.uv;
    output.grass_type = input.grass_type;
    output.wind_factor = abs(total_wind);
    output.segment_height = segment_factor;
    
    return output;
}

@fragment
fn fs_blade(input: BladeVertexOutput) -> @location(0) vec4<f32> {
    // Calculate UV coordinates in texture atlas
    let grass_type_int = i32(input.grass_type);
    let atlas_size = 4.0; // 4x4 grid of grass types
    let type_u = f32(grass_type_int % 4) / atlas_size;
    let type_v = f32(grass_type_int / 4) / atlas_size;
    
    let atlas_uv = vec2<f32>(
        type_u + input.uv.x / atlas_size,
        type_v + input.uv.y / atlas_size
    );
    
    // Sample base grass texture
    var grass_color = textureSample(grass_texture, grass_sampler, atlas_uv);
    
    // Apply grass type specific coloring
    grass_color = apply_grass_type_coloring(grass_color, input.grass_type);
    
    // Add wind-based color variation
    if (input.wind_factor > 0.01) {
        let wind_intensity = min(input.wind_factor * 2.0, 1.0);
        let wind_highlight = vec3<f32>(0.15, 0.1, -0.05) * wind_intensity;
        grass_color = vec4<f32>(grass_color.rgb + wind_highlight, grass_color.a);
    }
    
    // Add segment-based shading (darker at base, lighter at tip)
    let segment_shading = 0.7 + input.segment_height * 0.3;
    grass_color = vec4<f32>(grass_color.rgb * segment_shading, grass_color.a);
    
    // Simple lighting calculation
    let light_dir = normalize(vec3<f32>(0.6, 1.0, 0.4));
    let normal = normalize(input.normal);
    let n_dot_l = max(dot(normal, light_dir), 0.0);
    
    // Enhanced lighting with subsurface scattering approximation
    let backlight = max(dot(-normal, light_dir), 0.0) * 0.3;
    let subsurface = pow(backlight, 2.0) * 0.5;
    
    let ambient = 0.4;
    let diffuse = n_dot_l * 0.6;
    let lighting = ambient + diffuse + subsurface;
    
    // Apply lighting
    grass_color = vec4<f32>(grass_color.rgb * lighting, grass_color.a);
    
    // Alpha test for blade edges
    if (grass_color.a < 0.15) {
        discard;
    }
    
    // Add slight transparency for overlapping blades
    grass_color.a = min(grass_color.a * 1.2, 0.95);
    
    return grass_color;
}

// =============================================================================
// GRASS PATCH RENDERING (LOD 1)
// =============================================================================

struct PatchVertexInput {
    @location(0) instance_position: vec3<f32>,
    @location(1) patch_size: f32,
    @location(2) density: f32,
    @location(3) grass_type: f32,
    @builtin(vertex_index) vertex_index: u32,
}

struct PatchVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) grass_type: f32,
    @location(3) density: f32,
    @location(4) patch_size: f32,
}

@vertex
fn vs_patch(input: PatchVertexInput) -> PatchVertexOutput {
    var output: PatchVertexOutput;
    
    // Generate billboard quad vertices
    let quad_positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), // Bottom-left
        vec2<f32>( 1.0, -1.0), // Bottom-right  
        vec2<f32>(-1.0,  1.0), // Top-left
        vec2<f32>( 1.0, -1.0), // Bottom-right
        vec2<f32>( 1.0,  1.0), // Top-right
        vec2<f32>(-1.0,  1.0)  // Top-left
    );
    
    let quad_uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 0.0)
    );
    
    let vertex_id = input.vertex_index % 6u;
    let quad_pos = quad_positions[vertex_id];
    let uv = quad_uvs[vertex_id];
    
    // Scale the quad by patch size
    let scaled_pos = quad_pos * input.patch_size * 0.5;
    
    // Position the billboard in world space
    let world_position = input.instance_position + vec3<f32>(scaled_pos.x, 0.0, scaled_pos.y);
    
    output.clip_position = uniforms.view_projection_matrix * vec4<f32>(world_position, 1.0);
    output.world_position = world_position;
    output.uv = uv;
    output.grass_type = input.grass_type;
    output.density = input.density;
    output.patch_size = input.patch_size;
    
    return output;
}

@fragment
fn fs_patch(input: PatchVertexOutput) -> @location(0) vec4<f32> {
    // Create procedural grass patch texture
    let uv = input.uv;
    
    // Generate multiple scales of noise for grass blade patterns
    let noise1 = noise2d(uv * 20.0 + vec2<f32>(uniforms.wind_time * 0.1));
    let noise2 = noise2d(uv * 50.0 + vec2<f32>(uniforms.wind_time * 0.05));
    let noise3 = noise2d(uv * 100.0);
    
    // Combine noise for grass blade density pattern
    let grass_density = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2) * 0.5 + 0.5;
    let density_factor = input.density / 100.0; // Normalize density
    
    // Apply density-based cutoff
    if (grass_density < (1.0 - density_factor * 0.8)) {
        discard;
    }
    
    // Get base grass color from texture atlas
    let grass_type_int = i32(input.grass_type);
    let atlas_size = 4.0;
    let type_u = f32(grass_type_int % 4) / atlas_size;
    let type_v = f32(grass_type_int / 4) / atlas_size;
    
    let atlas_uv = vec2<f32>(
        type_u + uv.x / atlas_size,
        type_v + uv.y / atlas_size
    );
    
    var grass_color = textureSample(grass_texture, grass_sampler, atlas_uv);
    
    // Apply grass type coloring
    grass_color = apply_grass_type_coloring(grass_color, input.grass_type);
    
    // Add variation based on noise
    let color_variation = (noise1 - 0.5) * 0.15;
    grass_color = vec4<f32>(grass_color.rgb + vec3<f32>(color_variation * 0.5, color_variation, color_variation * 0.3), grass_color.a);
    
    // Add wind effect to patch
    let wind_phase = dot(input.world_position.xz, vec2<f32>(0.1, 0.07));
    let wind_effect = sin(uniforms.wind_time * uniforms.wind_frequency + wind_phase) * uniforms.wind_strength * 0.2;
    let wind_color_shift = vec3<f32>(0.1, -0.05, 0.0) * wind_effect;
    grass_color = vec4<f32>(grass_color.rgb + wind_color_shift, grass_color.a);
    
    // Simple lighting
    let lighting = 0.6 + 0.4 * clamp(uv.y, 0.0, 1.0); // Lighter at top
    grass_color = vec4<f32>(grass_color.rgb * lighting, grass_color.a);
    
    // Fade out edges of patches for blending
    var edge_fade = min(
        min(uv.x, 1.0 - uv.x),
        min(uv.y, 1.0 - uv.y)
    ) * 4.0;
    edge_fade = clamp(edge_fade, 0.0, 1.0);
    
    grass_color.a *= edge_fade;
    
    return grass_color;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

fn apply_grass_type_coloring(base_color: vec4<f32>, grass_type: f32) -> vec4<f32> {
    let type_id = i32(grass_type);
    var color = base_color;
    
    if (type_id == 0) {
        // Temperate grass - vibrant green
        color = vec4<f32>(
            base_color.r * 0.6,
            base_color.g * 1.2,
            base_color.b * 0.4,
            base_color.a
        );
    } else if (type_id == 1) {
        // Dry grass - yellow-brown
        color = vec4<f32>(
            base_color.r * 1.1,
            base_color.g * 0.9,
            base_color.b * 0.3,
            base_color.a
        );
    } else if (type_id == 2) {
        // Lush grass - deep green
        color = vec4<f32>(
            base_color.r * 0.4,
            base_color.g * 1.4,
            base_color.b * 0.6,
            base_color.a
        );
    } else if (type_id == 3) {
        // Alpine grass - muted green
        color = vec4<f32>(
            base_color.r * 0.8,
            base_color.g * 1.0,
            base_color.b * 0.7,
            base_color.a
        );
    }
    
    return color;
}

// Simple 2D noise function for procedural patterns
fn noise2d(pos: vec2<f32>) -> f32 {
    let p = floor(pos);
    let f = vec2<f32>(fract(pos.x), fract(pos.y));
    
    // Smooth interpolation
    let u = f * f * (3.0 - 2.0 * f);
    
    // Hash function for pseudo-random values
    let a = hash22(p + vec2<f32>(0.0, 0.0));
    let b = hash22(p + vec2<f32>(1.0, 0.0));
    let c = hash22(p + vec2<f32>(0.0, 1.0));
    let d = hash22(p + vec2<f32>(1.0, 1.0));
    
    return mix(
        mix(a, b, u.x),
        mix(c, d, u.x),
        u.y
    );
}

// Hash function for noise generation
fn hash22(p: vec2<f32>) -> f32 {
    let p3 = vec3<f32>(fract(p.x * 0.1031), fract(p.y * 0.1031), fract(p.x * 0.1031));
    let p3_dot = dot(p3, vec3<f32>(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3_dot);
}

// Fractional part function
fn fract(x: f32) -> f32 {
    return x - floor(x);
}

fn fract2(v: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(fract(v.x), fract(v.y));
}

fn fract3(v: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(fract(v.x), fract(v.y), fract(v.z));
}

// Turbulence function for wind variation
fn turbulence2d(pos: vec2<f32>, octaves: i32) -> f32 {
    var result = 0.0;
    var amplitude = 1.0;
    var frequency = 1.0;
    
    for (var i = 0; i < octaves; i = i + 1) {
        result += noise2d(pos * frequency) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    
    return result;
}