/**
 * Atmospheric Terrain Rendering Example
 * Demonstrates the enhanced TerrainRenderer with photorealistic atmospheric effects
 */

import { TerrainRenderer } from './TerrainRenderer';
import { Camera } from './Camera';
import { Vector3 } from '../core/math';

/**
 * Example class demonstrating atmospheric terrain rendering
 */
export class AtmosphericTerrainExample {
    private terrainRenderer: TerrainRenderer;
    private camera: Camera;
    private timeOfDay: number = 0.5; // Start at noon
    private animationSpeed: number = 0.01; // Time progression speed

    constructor(device: GPUDevice, camera: Camera) {
        this.terrainRenderer = new TerrainRenderer(device);
        this.camera = camera;

        // Initialize with default atmospheric settings
        this.setupAtmosphericEffects();
    }

    /**
     * Configure atmospheric effects for different scenarios
     */
    private setupAtmosphericEffects(): void {
        // Set default atmospheric parameters for a clear day
        this.terrainRenderer.updateAtmosphericParams({
            sunIntensity: 20.0,
            fogDensity: 0.000008,
            fogHeightFalloff: 0.0001,
            mieG: 0.8,
            exposure: 1.0,
            rayleighStrength: 1.0,
            mieStrength: 1.0,
        });
    }

    /**
     * Simulate different weather conditions
     */
    public setWeatherCondition(condition: 'clear' | 'hazy' | 'foggy' | 'stormy'): void {
        switch (condition) {
            case 'clear':
                this.terrainRenderer.updateAtmosphericParams({
                    fogDensity: 0.000005,
                    mieStrength: 0.8,
                    rayleighStrength: 1.0,
                    exposure: 1.0,
                });
                break;

            case 'hazy':
                this.terrainRenderer.updateAtmosphericParams({
                    fogDensity: 0.000015,
                    mieStrength: 1.5,
                    rayleighStrength: 0.7,
                    exposure: 0.9,
                });
                break;

            case 'foggy':
                this.terrainRenderer.updateAtmosphericParams({
                    fogDensity: 0.00005,
                    fogHeightFalloff: 0.0005,
                    mieStrength: 2.0,
                    rayleighStrength: 0.5,
                    exposure: 0.7,
                });
                break;

            case 'stormy':
                this.terrainRenderer.updateAtmosphericParams({
                    fogDensity: 0.00003,
                    sunIntensity: 10.0,
                    mieStrength: 1.8,
                    rayleighStrength: 0.6,
                    exposure: 0.6,
                    mieG: 0.9,
                });
                break;
        }
    }

    /**
     * Set specific time of day
     */
    public setTimeOfDay(timeOfDay: number): void {
        this.timeOfDay = Math.max(0, Math.min(1, timeOfDay));
        this.terrainRenderer.setTimeOfDay(this.timeOfDay);
    }

    /**
     * Animate time progression
     */
    public updateTimeProgression(deltaTime: number): void {
        this.timeOfDay += deltaTime * this.animationSpeed;
        if (this.timeOfDay > 1.0) {
            this.timeOfDay = 0.0; // Reset to midnight
        }
        this.terrainRenderer.setTimeOfDay(this.timeOfDay);
    }

    /**
     * Get the current time of day as a formatted string
     */
    public getTimeString(): string {
        const hours = Math.floor(this.timeOfDay * 24);
        const minutes = Math.floor((this.timeOfDay * 24 - hours) * 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    /**
     * Configure for different altitudes
     */
    public setAltitudeEffects(altitude: number): void {
        // Adjust atmospheric effects based on altitude
        const altitudeFactor = Math.min(altitude / 10000.0, 1.0); // Normalize to 10km

        // Higher altitude = less atmosphere = less scattering
        const rayleighStrength = 1.0 - altitudeFactor * 0.5;
        const mieStrength = 1.0 - altitudeFactor * 0.7;
        const fogDensity = 0.000008 * (1.0 - altitudeFactor * 0.8);

        this.terrainRenderer.updateAtmosphericParams({
            rayleighStrength,
            mieStrength,
            fogDensity,
        });
    }

    /**
     * Set seasonal atmospheric conditions
     */
    public setSeasonalEffects(season: 'spring' | 'summer' | 'autumn' | 'winter'): void {
        switch (season) {
            case 'spring':
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 18.0,
                    mieG: 0.75,
                    exposure: 1.0,
                });
                break;

            case 'summer':
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 22.0,
                    mieG: 0.85,
                    mieStrength: 1.2,
                    exposure: 1.1,
                });
                break;

