import { Vector3 } from '../core/math';
import { Camera } from './Camera';
import { ShadowSystem } from './ShadowSystem';
import { WaterRenderer } from './WaterRenderer';

/**
 * Performance metrics for optimization decisions
 */
export interface PerformanceMetrics {
    frameTime: number;
    shadowRenderTime: number;
    waterRenderTime: number;
    terrainRenderTime: number;
    triangleCount: number;
    drawCalls: number;
    memoryUsage: number;
    fps: number;
    gpuUtilization: number;
}

/**
 * Dynamic quality settings based on performance
 */
export interface DynamicQualitySettings {
    shadowMapResolution: number;
    shadowCascadeCount: number;
    shadowDistance: number;
    waterReflectionResolution: number;
    waterReflectionUpdateRate: number;
    terrainLODBias: number;
    cullingDistance: number;
    foamQuality: number;
    postProcessingEnabled: boolean;
}

/**
 * Performance optimization targets
 */
export interface PerformanceTargets {
    targetFPS: number;
    maxFrameTime: number;
    maxShadowTime: number;
    maxWaterTime: number;
    maxMemoryUsage: number;
    minQualityLevel: number;
}

/**
 * Performance optimization system for maintaining target framerate
 */
export class PerformanceOptimizer {
    private targets: PerformanceTargets;
    private currentQuality: DynamicQualitySettings;
    private metrics: PerformanceMetrics;
    private frameHistory: number[] = [];
    private optimizationHistory: number[] = [];

    private shadowSystem: ShadowSystem | null = null;
    private waterRenderer: WaterRenderer | null = null;

    private lastOptimizationTime: number = 0;
    private optimizationInterval: number = 1000; // 1 second
    private stabilityThreshold: number = 3; // Frames needed for stable measurement

    constructor(targets?: Partial<PerformanceTargets>) {
        this.targets = {
            targetFPS: 60,
            maxFrameTime: 16.67, // 60 FPS = 16.67ms per frame
            maxShadowTime: 4.0, // Max 4ms for shadows
            maxWaterTime: 3.0, // Max 3ms for water
            maxMemoryUsage: 512 * 1024 * 1024, // 512MB
            minQualityLevel: 0.3, // Minimum 30% quality
            ...targets,
        };

        // Start with high quality settings
        this.currentQuality = {
            shadowMapResolution: 2048,
            shadowCascadeCount: 4,
            shadowDistance: 10000,
            waterReflectionResolution: 1024,
            waterReflectionUpdateRate: 30,
            terrainLODBias: 1.0,
            cullingDistance: 50000,
            foamQuality: 1.0,
            postProcessingEnabled: true,
        };

        this.metrics = {
            frameTime: 16.67,
            shadowRenderTime: 0,
            waterRenderTime: 0,
            terrainRenderTime: 0,
            triangleCount: 0,
            drawCalls: 0,
            memoryUsage: 0,
            fps: 60,
            gpuUtilization: 0,
        };
    }

    /**
     * Initialize optimizer with rendering systems
     */
    public initialize(
        shadowSystem: ShadowSystem | null,
        waterRenderer: WaterRenderer | null
    ): void {
        this.shadowSystem = shadowSystem;
        this.waterRenderer = waterRenderer;
    }

    /**
     * Update performance metrics and optimize if needed
     */
    public update(frameTime: number, renderMetrics: Partial<PerformanceMetrics>): void {
        // Update metrics
        this.metrics.frameTime = frameTime;
        this.metrics.fps = 1000 / frameTime;
        Object.assign(this.metrics, renderMetrics);

        // Add to frame history
        this.frameHistory.push(frameTime);
        if (this.frameHistory.length > 60) {
            // Keep last 60 frames
            this.frameHistory.shift();
        }

        // Check if optimization is needed
        const now = performance.now();
        if (now - this.lastOptimizationTime >= this.optimizationInterval) {
            this.optimizePerformance();
            this.lastOptimizationTime = now;
        }
    }

    /**
     * Perform performance optimization
     */
    private optimizePerformance(): void {
        if (this.frameHistory.length < this.stabilityThreshold) {
            return; // Not enough data for stable optimization
        }

        const avgFrameTime =
            this.frameHistory.reduce((a, b) => a + b, 0) / this.frameHistory.length;
        const avgFPS = 1000 / avgFrameTime;
        const isUnderperforming = avgFPS < this.targets.targetFPS * 0.9; // 10% tolerance
        const isOverperforming = avgFPS > this.targets.targetFPS * 1.1;

        if (isUnderperforming) {
            this.reduceQuality();
        } else if (isOverperforming) {
            this.increaseQuality();
        }

        this.applyQualitySettings();
    }

