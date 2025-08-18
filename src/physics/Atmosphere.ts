/**
 * International Standard Atmosphere (ISA) Model
 * Provides atmospheric properties at different altitudes
 */
export class Atmosphere {
    // ISA Constants
    private static readonly SEA_LEVEL_PRESSURE = 101325; // Pa
    private static readonly SEA_LEVEL_TEMPERATURE = 288.15; // K (15°C)
    private static readonly SEA_LEVEL_DENSITY = 1.225; // kg/m³
    private static readonly TEMPERATURE_LAPSE_RATE = -0.0065; // K/m (troposphere)
    private static readonly GAS_CONSTANT = 287.058; // J/(kg·K)
    private static readonly GRAVITY = 9.80665; // m/s²
    private static readonly TROPOPAUSE_ALTITUDE = 11000; // m
    private static readonly SPEED_OF_SOUND_SEA_LEVEL = 340.29; // m/s
    private static readonly GAMMA = 1.4; // Specific heat ratio for air

    // Current conditions (can be modified for weather)
    private temperatureOffset: number = 0; // K
    private pressureOffset: number = 0; // Pa
    private windVelocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

    /**
     * Calculate temperature at altitude using ISA model
     * @param altitude Altitude in meters
     * @returns Temperature in Kelvin
     */
    public getTemperature(altitude: number): number {
        let temperature: number;

        if (altitude <= Atmosphere.TROPOPAUSE_ALTITUDE) {
            // Troposphere: temperature decreases linearly
            temperature = Atmosphere.SEA_LEVEL_TEMPERATURE + 
                         Atmosphere.TEMPERATURE_LAPSE_RATE * altitude;
        } else if (altitude <= 20000) {
            // Lower stratosphere: isothermal
            temperature = 216.65; // K (-56.5°C)
        } else if (altitude <= 32000) {
            // Upper stratosphere: temperature increases
            temperature = 216.65 + 0.001 * (altitude - 20000);
        } else {
            // Above 32km: simplified model
            temperature = 228.65;
        }

        return temperature + this.temperatureOffset;
    }

    /**
     * Calculate pressure at altitude using barometric formula
     * @param altitude Altitude in meters
     * @returns Pressure in Pascals
     */
    public getPressure(altitude: number): number {
        const temperature = this.getTemperature(altitude);
        let pressure: number;

        if (altitude <= Atmosphere.TROPOPAUSE_ALTITUDE) {
            // Troposphere
            const tempRatio = temperature / Atmosphere.SEA_LEVEL_TEMPERATURE;
            const exponent = -Atmosphere.GRAVITY / 
                           (Atmosphere.TEMPERATURE_LAPSE_RATE * Atmosphere.GAS_CONSTANT);
            pressure = Atmosphere.SEA_LEVEL_PRESSURE * Math.pow(tempRatio, exponent);
        } else if (altitude <= 20000) {
            // Lower stratosphere (isothermal)
            const tropoPressure = this.getPressure(Atmosphere.TROPOPAUSE_ALTITUDE);
            const heightDiff = altitude - Atmosphere.TROPOPAUSE_ALTITUDE;
            const exponent = -Atmosphere.GRAVITY * heightDiff / 
                           (Atmosphere.GAS_CONSTANT * 216.65);
            pressure = tropoPressure * Math.exp(exponent);
        } else {
            // Simplified for higher altitudes
            pressure = Atmosphere.SEA_LEVEL_PRESSURE * 
                      Math.exp(-altitude / 7000);
        }

        return pressure + this.pressureOffset;
    }

    /**
     * Calculate air density at altitude
     * @param altitude Altitude in meters
     * @returns Density in kg/m³
     */
    public getDensity(altitude: number): number {
        const pressure = this.getPressure(altitude);
        const temperature = this.getTemperature(altitude);
        
        // Ideal gas law: ρ = P / (R * T)
        return pressure / (Atmosphere.GAS_CONSTANT * temperature);
    }

    /**
     * Calculate speed of sound at altitude
     * @param altitude Altitude in meters
     * @returns Speed of sound in m/s
     */
    public getSpeedOfSound(altitude: number): number {
        const temperature = this.getTemperature(altitude);
        
        // a = sqrt(γ * R * T)
        return Math.sqrt(Atmosphere.GAMMA * Atmosphere.GAS_CONSTANT * temperature);
    }

    /**
     * Calculate dynamic viscosity using Sutherland's formula
     * @param altitude Altitude in meters
     * @returns Dynamic viscosity in Pa·s
     */
    public getDynamicViscosity(altitude: number): number {
        const temperature = this.getTemperature(altitude);
        const T0 = 273.15; // Reference temperature
        const mu0 = 1.716e-5; // Reference viscosity
        const S = 110.4; // Sutherland's constant

        return mu0 * Math.pow(temperature / T0, 1.5) * 
               (T0 + S) / (temperature + S);
    }

    /**
     * Calculate kinematic viscosity
     * @param altitude Altitude in meters
     * @returns Kinematic viscosity in m²/s
     */
    public getKinematicViscosity(altitude: number): number {
        const dynamicViscosity = this.getDynamicViscosity(altitude);
        const density = this.getDensity(altitude);
        return dynamicViscosity / density;
    }

