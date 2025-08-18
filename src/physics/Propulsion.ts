import { Vector3 } from '../core/math/Vector3';
import { Atmosphere } from './Atmosphere';

/**
 * Base class for all engine types
 */
export abstract class Engine {
    protected position: Vector3;        // Engine position relative to CG
    protected orientation: Vector3;     // Thrust vector direction
    protected maxThrust: number;        // Maximum thrust (N)
    protected throttle: number = 0;     // Throttle setting (0-1)
    protected running: boolean = false; // Engine state
    protected fuelFlow: number = 0;     // Current fuel flow (kg/s)

    constructor(position: Vector3, orientation: Vector3, maxThrust: number) {
        this.position = position;
        this.orientation = orientation.clone().normalize();
        this.maxThrust = maxThrust;
    }

    abstract calculateThrust(altitude: number, airspeed: number, atmosphere: Atmosphere): number;
    abstract calculateFuelFlow(thrust: number, altitude: number): number;
    abstract start(): boolean;
    abstract shutdown(): void;
    abstract update(dt: number, altitude: number, airspeed: number, atmosphere: Atmosphere): void;

    public setThrottle(value: number): void {
        this.throttle = Math.max(0, Math.min(1, value));
    }

    public getThrottle(): number {
        return this.throttle;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public getFuelFlow(): number {
        return this.fuelFlow;
    }

    public getThrustVector(thrust: number): Vector3 {
        return this.orientation.clone().multiplyScalar(thrust);
    }

    public getPosition(): Vector3 {
        return this.position.clone();
    }
}

/**
 * Jet/Turbofan Engine Model
 */
export class JetEngine extends Engine {
    private bypassRatio: number;        // Bypass ratio for turbofan
    private spoolInertia: number;       // Spool-up time constant
    private n1: number = 0;            // Low pressure spool speed (%)
    private n2: number = 0;            // High pressure spool speed (%)
    private egt: number = 15;           // Exhaust gas temperature (°C)
    private tsfc: number;               // Thrust specific fuel consumption (kg/N/s)
    private idleN1: number = 20;        // Idle N1 (%)
    private idleThrust: number = 0.05;  // Idle thrust fraction

    constructor(config: JetEngineConfig) {
        super(config.position, config.orientation, config.maxThrust);
        this.bypassRatio = config.bypassRatio || 5;
        this.spoolInertia = config.spoolInertia || 5;
        this.tsfc = config.tsfc || 0.000015; // ~0.5 lb/lbf/hr
        this.idleN1 = config.idleN1 || 20;
        this.idleThrust = config.idleThrust || 0.05;
    }

    public calculateThrust(altitude: number, airspeed: number, atmosphere: Atmosphere): number {
        if (!this.running) return 0;

        const atmProps = atmosphere.getProperties(altitude);
        
        // Density correction for thrust
        const densityRatio = atmProps.density / 1.225; // Sea level density
        const pressureRatio = atmProps.pressure / 101325;
        
        // Mach effects
        const mach = atmosphere.getMachNumber(airspeed, altitude);
        const ramEffect = 1 + 0.2 * mach * mach; // Ram air effect
        
        // Temperature effects
        const tempRatio = atmProps.temperature / 288.15;
        const tempCorrection = Math.sqrt(1 / tempRatio);
        
        // Calculate thrust lapse
        let thrustLapse = densityRatio * tempCorrection * ramEffect;
        
        // Altitude lapse (simplified model)
        if (altitude > 11000) {
            thrustLapse *= Math.pow(pressureRatio, 0.7);
        }
        
        // Apply throttle setting via N1
        const targetN1 = this.idleN1 + (100 - this.idleN1) * this.throttle;
        const n1Fraction = (this.n1 - this.idleN1) / (100 - this.idleN1);
        const thrustFraction = this.idleThrust + (1 - this.idleThrust) * 
                              (n1Fraction * n1Fraction); // Quadratic relationship
        
        return this.maxThrust * thrustLapse * thrustFraction;
    }