            case 'autumn':
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 16.0,
                    mieG: 0.8,
                    rayleighStrength: 0.9,
                    exposure: 0.9,
                });
                break;

            case 'winter':
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 14.0,
                    mieG: 0.7,
                    rayleighStrength: 1.1,
                    exposure: 0.8,
                });
                break;
        }
    }

    /**
     * Demo preset configurations for different scenarios
     */
    public loadPreset(
        preset: 'golden_hour' | 'blue_hour' | 'high_altitude' | 'pollution' | 'arctic'
    ): void {
        switch (preset) {
            case 'golden_hour':
                this.setTimeOfDay(0.75); // 6 PM
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 15.0,
                    mieStrength: 1.5,
                    mieG: 0.9,
                    exposure: 1.2,
                });
                break;

            case 'blue_hour':
                this.setTimeOfDay(0.85); // 8:24 PM
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 8.0,
                    rayleighStrength: 1.3,
                    mieStrength: 0.8,
                    exposure: 0.8,
                });
                break;

            case 'high_altitude':
                this.setAltitudeEffects(8000); // 8km altitude
                this.terrainRenderer.updateAtmosphericParams({
                    exposure: 1.3,
                    sunIntensity: 25.0,
                });
                break;

            case 'pollution':
                this.terrainRenderer.updateAtmosphericParams({
                    fogDensity: 0.000025,
                    mieStrength: 2.5,
                    rayleighStrength: 0.6,
                    mieG: 0.95,
                    exposure: 0.7,
                });
                break;

            case 'arctic':
                this.terrainRenderer.updateAtmosphericParams({
                    sunIntensity: 12.0,
                    rayleighStrength: 1.2,
                    mieStrength: 0.5,
                    fogDensity: 0.000003,
                    exposure: 0.9,
                });
                break;
        }
    }

    /**
     * Get the terrain renderer instance
     */
    public getTerrainRenderer(): TerrainRenderer {
        return this.terrainRenderer;
    }

    /**
     * Render with atmospheric effects
     */
    public render(
        renderPass: GPURenderPassEncoder,
        tiles: any[],
        time: number,
        shadowSystem?: any
    ): void {
        this.terrainRenderer.render(renderPass, tiles, this.camera, time, shadowSystem);
    }

    /**
     * Clean up resources
     */
    public destroy(): void {
        this.terrainRenderer.destroy();
    }
}

/**
 * Utility functions for atmospheric calculations
 */
export class AtmosphericUtils {
    /**
     * Calculate sun position for a given time and location
     */
    static calculateSunPosition(
        timeOfDay: number,
        latitude: number = 45.0,
        dayOfYear: number = 180
    ): Vector3 {
        // Convert time of day to hours
        const hours = timeOfDay * 24.0;

        // Solar declination angle (simplified)
        const declination = 23.45 * Math.sin(((dayOfYear - 81) * Math.PI) / 182.5);

        // Hour angle
        const hourAngle = 15.0 * (hours - 12.0);

        // Convert to radians
        const latRad = (latitude * Math.PI) / 180.0;
        const declRad = (declination * Math.PI) / 180.0;
        const hourRad = (hourAngle * Math.PI) / 180.0;

        // Calculate sun elevation and azimuth
        const elevation = Math.asin(
            Math.sin(latRad) * Math.sin(declRad) +
                Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourRad)
        );

        const azimuth = Math.atan2(
            Math.sin(hourRad),
            Math.cos(hourRad) * Math.sin(latRad) - Math.tan(declRad) * Math.cos(latRad)
        );

        // Convert to Cartesian coordinates
        const x = Math.cos(elevation) * Math.sin(azimuth);
        const y = Math.sin(elevation);
        const z = Math.cos(elevation) * Math.cos(azimuth);

        return new Vector3(x, y, z).normalize();
    }

    /**
     * Calculate atmospheric visibility based on weather conditions
     */
    static calculateVisibility(humidity: number, temperature: number, pressure: number): number {
        // Simplified visibility calculation
        const humidityFactor = 1.0 - humidity * 0.3;
        const temperatureFactor = 1.0 + (temperature - 20.0) * 0.01;
        const pressureFactor = pressure / 1013.25; // Normalize to sea level

        return Math.max(0.1, humidityFactor * temperatureFactor * pressureFactor);
    }

    /**
     * Get atmospheric density at a given altitude
     */
    static getAtmosphericDensity(altitude: number): number {
        // Exponential atmosphere model
        const scaleHeight = 8000.0; // meters
        return Math.exp(-altitude / scaleHeight);
    }
}