    /**
     * Reduce quality settings to improve performance
     */
    private reduceQuality(): void {
        const reductionFactor = 0.85; // Reduce by 15%

        // Prioritize reductions by performance impact

        // 1. Shadow quality (highest impact)
        if (this.metrics.shadowRenderTime > this.targets.maxShadowTime) {
            if (this.currentQuality.shadowMapResolution > 512) {
                this.currentQuality.shadowMapResolution = Math.max(
                    512,
                    Math.floor(this.currentQuality.shadowMapResolution * reductionFactor)
                );
            }

            if (this.currentQuality.shadowCascadeCount > 2) {
                this.currentQuality.shadowCascadeCount = Math.max(
                    2,
                    this.currentQuality.shadowCascadeCount - 1
                );
            }

            this.currentQuality.shadowDistance = Math.max(
                2000,
                this.currentQuality.shadowDistance * reductionFactor
            );
        }

        // 2. Water reflection quality
        if (this.metrics.waterRenderTime > this.targets.maxWaterTime) {
            if (this.currentQuality.waterReflectionResolution > 256) {
                this.currentQuality.waterReflectionResolution = Math.max(
                    256,
                    Math.floor(this.currentQuality.waterReflectionResolution * reductionFactor)
                );
            }

            this.currentQuality.waterReflectionUpdateRate = Math.max(
                15,
                this.currentQuality.waterReflectionUpdateRate * reductionFactor
            );

            this.currentQuality.foamQuality = Math.max(
                0.3,
                this.currentQuality.foamQuality * reductionFactor
            );
        }

        // 3. Terrain and culling
        this.currentQuality.terrainLODBias = Math.max(
            0.5,
            this.currentQuality.terrainLODBias * reductionFactor
        );

        this.currentQuality.cullingDistance = Math.max(
            10000,
            this.currentQuality.cullingDistance * reductionFactor
        );

        // 4. Disable post-processing if severely underperforming
        if (avgFPS < this.targets.targetFPS * 0.7) {
            this.currentQuality.postProcessingEnabled = false;
        }

        console.log('Performance Optimizer: Reduced quality settings', {
            shadowRes: this.currentQuality.shadowMapResolution,
            waterRes: this.currentQuality.waterReflectionResolution,
            fps: this.metrics.fps.toFixed(1),
        });
    }

    /**
     * Increase quality settings when performance allows
     */
    private increaseQuality(): void {
        const increaseFactor = 1.1; // Increase by 10%

        // Gradually increase quality, starting with most impactful features

        // 1. Re-enable post-processing
        if (!this.currentQuality.postProcessingEnabled) {
            this.currentQuality.postProcessingEnabled = true;
        }

        // 2. Increase shadow quality
        if (this.currentQuality.shadowMapResolution < 2048) {
            this.currentQuality.shadowMapResolution = Math.min(
                2048,
                Math.floor(this.currentQuality.shadowMapResolution * increaseFactor)
            );
        }

        if (this.currentQuality.shadowCascadeCount < 4) {
            this.currentQuality.shadowCascadeCount = Math.min(
                4,
                this.currentQuality.shadowCascadeCount + 1
            );
        }

        this.currentQuality.shadowDistance = Math.min(
            10000,
            this.currentQuality.shadowDistance * increaseFactor
        );

        // 3. Increase water quality
        if (this.currentQuality.waterReflectionResolution < 1024) {
            this.currentQuality.waterReflectionResolution = Math.min(
                1024,
                Math.floor(this.currentQuality.waterReflectionResolution * increaseFactor)
            );
        }

        this.currentQuality.waterReflectionUpdateRate = Math.min(
            30,
            this.currentQuality.waterReflectionUpdateRate * increaseFactor
        );

        this.currentQuality.foamQuality = Math.min(
            1.0,
            this.currentQuality.foamQuality * increaseFactor
        );

        // 4. Improve terrain detail
        this.currentQuality.terrainLODBias = Math.min(
            1.0,
            this.currentQuality.terrainLODBias * increaseFactor
        );

        this.currentQuality.cullingDistance = Math.min(
            50000,
            this.currentQuality.cullingDistance * increaseFactor
        );
    }