    public calculateFuelFlow(thrust: number, altitude: number): number {
        if (!this.running) return 0;
        
        // Fuel flow increases with altitude due to lower efficiency
        const altitudeFactor = 1 + altitude / 50000;
        
        // TSFC increases at low thrust settings
        const thrustRatio = thrust / this.maxThrust;
        const tsfcMultiplier = thrustRatio > 0.3 ? 1.0 : 1.0 + 2 * (0.3 - thrustRatio);
        
        this.fuelFlow = thrust * this.tsfc * altitudeFactor * tsfcMultiplier;
        return this.fuelFlow;
    }

    public start(): boolean {
        if (!this.running && this.n2 < 5) {
            // Initiate start sequence
            this.running = true;
            this.n2 = 25; // Starter brings N2 to 25%
            return true;
        }
        return false;
    }

    public shutdown(): void {
        this.running = false;
        this.throttle = 0;
    }

    public update(dt: number, altitude: number, airspeed: number, atmosphere: Atmosphere): void {
        if (!this.running) {
            // Spool down
            this.n1 = Math.max(0, this.n1 - 10 * dt);
            this.n2 = Math.max(0, this.n2 - 15 * dt);
            this.egt = Math.max(15, this.egt - 50 * dt);
            return;
        }

        // Calculate target N1 based on throttle
        const targetN1 = this.idleN1 + (100 - this.idleN1) * this.throttle;
        
        // Spool dynamics (first-order lag)
        const n1Rate = (targetN1 - this.n1) / this.spoolInertia;
        this.n1 = Math.max(this.idleN1, Math.min(100, this.n1 + n1Rate * dt));
        
        // N2 follows N1 with slight lag
        const targetN2 = this.n1 * 1.15; // N2 typically higher than N1
        const n2Rate = (targetN2 - this.n2) / (this.spoolInertia * 0.8);
        this.n2 = Math.max(25, Math.min(115, this.n2 + n2Rate * dt));
        
        // EGT model (simplified)
        const targetEGT = 400 + this.n1 * 5; // Linear approximation
        const egtRate = (targetEGT - this.egt) / 3; // 3 second time constant
        this.egt = this.egt + egtRate * dt;
    }

    public getN1(): number { return this.n1; }
    public getN2(): number { return this.n2; }
    public getEGT(): number { return this.egt; }
}

/**
 * Piston/Propeller Engine Model
 */
export class PistonEngine extends Engine {
    private propDiameter: number;       // Propeller diameter (m)
    private propEfficiency: number;     // Propeller efficiency
    private rpm: number = 0;           // Current RPM
    private maxRPM: number;             // Maximum RPM
    private idleRPM: number;            // Idle RPM
    private mixture: number = 1;        // Mixture setting (0-1)
    private manifoldPressure: number;   // Manifold pressure (inHg)
    private cylinderHeadTemp: number;   // CHT (°C)
    private oilTemp: number;            // Oil temperature (°C)
    private oilPressure: number;        // Oil pressure (PSI)

    constructor(config: PistonEngineConfig) {
        super(config.position, config.orientation, config.maxPower * 0.8); // Approximate thrust
        this.propDiameter = config.propDiameter;
        this.propEfficiency = config.propEfficiency || 0.8;
        this.maxRPM = config.maxRPM;
        this.idleRPM = config.idleRPM || 700;
        this.manifoldPressure = 29.92; // Sea level standard
        this.cylinderHeadTemp = 15;
        this.oilTemp = 15;
        this.oilPressure = 0;
    }

