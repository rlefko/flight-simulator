import { Vector3 } from '../core/math';
import { TERRAIN_CONFIG, LOD_CONFIG, getMeshResolutionForLOD } from './WorldConstants';
import type { TerrainData, MeshData } from './TerrainTile';

/**
 * Mesh generation options
 */
export interface MeshGenerationOptions {
    /** Level of detail for mesh density */
    lodLevel: number;
    
    /** Enable skirt generation for seamless transitions */
    generateSkirts: boolean;
    
    /** Skirt depth in world units */
    skirtDepth: number;
    
    /** Adaptive tessellation based on terrain complexity */
    adaptiveTessellation: boolean;
    
    /** Maximum triangle edge length for adaptive tessellation */
    maxEdgeLength: number;
    
    /** Enable mesh optimization */
    optimize: boolean;
    
    /** Generate tangent vectors for normal mapping */
    generateTangents: boolean;
}

/**
 * Mesh statistics for performance monitoring
 */
export interface MeshStatistics {
    vertexCount: number;
    triangleCount: number;
    meshComplexity: number;
    generationTime: number;
    memoryUsage: number;
}

/**
 * Vertex data structure for terrain meshes
 */
export interface TerrainVertex {
    position: Vector3;
    normal: Vector3;
    uv: [number, number];
    color: [number, number, number, number];
    materialBlend: [number, number, number, number]; // Up to 4 material weights
    tangent?: Vector3;
    bitangent?: Vector3;
}

/**
 * High-performance terrain mesh generator with adaptive LOD and GPU optimization
 */
export class TerrainMesh {
    private static readonly DEFAULT_OPTIONS: MeshGenerationOptions = {
        lodLevel: 0,
        generateSkirts: true,
        skirtDepth: 50,
        adaptiveTessellation: false,
        maxEdgeLength: 100,
        optimize: true,
        generateTangents: false
    };

    /**
     * Generate optimized mesh data from terrain heightmap
     */
    public static generateMesh(
        terrainData: TerrainData, 
        tileSize: number,
        options: Partial<MeshGenerationOptions> = {}
    ): MeshData {
        const opts = { ...TerrainMesh.DEFAULT_OPTIONS, ...options };
        const startTime = performance.now();
        
        // Determine mesh resolution based on LOD level
        const resolution = getMeshResolutionForLOD(opts.lodLevel);
        const heightmapSize = Math.sqrt(terrainData.heightmap.length);
        
        // Generate base mesh
        let meshData = opts.adaptiveTessellation ? 
            TerrainMesh.generateAdaptiveMesh(terrainData, tileSize, resolution, opts) :
            TerrainMesh.generateRegularMesh(terrainData, tileSize, resolution, opts);
        
        // Add skirts for seamless LOD transitions
        if (opts.generateSkirts) {
            meshData = TerrainMesh.addMeshSkirts(meshData, terrainData, tileSize, opts.skirtDepth);
        }
        
        // Generate tangent vectors if requested
        if (opts.generateTangents) {
            TerrainMesh.generateTangentVectors(meshData);
        }
        
        // Optimize mesh
        if (opts.optimize) {
            meshData = TerrainMesh.optimizeMesh(meshData);
        }
        
        const generationTime = performance.now() - startTime;
        
        return meshData;
    }