    /**
     * Apply current quality settings to rendering systems
     */
    private applyQualitySettings(): void {
        // Apply shadow settings
        if (this.shadowSystem) {
            // Note: Shadow system would need methods to update these settings dynamically
            // For now, we'll log the intended changes
            console.log('Would update shadow settings:', {
                resolution: this.currentQuality.shadowMapResolution,
                cascades: this.currentQuality.shadowCascadeCount,
                distance: this.currentQuality.shadowDistance,
            });
        }

        // Apply water settings
        if (this.waterRenderer) {
            const config = this.waterRenderer.getConfig();
            config.reflection.resolution = this.currentQuality.waterReflectionResolution;
            config.reflection.updateFrequency = this.currentQuality.waterReflectionUpdateRate;
            config.foamEnabled = this.currentQuality.foamQuality > 0.5;

            // Note: WaterRenderer would need methods to update these settings dynamically
            console.log('Would update water settings:', {
                reflectionRes: this.currentQuality.waterReflectionResolution,
                updateRate: this.currentQuality.waterReflectionUpdateRate,
                foamQuality: this.currentQuality.foamQuality,
            });
        }
    }

    /**
     * Calculate frustum culling distance based on performance
     */
    public getCullingDistance(camera: Camera): number {
        const baseDistance = this.currentQuality.cullingDistance;

        // Reduce culling distance if performance is poor
        if (this.metrics.fps < this.targets.targetFPS * 0.8) {
            return baseDistance * 0.7;
        }

        return baseDistance;
    }

    /**
     * Get LOD bias for terrain rendering
     */
    public getTerrainLODBias(): number {
        return this.currentQuality.terrainLODBias;
    }

    /**
     * Check if shadows should be rendered
     */
    public shouldRenderShadows(): boolean {
        return (
            this.currentQuality.shadowMapResolution >= 512 &&
            this.metrics.frameTime < this.targets.maxFrameTime * 1.5
        );
    }

    /**
     * Check if water reflections should be updated this frame
     */
    public shouldUpdateReflections(frameCount: number): boolean {
        const updateInterval = Math.max(
            1,
            Math.floor(60 / this.currentQuality.waterReflectionUpdateRate)
        );
        return frameCount % updateInterval === 0;
    }

    /**
     * Get current performance metrics
     */
    public getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    /**
     * Get current quality settings
     */
    public getQualitySettings(): DynamicQualitySettings {
        return { ...this.currentQuality };
    }

    /**
     * Get performance targets
     */
    public getTargets(): PerformanceTargets {
        return { ...this.targets };
    }

    /**
     * Force quality level (0.0 to 1.0)
     */
    public setQualityLevel(level: number): void {
        const clampedLevel = Math.max(this.targets.minQualityLevel, Math.min(1.0, level));

        this.currentQuality.shadowMapResolution = Math.floor(512 + (2048 - 512) * clampedLevel);
        this.currentQuality.shadowCascadeCount = Math.floor(2 + (4 - 2) * clampedLevel);
        this.currentQuality.shadowDistance = 2000 + (10000 - 2000) * clampedLevel;
        this.currentQuality.waterReflectionResolution = Math.floor(
            256 + (1024 - 256) * clampedLevel
        );
        this.currentQuality.waterReflectionUpdateRate = 15 + (30 - 15) * clampedLevel;
        this.currentQuality.terrainLODBias = 0.5 + (1.0 - 0.5) * clampedLevel;
        this.currentQuality.cullingDistance = 10000 + (50000 - 10000) * clampedLevel;
        this.currentQuality.foamQuality = 0.3 + (1.0 - 0.3) * clampedLevel;
        this.currentQuality.postProcessingEnabled = clampedLevel > 0.7;

        this.applyQualitySettings();
    }

    /**
     * Get current quality level (0.0 to 1.0)
     */
    public getQualityLevel(): number {
        // Calculate average quality level from current settings
        const shadowLevel = (this.currentQuality.shadowMapResolution - 512) / (2048 - 512);
        const waterLevel = (this.currentQuality.waterReflectionResolution - 256) / (1024 - 256);
        const terrainLevel = (this.currentQuality.terrainLODBias - 0.5) / (1.0 - 0.5);

        return (shadowLevel + waterLevel + terrainLevel) / 3;
    }

    /**
     * Reset to default quality settings
     */
    public reset(): void {
        this.currentQuality = {
            shadowMapResolution: 2048,
            shadowCascadeCount: 4,
            shadowDistance: 10000,
            waterReflectionResolution: 1024,
            waterReflectionUpdateRate: 30,
            terrainLODBias: 1.0,
            cullingDistance: 50000,
            foamQuality: 1.0,
            postProcessingEnabled: true,
        };

        this.frameHistory = [];
        this.optimizationHistory = [];
        this.applyQualitySettings();
    }
}