    /**
     * Calculate Reynolds number for an object
     * @param velocity Velocity in m/s
     * @param characteristicLength Characteristic length in meters
     * @param altitude Altitude in meters
     * @returns Reynolds number (dimensionless)
     */
    public getReynoldsNumber(
        velocity: number, 
        characteristicLength: number, 
        altitude: number
    ): number {
        const kinematicViscosity = this.getKinematicViscosity(altitude);
        return (velocity * characteristicLength) / kinematicViscosity;
    }

    /**
     * Calculate Mach number
     * @param velocity Velocity in m/s
     * @param altitude Altitude in meters
     * @returns Mach number (dimensionless)
     */
    public getMachNumber(velocity: number, altitude: number): number {
        const speedOfSound = this.getSpeedOfSound(altitude);
        return velocity / speedOfSound;
    }

    /**
     * Get all atmospheric properties at altitude
     * @param altitude Altitude in meters
     * @returns Object containing all atmospheric properties
     */
    public getProperties(altitude: number): AtmosphericProperties {
        return {
            altitude,
            temperature: this.getTemperature(altitude),
            pressure: this.getPressure(altitude),
            density: this.getDensity(altitude),
            speedOfSound: this.getSpeedOfSound(altitude),
            dynamicViscosity: this.getDynamicViscosity(altitude),
            kinematicViscosity: this.getKinematicViscosity(altitude)
        };
    }

    /**
     * Set weather conditions (deviations from ISA)
     * @param tempOffset Temperature offset in Kelvin
     * @param pressureOffset Pressure offset in Pascals
     */
    public setWeatherConditions(tempOffset: number, pressureOffset: number): void {
        this.temperatureOffset = tempOffset;
        this.pressureOffset = pressureOffset;
    }

    /**
     * Set wind conditions
     * @param windX Wind velocity X component (m/s) - North positive
     * @param windY Wind velocity Y component (m/s) - Up positive
     * @param windZ Wind velocity Z component (m/s) - East positive
     */
    public setWind(windX: number, windY: number, windZ: number): void {
        this.windVelocity = { x: windX, y: windY, z: windZ };
    }

    /**
     * Get wind velocity at altitude (can be enhanced with wind profiles)
     * @param altitude Altitude in meters
     * @returns Wind velocity vector
     */
    public getWind(altitude: number): { x: number; y: number; z: number } {
        // Simple boundary layer model
        const boundaryHeight = 500; // meters
        let windFactor = 1.0;
        
        if (altitude < boundaryHeight) {
            // Power law wind profile
            windFactor = Math.pow(altitude / boundaryHeight, 0.143);
        }

        return {
            x: this.windVelocity.x * windFactor,
            y: this.windVelocity.y,
            z: this.windVelocity.z * windFactor
        };
    }

    /**
     * Calculate pressure altitude from actual pressure
     * @param pressure Pressure in Pascals
     * @returns Pressure altitude in meters
     */
    public getPressureAltitude(pressure: number): number {
        if (pressure > 22632) {
            // Troposphere
            const tempRatio = Math.pow(pressure / Atmosphere.SEA_LEVEL_PRESSURE, 
                                       -Atmosphere.TEMPERATURE_LAPSE_RATE * 
                                       Atmosphere.GAS_CONSTANT / Atmosphere.GRAVITY);
            return (Atmosphere.SEA_LEVEL_TEMPERATURE * (1 - tempRatio)) / 
                   (-Atmosphere.TEMPERATURE_LAPSE_RATE);
        } else {
            // Stratosphere (simplified)
            return Atmosphere.TROPOPAUSE_ALTITUDE - 
                   Math.log(pressure / 22632) * 216.65 * 
                   Atmosphere.GAS_CONSTANT / Atmosphere.GRAVITY;
        }
    }

    /**
     * Calculate density altitude
     * @param pressure Pressure in Pascals
     * @param temperature Temperature in Kelvin
     * @returns Density altitude in meters
     */
    public getDensityAltitude(pressure: number, temperature: number): number {
        const density = pressure / (Atmosphere.GAS_CONSTANT * temperature);
        
        // Find altitude with equivalent density in ISA
        // Using iterative approach for accuracy
        let altitudeLow = -1000;
        let altitudeHigh = 20000;
        let altitudeMid: number;
        
        for (let i = 0; i < 20; i++) {
            altitudeMid = (altitudeLow + altitudeHigh) / 2;
            const isaDensity = this.getDensity(altitudeMid);
            
            if (isaDensity > density) {
                altitudeLow = altitudeMid;
            } else {
                altitudeHigh = altitudeMid;
            }
        }
        
        return (altitudeLow + altitudeHigh) / 2;
    }

    /**
     * Reset to standard ISA conditions
     */
    public reset(): void {
        this.temperatureOffset = 0;
        this.pressureOffset = 0;
        this.windVelocity = { x: 0, y: 0, z: 0 };
    }
}

/**
 * Interface for atmospheric properties
 */
export interface AtmosphericProperties {
    altitude: number;          // meters
    temperature: number;       // Kelvin
    pressure: number;         // Pascals
    density: number;          // kg/m³
    speedOfSound: number;     // m/s
    dynamicViscosity: number; // Pa·s
    kinematicViscosity: number; // m²/s
}