    public calculateThrust(altitude: number, airspeed: number, atmosphere: Atmosphere): number {
        if (!this.running) return 0;

        const atmProps = atmosphere.getProperties(altitude);
        
        // Calculate power available
        const densityRatio = atmProps.density / 1.225;
        const powerAvailable = this.maxThrust * densityRatio * (this.rpm / this.maxRPM);
        
        // Propeller efficiency varies with advance ratio
        const advanceRatio = airspeed / (this.rpm / 60 * this.propDiameter);
        let propEff = this.propEfficiency;
        
        // Simple efficiency model
        if (advanceRatio < 0.5) {
            propEff *= advanceRatio * 2;
        } else if (advanceRatio > 1.5) {
            propEff *= Math.max(0.3, 2 - advanceRatio);
        }
        
        // Thrust = Power * Efficiency / Velocity
        const thrust = airspeed > 1 ? 
            (powerAvailable * propEff) / airspeed :
            powerAvailable * propEff * 10; // Static thrust approximation
        
        return thrust * this.throttle;
    }

    public calculateFuelFlow(thrust: number, altitude: number): number {
        if (!this.running) return 0;
        
        // Fuel flow based on power setting and mixture
        const powerSetting = this.throttle * (this.rpm / this.maxRPM);
        const baseFlow = 0.005 * powerSetting * this.maxThrust / 1000; // kg/s
        
        // Mixture effects
        const mixtureFactor = this.mixture > 0.7 ? 1.0 : 1.3; // Rich mixture uses more fuel
        
        this.fuelFlow = baseFlow * mixtureFactor;
        return this.fuelFlow;
    }

    public start(): boolean {
        if (!this.running && this.rpm < 100) {
            // Check conditions for start
            if (this.throttle < 0.2 && this.mixture > 0.8) {
                this.running = true;
                this.rpm = this.idleRPM;
                return true;
            }
        }
        return false;
    }

    public shutdown(): void {
        this.running = false;
        this.mixture = 0;
    }

    public update(dt: number, altitude: number, airspeed: number, atmosphere: Atmosphere): void {
        if (!this.running) {
            // Engine windmilling or stopped
            this.rpm = Math.max(0, this.rpm - 100 * dt);
            this.cylinderHeadTemp = Math.max(15, this.cylinderHeadTemp - 10 * dt);
            this.oilTemp = Math.max(15, this.oilTemp - 5 * dt);
            this.oilPressure = 0;
            return;
        }

        const atmProps = atmosphere.getProperties(altitude);
        
        // Calculate manifold pressure
        const ambientPressure = atmProps.pressure / 3386.39; // Convert to inHg
        this.manifoldPressure = ambientPressure * (0.3 + 0.7 * this.throttle);
        
        // RPM based on throttle and manifold pressure
        const targetRPM = this.idleRPM + 
            (this.maxRPM - this.idleRPM) * this.throttle * (this.manifoldPressure / 29.92);
        const rpmRate = (targetRPM - this.rpm) / 2; // 2 second response
        this.rpm = Math.max(this.idleRPM, Math.min(this.maxRPM * 1.1, this.rpm + rpmRate * dt));
        
        // Temperature models
        const powerSetting = this.throttle * (this.rpm / this.maxRPM);
        
        // CHT
        const targetCHT = 150 + powerSetting * 250 - airspeed * 0.5; // Cooling with airspeed
        const chtRate = (targetCHT - this.cylinderHeadTemp) / 30; // 30 second time constant
        this.cylinderHeadTemp = Math.max(15, Math.min(260, this.cylinderHeadTemp + chtRate * dt));
        
        // Oil temperature follows CHT
        const targetOilTemp = this.cylinderHeadTemp * 0.7;
        const oilTempRate = (targetOilTemp - this.oilTemp) / 60; // Slower response
        this.oilTemp = Math.max(15, Math.min(120, this.oilTemp + oilTempRate * dt));
        
        // Oil pressure
        if (this.rpm > 500) {
            this.oilPressure = 30 + (this.rpm / this.maxRPM) * 50 - (this.oilTemp - 80) * 0.2;
            this.oilPressure = Math.max(0, Math.min(100, this.oilPressure));
        } else {
            this.oilPressure = 0;
        }
    }

    public setMixture(value: number): void {
        this.mixture = Math.max(0, Math.min(1, value));
    }