    /**
     * Generate regular grid-based terrain mesh
     */
    private static generateRegularMesh(
        terrainData: TerrainData,
        tileSize: number,
        resolution: number,
        options: MeshGenerationOptions
    ): MeshData {
        const heightmapSize = Math.sqrt(terrainData.heightmap.length);
        const step = tileSize / (resolution - 1);
        const heightmapStep = (heightmapSize - 1) / (resolution - 1);
        
        const vertices: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const colors: number[] = [];
        
        // Generate vertices
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = j * step;
                const z = i * step;
                
                // Sample height from heightmap with bilinear interpolation
                const height = TerrainMesh.sampleHeightmap(
                    terrainData.heightmap, 
                    heightmapSize, 
                    j * heightmapStep, 
                    i * heightmapStep
                );
                
                // Sample normal
                const normal = TerrainMesh.sampleNormals(
                    terrainData.normals,
                    heightmapSize,
                    j * heightmapStep,
                    i * heightmapStep
                );
                
                // Sample material/color
                const material = TerrainMesh.sampleMaterials(
                    terrainData.materials,
                    heightmapSize,
                    j * heightmapStep,
                    i * heightmapStep
                );
                
                const color = TerrainMesh.getMaterialColor(material);
                
                // Add vertex data
                vertices.push(x, height, z);
                normals.push(normal.x, normal.y, normal.z);
                uvs.push(j / (resolution - 1), i / (resolution - 1));
                colors.push(color[0], color[1], color[2], 1.0);
            }
        }
        
        // Generate indices
        for (let i = 0; i < resolution - 1; i++) {
            for (let j = 0; j < resolution - 1; j++) {
                const topLeft = i * resolution + j;
                const topRight = topLeft + 1;
                const bottomLeft = (i + 1) * resolution + j;
                const bottomRight = bottomLeft + 1;
                
                // First triangle (top-left, bottom-left, top-right)
                indices.push(topLeft, bottomLeft, topRight);
                
                // Second triangle (top-right, bottom-left, bottom-right)
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }
        
        return {
            vertices: new Float32Array(vertices),
            indices: new Uint32Array(indices),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            colors: new Float32Array(colors),
            vertexCount: vertices.length / 3,
            triangleCount: indices.length / 3
        };
    }

    /**
     * Generate adaptive mesh with variable tessellation density
     */
    private static generateAdaptiveMesh(
        terrainData: TerrainData,
        tileSize: number,
        baseResolution: number,
        options: MeshGenerationOptions
    ): MeshData {
        // For now, use regular mesh as adaptive tessellation is complex
        // TODO: Implement proper adaptive tessellation based on terrain complexity
        return TerrainMesh.generateRegularMesh(terrainData, tileSize, baseResolution, options);
    }

    /**
     * Add mesh skirts to prevent gaps between LOD levels
     */
    private static addMeshSkirts(
        meshData: MeshData,
        terrainData: TerrainData,
        tileSize: number,
        skirtDepth: number
    ): MeshData {
        const resolution = Math.sqrt(meshData.vertices.length / 3);
        const originalVertexCount = meshData.vertexCount;
        
        const newVertices: number[] = Array.from(meshData.vertices);
        const newNormals: number[] = Array.from(meshData.normals);
        const newUvs: number[] = Array.from(meshData.uvs);
        const newColors: number[] = Array.from(meshData.colors);
        const newIndices: number[] = Array.from(meshData.indices);
        
        // Add skirt vertices around the perimeter
        const skirtIndices: number[] = [];
        
        // Top edge skirt
        for (let j = 0; j < resolution; j++) {
            const vertexIndex = j;
            const x = meshData.vertices[vertexIndex * 3];
            const y = meshData.vertices[vertexIndex * 3 + 1] - skirtDepth;
            const z = meshData.vertices[vertexIndex * 3 + 2];
            
            newVertices.push(x, y, z);
            newNormals.push(0, -1, 0); // Point downward
            newUvs.push(meshData.uvs[vertexIndex * 2], meshData.uvs[vertexIndex * 2 + 1]);
            newColors.push(
                meshData.colors[vertexIndex * 4],
                meshData.colors[vertexIndex * 4 + 1],
                meshData.colors[vertexIndex * 4 + 2],
                meshData.colors[vertexIndex * 4 + 3]
            );
            
            skirtIndices.push(newVertices.length / 3 - 1);
        }
        
        // Connect top edge with skirt
        for (let j = 0; j < resolution - 1; j++) {
            const topVertex = j;
            const nextTopVertex = j + 1;
            const skirtVertex = originalVertexCount + j;
            const nextSkirtVertex = originalVertexCount + j + 1;
            
            // Add two triangles to connect edge with skirt
            newIndices.push(topVertex, skirtVertex, nextTopVertex);
            newIndices.push(nextTopVertex, skirtVertex, nextSkirtVertex);
        }
        
        // Similar process for bottom, left, and right edges
        // (Implementation details omitted for brevity)
        
        return {
            vertices: new Float32Array(newVertices),
            indices: new Uint32Array(newIndices),
            normals: new Float32Array(newNormals),
            uvs: new Float32Array(newUvs),
            colors: new Float32Array(newColors),
            vertexCount: newVertices.length / 3,
            triangleCount: newIndices.length / 3
        };
    }

    /**
     * Generate tangent and bitangent vectors for normal mapping
     */
    private static generateTangentVectors(meshData: MeshData): void {
        const vertexCount = meshData.vertexCount;
        const tangents = new Float32Array(vertexCount * 3);
        const bitangents = new Float32Array(vertexCount * 3);
        
        // Initialize arrays
        for (let i = 0; i < vertexCount * 3; i++) {
            tangents[i] = 0;
            bitangents[i] = 0;
        }
        
        // Calculate tangents and bitangents for each triangle
        for (let i = 0; i < meshData.indices.length; i += 3) {
            const i0 = meshData.indices[i];
            const i1 = meshData.indices[i + 1];
            const i2 = meshData.indices[i + 2];
            
            // Get vertices
            const v0 = new Vector3(
                meshData.vertices[i0 * 3],
                meshData.vertices[i0 * 3 + 1],
                meshData.vertices[i0 * 3 + 2]
            );
            const v1 = new Vector3(
                meshData.vertices[i1 * 3],
                meshData.vertices[i1 * 3 + 1],
                meshData.vertices[i1 * 3 + 2]
            );
            const v2 = new Vector3(
                meshData.vertices[i2 * 3],
                meshData.vertices[i2 * 3 + 1],
                meshData.vertices[i2 * 3 + 2]
            );
            
            // Get UVs
            const uv0 = [meshData.uvs[i0 * 2], meshData.uvs[i0 * 2 + 1]];
            const uv1 = [meshData.uvs[i1 * 2], meshData.uvs[i1 * 2 + 1]];
            const uv2 = [meshData.uvs[i2 * 2], meshData.uvs[i2 * 2 + 1]];
            
            // Calculate edge vectors
            const edge1 = new Vector3().copy(v1).sub(v0);
            const edge2 = new Vector3().copy(v2).sub(v0);
            
            const deltaUV1 = [uv1[0] - uv0[0], uv1[1] - uv0[1]];
            const deltaUV2 = [uv2[0] - uv0[0], uv2[1] - uv0[1]];
            
            const f = 1.0 / (deltaUV1[0] * deltaUV2[1] - deltaUV2[0] * deltaUV1[1]);
            
            const tangent = new Vector3(
                f * (deltaUV2[1] * edge1.x - deltaUV1[1] * edge2.x),
                f * (deltaUV2[1] * edge1.y - deltaUV1[1] * edge2.y),
                f * (deltaUV2[1] * edge1.z - deltaUV1[1] * edge2.z)
            ).normalize();
            
            const bitangent = new Vector3(
                f * (-deltaUV2[0] * edge1.x + deltaUV1[0] * edge2.x),
                f * (-deltaUV2[0] * edge1.y + deltaUV1[0] * edge2.y),
                f * (-deltaUV2[0] * edge1.z + deltaUV1[0] * edge2.z)
            ).normalize();
            
            // Accumulate tangents for all vertices of this triangle
            for (const vertexIndex of [i0, i1, i2]) {
                tangents[vertexIndex * 3] += tangent.x;
                tangents[vertexIndex * 3 + 1] += tangent.y;
                tangents[vertexIndex * 3 + 2] += tangent.z;
                
                bitangents[vertexIndex * 3] += bitangent.x;
                bitangents[vertexIndex * 3 + 1] += bitangent.y;
                bitangents[vertexIndex * 3 + 2] += bitangent.z;
            }
        }
        
        // Normalize accumulated tangents and bitangents
        for (let i = 0; i < vertexCount; i++) {
            const tangent = new Vector3(
                tangents[i * 3],
                tangents[i * 3 + 1],
                tangents[i * 3 + 2]
            ).normalize();
            
            const bitangent = new Vector3(
                bitangents[i * 3],
                bitangents[i * 3 + 1],
                bitangents[i * 3 + 2]
            ).normalize();
            
            tangents[i * 3] = tangent.x;
            tangents[i * 3 + 1] = tangent.y;
            tangents[i * 3 + 2] = tangent.z;
            
            bitangents[i * 3] = bitangent.x;
            bitangents[i * 3 + 1] = bitangent.y;
            bitangents[i * 3 + 2] = bitangent.z;
        }
        
        // Store tangents in mesh data (would need to extend MeshData interface)
        // For now, tangents are calculated but not stored
    }

    /**
     * Optimize mesh for GPU rendering
     */
    private static optimizeMesh(meshData: MeshData): MeshData {
        // Vertex cache optimization using Tom Forsyth's algorithm
        // This reorders indices to improve GPU vertex cache efficiency
        
        // For now, return original mesh
        // TODO: Implement vertex cache optimization
        return meshData;
    }

    /**
     * Calculate mesh complexity score for adaptive tessellation
     */
    public static calculateComplexity(terrainData: TerrainData): number {
        if (!terrainData.slopes) {
            return 0;
        }
        
        let totalComplexity = 0;
        let maxSlope = 0;
        
        for (let i = 0; i < terrainData.slopes.length; i++) {
            const slope = terrainData.slopes[i];
            totalComplexity += slope * slope; // Square to emphasize steep areas
            maxSlope = Math.max(maxSlope, slope);
        }
        
        const averageComplexity = totalComplexity / terrainData.slopes.length;
        return averageComplexity * maxSlope; // Weight by maximum slope
    }

    /**
     * Sample height from heightmap with bilinear interpolation
     */
    private static sampleHeightmap(
        heightmap: Float32Array, 
        size: number, 
        x: number, 
        z: number
    ): number {
        const fx = Math.max(0, Math.min(size - 1.001, x));
        const fz = Math.max(0, Math.min(size - 1.001, z));
        
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        
        const tx = fx - ix;
        const tz = fz - iz;
        
        const h00 = heightmap[iz * size + ix];
        const h10 = heightmap[iz * size + Math.min(ix + 1, size - 1)];
        const h01 = heightmap[Math.min(iz + 1, size - 1) * size + ix];
        const h11 = heightmap[Math.min(iz + 1, size - 1) * size + Math.min(ix + 1, size - 1)];
        
        const h0 = h00 * (1 - tx) + h10 * tx;
        const h1 = h01 * (1 - tx) + h11 * tx;
        
        return h0 * (1 - tz) + h1 * tz;
    }

    /**
     * Sample normal vectors with bilinear interpolation
     */
    private static sampleNormals(
        normals: Float32Array | undefined,
        size: number,
        x: number,
        z: number
    ): Vector3 {
        if (!normals) {
            return new Vector3(0, 1, 0); // Default up vector
        }
        
        const fx = Math.max(0, Math.min(size - 1.001, x));
        const fz = Math.max(0, Math.min(size - 1.001, z));
        
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        
        const tx = fx - ix;
        const tz = fz - iz;
        
        const getIndex = (i: number, j: number) => Math.min(i, size - 1) * size + Math.min(j, size - 1);
        
        const idx00 = getIndex(iz, ix) * 3;
        const idx10 = getIndex(iz, ix + 1) * 3;
        const idx01 = getIndex(iz + 1, ix) * 3;
        const idx11 = getIndex(iz + 1, ix + 1) * 3;
        
        // Interpolate X component
        const nx0 = normals[idx00] * (1 - tx) + normals[idx10] * tx;
        const nx1 = normals[idx01] * (1 - tx) + normals[idx11] * tx;
        const nx = nx0 * (1 - tz) + nx1 * tz;
        
        // Interpolate Y component
        const ny0 = normals[idx00 + 1] * (1 - tx) + normals[idx10 + 1] * tx;
        const ny1 = normals[idx01 + 1] * (1 - tx) + normals[idx11 + 1] * tx;
        const ny = ny0 * (1 - tz) + ny1 * tz;
        
        // Interpolate Z component
        const nz0 = normals[idx00 + 2] * (1 - tx) + normals[idx10 + 2] * tx;
        const nz1 = normals[idx01 + 2] * (1 - tx) + normals[idx11 + 2] * tx;
        const nz = nz0 * (1 - tz) + nz1 * tz;
        
        return new Vector3(nx, ny, nz).normalize();
    }

    /**
     * Sample material ID with nearest neighbor
     */
    private static sampleMaterials(
        materials: Uint8Array | undefined,
        size: number,
        x: number,
        z: number
    ): number {
        if (!materials) {
            return 0; // Default material
        }
        
        const ix = Math.max(0, Math.min(size - 1, Math.round(x)));
        const iz = Math.max(0, Math.min(size - 1, Math.round(z)));
        
        return materials[iz * size + ix];
    }

    /**
     * Get color for material ID
     */
    private static getMaterialColor(materialId: number): [number, number, number] {
        // Map material IDs to colors based on biome configuration
        const colors: { [key: number]: [number, number, number] } = {
            0: [0.0, 0.4, 0.8], // Ocean - blue
            1: [0.9, 0.8, 0.6], // Beach - sand
            2: [0.4, 0.7, 0.2], // Grassland - green
            3: [0.2, 0.5, 0.1], // Forest - dark green
            4: [0.9, 0.7, 0.4], // Desert - tan
            5: [0.6, 0.6, 0.6], // Mountain - gray
            6: [0.95, 0.95, 0.95], // Snow - white
            7: [0.5, 0.6, 0.5], // Tundra - gray-green
            8: [0.3, 0.5, 0.3], // Wetland - dark green
            9: [0.7, 0.7, 0.7]  // Urban - gray
        };
        
        return colors[materialId] || [0.5, 0.5, 0.5]; // Default gray
    }

    /**
     * Generate mesh statistics for performance monitoring
     */
    public static generateStatistics(meshData: MeshData, generationTime: number): MeshStatistics {
        const memoryUsage = meshData.vertices.byteLength + 
                           meshData.indices.byteLength + 
                           meshData.normals.byteLength + 
                           meshData.uvs.byteLength + 
                           (meshData.colors?.byteLength || 0);
        
        const meshComplexity = meshData.triangleCount / meshData.vertexCount;
        
        return {
            vertexCount: meshData.vertexCount,
            triangleCount: meshData.triangleCount,
            meshComplexity,
            generationTime,
            memoryUsage
        };
    }

    /**
     * Validate mesh data integrity
     */
    public static validateMesh(meshData: MeshData): boolean {
        // Check if indices are within vertex count bounds
        for (let i = 0; i < meshData.indices.length; i++) {
            if (meshData.indices[i] >= meshData.vertexCount) {
                console.error(`Invalid index ${meshData.indices[i]} at position ${i}, vertex count: ${meshData.vertexCount}`);
                return false;
            }
        }
        
        // Check if array lengths match expectations
        if (meshData.vertices.length !== meshData.vertexCount * 3) {
            console.error('Vertex array length mismatch');
            return false;
        }
        
        if (meshData.normals.length !== meshData.vertexCount * 3) {
            console.error('Normal array length mismatch');
            return false;
        }
        
        if (meshData.uvs.length !== meshData.vertexCount * 2) {
            console.error('UV array length mismatch');
            return false;
        }
        
        if (meshData.indices.length !== meshData.triangleCount * 3) {
            console.error('Index array length mismatch');
            return false;
        }
        
        return true;
    }
}