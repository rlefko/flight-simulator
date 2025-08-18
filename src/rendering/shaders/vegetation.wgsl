// Vegetation rendering shader with instancing, wind animation, and LOD support

struct CameraUniforms {
    view_projection_matrix: mat4x4<f32>,
}

struct WindUniforms {
    direction: vec3<f32>,
    strength: f32,
    frequency: f32,
    time: f32,
    padding: vec2<f32>,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

struct InstanceInput {
    @location(3) model_matrix_0: vec4<f32>,
    @location(4) model_matrix_1: vec4<f32>,
    @location(5) model_matrix_2: vec4<f32>,
    @location(6) model_matrix_3: vec4<f32>,
    @location(7) instance_data: vec4<f32>, // lod_level, species_id, wind_phase, padding
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) instance_data: vec4<f32>,
    @location(4) wind_factor: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> wind: WindUniforms;
@group(0) @binding(2) var texture_atlas: texture_2d<f32>;
@group(0) @binding(3) var texture_sampler: sampler;

// Vertex shader
@vertex
fn vs_main(vertex: VertexInput, instance: InstanceInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Reconstruct model matrix from instance data
    let model_matrix = mat4x4<f32>(
        instance.model_matrix_0,
        instance.model_matrix_1,
        instance.model_matrix_2,
        instance.model_matrix_3
    );
    
    // Extract instance data
    let lod_level = instance.instance_data.x;
    let species_id = instance.instance_data.y;
    let wind_phase = instance.instance_data.z;
    
    // Apply wind animation
    var position = vertex.position;
    var wind_factor = 0.0;
    
    // Apply wind effect based on vertex height (more wind at top)
    if (vertex.position.y > 0.1) {
        let height_factor = vertex.position.y;
        let wind_time = wind.time + wind_phase;
        
        // Create wind movement with multiple frequency components
        let wind_primary = sin(wind_time * wind.frequency) * wind.strength;
        let wind_secondary = sin(wind_time * wind.frequency * 2.3 + 1.5) * wind.strength * 0.3;
        let wind_tertiary = sin(wind_time * wind.frequency * 4.1 + 2.8) * wind.strength * 0.1;
        
        let total_wind = wind_primary + wind_secondary + wind_tertiary;
        
        // Apply wind displacement
        position.x += wind.direction.x * total_wind * height_factor;
        position.z += wind.direction.z * total_wind * height_factor;
        
        // Store wind factor for fragment shader effects
        wind_factor = abs(total_wind) * height_factor;
    }
    
    // Transform position to world space
    let world_position = model_matrix * vec4<f32>(position, 1.0);
    
    // Transform normal to world space
    let world_normal = normalize((model_matrix * vec4<f32>(vertex.normal, 0.0)).xyz);
    
    // Apply view-projection transform
    out.clip_position = camera.view_projection_matrix * world_position;
    out.world_position = world_position.xyz;
    out.normal = world_normal;
    out.uv = vertex.uv;
    out.instance_data = instance.instance_data;
    out.wind_factor = wind_factor;
    
    return out;
}

// Fragment shader
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let lod_level = in.instance_data.x;
    let species_id = in.instance_data.y;
    
    // Calculate UV coordinates in texture atlas based on species
    var atlas_uv = in.uv;
    
    // Simple atlas mapping - divide texture into species regions
    let species_rows = 4.0;
    let species_cols = 4.0;
    let species_u = (species_id % species_cols) / species_cols;
    let species_v = floor(species_id / species_cols) / species_rows;
    
    atlas_uv.x = species_u + atlas_uv.x / species_cols;
    atlas_uv.y = species_v + atlas_uv.y / species_rows;
    
    // Sample base texture
    var base_color = textureSample(texture_atlas, texture_sampler, atlas_uv);
    
    // Apply species-specific coloring
    base_color = apply_species_coloring(base_color, species_id);
    
    // Apply wind-based color variation
    if (in.wind_factor > 0.01) {
        let wind_intensity = min(in.wind_factor, 1.0);
        let wind_color_shift = vec3<f32>(0.1, -0.05, 0.05) * wind_intensity;
        base_color = vec4<f32>(base_color.rgb + wind_color_shift, base_color.a);
    }
    
    // Simple lighting calculation
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.3));
    let normal = normalize(in.normal);
    let ndotl = max(dot(normal, light_dir), 0.0);
    
    // Ambient + diffuse lighting
    let ambient = 0.3;
    let diffuse = ndotl * 0.7;
    let lighting = ambient + diffuse;
    
    // Apply lighting
    var final_color = base_color * lighting;
    
    // LOD-based modifications
    if (lod_level >= 2.0) {
        // Billboard LOD - reduce detail
        final_color = mix(final_color, vec4<f32>(0.4, 0.6, 0.2, final_color.a), 0.3);
    }
    
    // Alpha testing for vegetation
    if (final_color.a < 0.1) {
        discard;
    }
    
    return final_color;
}

// Apply species-specific coloring
fn apply_species_coloring(base_color: vec4<f32>, species_id: f32) -> vec4<f32> {
    var color = base_color;
    
    if (species_id < 0.5) {
        // Oak - rich green
        color = vec4<f32>(
            base_color.r * 0.8,
            base_color.g * 1.1,
            base_color.b * 0.6,
            base_color.a
        );
    } else if (species_id < 1.5) {
        // Pine - darker green
        color = vec4<f32>(
            base_color.r * 0.6,
            base_color.g * 0.9,
            base_color.b * 0.5,
            base_color.a
        );
    } else if (species_id < 2.5) {
        // Palm - tropical green
        color = vec4<f32>(
            base_color.r * 0.7,
            base_color.g * 1.2,
            base_color.b * 0.4,
            base_color.a
        );
    } else if (species_id < 3.5) {
        // Birch - lighter green
        color = vec4<f32>(
            base_color.r * 1.0,
            base_color.g * 1.1,
            base_color.b * 0.7,
            base_color.a
        );
    } else if (species_id < 4.5) {
        // Cactus - desert green
        color = vec4<f32>(
            base_color.r * 0.8,
            base_color.g * 0.9,
            base_color.b * 0.3,
            base_color.a
        );
    } else {
        // Grass types (species_id >= 10)
        if (species_id < 10.5) {
            // Temperate grass
            color = vec4<f32>(
                base_color.r * 0.6,
                base_color.g * 1.0,
                base_color.b * 0.4,
                base_color.a
            );
        } else if (species_id < 11.5) {
            // Tundra grass
            color = vec4<f32>(
                base_color.r * 0.8,
                base_color.g * 0.9,
                base_color.b * 0.6,
                base_color.a
            );
        } else if (species_id < 12.5) {
            // Beach grass
            color = vec4<f32>(
                base_color.r * 0.9,
                base_color.g * 1.0,
                base_color.b * 0.7,
                base_color.a
            );
        } else {
            // Wetland grass
            color = vec4<f32>(
                base_color.r * 0.5,
                base_color.g * 0.9,
                base_color.b * 0.5,
                base_color.a
            );
        }
    }
    
    return color;
}

// Wind noise function for variation
fn wind_noise(pos: vec3<f32>, time: f32) -> f32 {
    let p = pos * 0.1 + vec3<f32>(time * 0.1);
    return sin(p.x) * cos(p.z) * sin(p.y + time);
}

// Simplified Perlin-like noise for wind variation
fn noise3d(pos: vec3<f32>) -> f32 {
    let p = floor(pos);
    let f = fract(pos);
    
    // Smooth interpolation
    let u = f * f * (3.0 - 2.0 * f);
    
    // Hash function for pseudo-random values
    let hash = sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453;
    
    return fract(hash);
}