    public getRPM(): number { return this.rpm; }
    public getManifoldPressure(): number { return this.manifoldPressure; }
    public getCHT(): number { return this.cylinderHeadTemp; }
    public getOilTemp(): number { return this.oilTemp; }
    public getOilPressure(): number { return this.oilPressure; }
}

/**
 * Propulsion system managing multiple engines
 */
export class PropulsionSystem {
    private engines: Engine[] = [];
    private totalThrust: Vector3;
    private totalMoment: Vector3;
    private totalFuelFlow: number = 0;

    constructor() {
        this.totalThrust = new Vector3();
        this.totalMoment = new Vector3();
    }

    /**
     * Add an engine to the system
     * @param engine Engine instance
     */
    public addEngine(engine: Engine): void {
        this.engines.push(engine);
    }

    /**
     * Update all engines and calculate total forces
     * @param dt Time step
     * @param altitude Aircraft altitude
     * @param airspeed Aircraft airspeed
     * @param atmosphere Atmospheric conditions
     * @param cgPosition Center of gravity position
     */
    public update(
        dt: number,
        altitude: number,
        airspeed: number,
        atmosphere: Atmosphere,
        cgPosition: Vector3
    ): void {
        this.totalThrust.set(0, 0, 0);
        this.totalMoment.set(0, 0, 0);
        this.totalFuelFlow = 0;

        for (const engine of this.engines) {
            // Update engine state
            engine.update(dt, altitude, airspeed, atmosphere);

            // Calculate thrust
            const thrust = engine.calculateThrust(altitude, airspeed, atmosphere);
            const thrustVector = engine.getThrustVector(thrust);
            
            // Add to total thrust
            this.totalThrust.add(thrustVector);

            // Calculate moment about CG
            const arm = engine.getPosition().sub(cgPosition);
            const moment = arm.clone().cross(thrustVector);
            this.totalMoment.add(moment);

            // Update fuel flow
            this.totalFuelFlow += engine.calculateFuelFlow(thrust, altitude);
        }
    }

    /**
     * Set throttle for all engines
     * @param throttle Throttle setting (0-1)
     */
    public setThrottle(throttle: number): void {
        for (const engine of this.engines) {
            engine.setThrottle(throttle);
        }
    }

    /**
     * Set throttle for specific engine
     * @param engineIndex Engine index
     * @param throttle Throttle setting (0-1)
     */
    public setEngineThrottle(engineIndex: number, throttle: number): void {
        if (engineIndex >= 0 && engineIndex < this.engines.length) {
            this.engines[engineIndex].setThrottle(throttle);
        }
    }

    /**
     * Start all engines
     */
    public startAllEngines(): boolean {
        let allStarted = true;
        for (const engine of this.engines) {
            if (!engine.start()) {
                allStarted = false;
            }
        }
        return allStarted;
    }

    /**
     * Shutdown all engines
     */
    public shutdownAllEngines(): void {
        for (const engine of this.engines) {
            engine.shutdown();
        }
    }

    public getTotalThrust(): Vector3 { return this.totalThrust.clone(); }
    public getTotalMoment(): Vector3 { return this.totalMoment.clone(); }
    public getTotalFuelFlow(): number { return this.totalFuelFlow; }
    public getEngines(): Engine[] { return this.engines; }
    public getEngineCount(): number { return this.engines.length; }
}

/**
 * Configuration interfaces
 */
export interface JetEngineConfig {
    position: Vector3;
    orientation: Vector3;
    maxThrust: number;      // N
    bypassRatio?: number;
    spoolInertia?: number;  // seconds
    tsfc?: number;          // kg/N/s
    idleN1?: number;        // %
    idleThrust?: number;    // fraction
}

export interface PistonEngineConfig {
    position: Vector3;
    orientation: Vector3;
    maxPower: number;       // Watts
    propDiameter: number;   // meters
    propEfficiency?: number;
    maxRPM: number;
    idleRPM?: number;
}