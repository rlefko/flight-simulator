import { Vector3 } from '../core/math/Vector3';
import { Quaternion } from '../core/math/Quaternion';
import { RigidBody } from './RigidBody';
import { Aerodynamics, AircraftAeroState, ControlSurfaces as IAeroControlSurfaces } from './Aerodynamics';
import { Atmosphere } from './Atmosphere';
import { PropulsionSystem, JetEngine, PistonEngine } from './Propulsion';
import { ControlSurfaceSystem, ControlInputs } from './ControlSurfaces';
import { AircraftState } from './AircraftState';

/**
 * Main Flight Dynamics Engine
 * Integrates all physics subsystems for realistic flight simulation
 */
export class FlightDynamics {
    // Core systems
    private rigidBody: RigidBody;
    private aerodynamics: Aerodynamics;
    private atmosphere: Atmosphere;
    private propulsion: PropulsionSystem;
    private controlSurfaces: ControlSurfaceSystem;
    private aircraftState: AircraftState;

    // Simulation parameters
    private readonly fixedTimeStep: number = 1 / 120; // 120Hz update rate
    private accumulator: number = 0;
    private simulationTime: number = 0;

    // Aircraft configuration
    private config: AircraftConfig;

    // Environmental parameters
    private gravity: Vector3;
    private groundLevel: number = 0;
    private magneticVariation: number = 0;

    // State tracking
    private previousPosition: Vector3;
    private previousVelocity: Vector3;

    constructor(config?: AircraftConfig) {
        // Initialize configuration
        this.config = config || this.getDefaultConfig();

        // Initialize systems
        this.rigidBody = new RigidBody(this.config.mass.empty);
        this.aerodynamics = new Aerodynamics(this.config.aerodynamics);
        this.atmosphere = new Atmosphere();
        this.propulsion = new PropulsionSystem();
        this.controlSurfaces = new ControlSurfaceSystem(this.config.controlSurfaces);
        this.aircraftState = new AircraftState();

        // Set up rigid body
        this.rigidBody.setInertiaTensor(
            this.config.inertia.ixx,
            this.config.inertia.iyy,
            this.config.inertia.izz,
            this.config.inertia.ixy,
            this.config.inertia.ixz,
            this.config.inertia.iyz
        );
        this.rigidBody.centerOfGravity = new Vector3(
            this.config.centerOfGravity.x,
            this.config.centerOfGravity.y,
            this.config.centerOfGravity.z
        );

        // Set up propulsion
        this.initializePropulsion();

        // Initialize environment
        this.gravity = new Vector3(0, -9.80665, 0);
        this.previousPosition = new Vector3();
        this.previousVelocity = new Vector3();

        // Initial state
        this.reset();
    }

    /**
     * Initialize propulsion system based on configuration
     */
    private initializePropulsion(): void {
        if (this.config.engines) {
            for (const engineConfig of this.config.engines) {
                if (engineConfig.type === 'jet') {
                    const engine = new JetEngine({
                        position: new Vector3(engineConfig.position.x, engineConfig.position.y, engineConfig.position.z),
                        orientation: new Vector3(engineConfig.orientation.x, engineConfig.orientation.y, engineConfig.orientation.z),
                        maxThrust: engineConfig.maxThrust || 50000,
                        bypassRatio: engineConfig.bypassRatio || 5,
                        tsfc: engineConfig.tsfc || 0.000015
                    });
                    this.propulsion.addEngine(engine);
                } else if (engineConfig.type === 'piston') {
                    const engine = new PistonEngine({
                        position: new Vector3(engineConfig.position.x, engineConfig.position.y, engineConfig.position.z),
                        orientation: new Vector3(engineConfig.orientation.x, engineConfig.orientation.y, engineConfig.orientation.z),
                        maxPower: engineConfig.maxPower || 134000,
                        propDiameter: engineConfig.propDiameter || 1.9,
                        maxRPM: engineConfig.maxRPM || 2700
                    });
                    this.propulsion.addEngine(engine);
                }
            }
        }
    }

    /**
     * Main update loop - uses fixed timestep with interpolation
     * @param deltaTime Frame time in seconds
     * @returns Interpolation factor for rendering
     */
    public update(deltaTime: number): number {
        // Limit maximum frame time to prevent spiral of death
        deltaTime = Math.min(deltaTime, 0.25);

        // Accumulate time
        this.accumulator += deltaTime;

        // Fixed timestep updates
        while (this.accumulator >= this.fixedTimeStep) {
            this.fixedUpdate(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
            this.simulationTime += this.fixedTimeStep;
        }

        // Return interpolation factor for rendering
        return this.accumulator / this.fixedTimeStep;
    }

    /**
     * Fixed timestep physics update
     * @param dt Fixed time step
     */
    private fixedUpdate(dt: number): void {
        // Store previous state for calculations
        this.previousPosition.copy(this.rigidBody.position);
        this.previousVelocity.copy(this.rigidBody.velocity);

        // Update control surfaces
        this.controlSurfaces.update(dt);
        const controls = this.controlSurfaces.getState();

        // Update control effectiveness based on airspeed
        this.controlSurfaces.updateEffectiveness(
            this.aircraftState.indicatedAirspeed,
            this.aircraftState.stallSpeed
        );

        // Clear forces from previous frame
        this.rigidBody.clearForces();

        // Calculate altitude above ground
        this.aircraftState.altitudeAGL = this.rigidBody.position.y - this.groundLevel;

        // Check ground contact
        const wasOnGround = this.aircraftState.onGround;
        this.aircraftState.onGround = this.aircraftState.altitudeAGL <= 0.1;

        // Apply gravitational force
        const weight = this.gravity.clone().multiplyScalar(this.rigidBody.mass);
        this.rigidBody.applyForce(this.rigidBody.worldToBodyForce(weight));

        if (!this.aircraftState.onGround) {
            // AIRBORNE DYNAMICS

            // Calculate aerodynamic state
            const aeroState: AircraftAeroState = {
                airspeed: this.aircraftState.trueAirspeed,
                altitude: this.aircraftState.altitudeAGL,
                angleOfAttack: this.aircraftState.angleOfAttack,
                sideslipAngle: this.aircraftState.sideslipAngle,
                rollRate: this.aircraftState.rollRate,
                pitchRate: this.aircraftState.pitchRate,
                yawRate: this.aircraftState.yawRate
            };

            // Convert control surface state to aerodynamics interface
            const aeroControls: IAeroControlSurfaces = {
                aileron: controls.aileron,
                elevator: controls.elevator,
                rudder: controls.rudder,
                flaps: controls.flaps,
                spoilers: controls.spoilers,
                gear: controls.gear
            };

            // Calculate aerodynamic forces
            const aeroForces = this.aerodynamics.calculateForces(
                aeroState,
                this.atmosphere,
                aeroControls
            );

            // Apply aerodynamic forces and moments
            this.rigidBody.applyForce(aeroForces.forces);
            this.rigidBody.applyMoment(aeroForces.moments);

            // Update propulsion
            this.propulsion.update(
                dt,
                this.aircraftState.altitude,
                this.aircraftState.trueAirspeed,
                this.atmosphere,
                this.rigidBody.centerOfGravity
            );

            // Apply propulsion forces
            const thrust = this.propulsion.getTotalThrust();
            const thrustMoment = this.propulsion.getTotalMoment();
            this.rigidBody.applyForce(thrust);
            this.rigidBody.applyMoment(thrustMoment);

        } else {
            // GROUND DYNAMICS

            // Simple ground reaction
            if (this.rigidBody.position.y < this.groundLevel) {
                this.rigidBody.position.y = this.groundLevel;
                
                // Stop downward velocity
                if (this.rigidBody.velocity.y < 0) {
                    this.rigidBody.velocity.y = 0;
                }

                // Apply ground friction
                const friction = 0.05;
                this.rigidBody.velocity.x *= (1 - friction);
                this.rigidBody.velocity.z *= (1 - friction);

                // Reduce angular velocities
                this.rigidBody.angularVelocity.multiplyScalar(0.95);
            }

            // Ground steering (simplified)
            if (controls.gear > 0.5) {
                const steeringForce = controls.rudder * 1000;
                this.rigidBody.applyMoment(new Vector3(0, steeringForce, 0));
            }

            // Ground propulsion
            this.propulsion.update(
                dt,
                0,
                this.rigidBody.velocity.length(),
                this.atmosphere,
                this.rigidBody.centerOfGravity
            );

            const thrust = this.propulsion.getTotalThrust();
            this.rigidBody.applyForce(thrust);
        }

        // Update accelerations from forces
        this.rigidBody.updateAccelerations();

        // Integrate motion
        this.rigidBody.integrate(dt);

        // Update aircraft state
        this.updateAircraftState(dt);

        // Handle stall recovery
        if (this.aircraftState.stalled && !wasOnGround) {
            this.handleStall(dt);
        }

        // Update fuel
        const fuelUsed = this.propulsion.getTotalFuelFlow() * dt;
        this.aircraftState.fuelMass = Math.max(0, this.aircraftState.fuelMass - fuelUsed);
        
        // Update mass (simplified - doesn't affect inertia yet)
        this.rigidBody.mass = this.config.mass.empty + this.aircraftState.fuelMass;
        this.rigidBody.inverseMass = 1 / this.rigidBody.mass;
    }

    /**
     * Update aircraft state from rigid body
     */
    private updateAircraftState(dt: number): void {
        // Copy rigid body state
        this.aircraftState.position.copy(this.rigidBody.position);
        this.aircraftState.velocity.copy(this.rigidBody.velocity);
        this.aircraftState.acceleration.copy(this.rigidBody.acceleration);
        this.aircraftState.orientation.copy(this.rigidBody.orientation);
        this.aircraftState.angularVelocity.copy(this.rigidBody.angularVelocity);

        // Update altitude
        this.aircraftState.altitude = this.rigidBody.position.y;
        this.aircraftState.altitudeAGL = this.aircraftState.altitude - this.groundLevel;

        // Update atmospheric properties
        const atmProps = this.atmosphere.getProperties(this.aircraftState.altitude);
        this.aircraftState.temperature = atmProps.temperature;
        this.aircraftState.pressure = atmProps.pressure;
        this.aircraftState.density = atmProps.density;

        // Update wind
        const wind = this.atmosphere.getWind(this.aircraftState.altitude);
        this.aircraftState.windSpeed.set(wind.x, wind.y, wind.z);

        // Update mass properties
        this.aircraftState.mass = this.rigidBody.mass;
        this.aircraftState.centerOfGravity.copy(this.rigidBody.centerOfGravity);

        // Update propulsion state
        this.aircraftState.throttle = this.propulsion.getEngines()[0]?.getThrottle() || 0;
        this.aircraftState.fuelFlow = this.propulsion.getTotalFuelFlow();

        // Calculate load factors
        const bodyAccel = this.rigidBody.worldToBodyForce(this.rigidBody.acceleration);
        this.aircraftState.calculateLoadFactors(bodyAccel);

        // Update derived state
        this.aircraftState.update(dt);
    }

    /**
     * Handle stall dynamics
     * @param dt Time step
     */
    private handleStall(dt: number): void {
        // Add stall-induced moments
        const stallSeverity = Math.max(0, this.aircraftState.angleOfAttack - 0.244) * 10;
        
        // Nose-down pitching moment
        const pitchMoment = -stallSeverity * 1000;
        this.rigidBody.applyMoment(new Vector3(0, pitchMoment, 0));

        // Wing drop (random)
        if (Math.random() < stallSeverity * dt) {
            const rollMoment = (Math.random() - 0.5) * stallSeverity * 500;
            this.rigidBody.applyMoment(new Vector3(rollMoment, 0, 0));
        }

        // Buffeting
        const buffet = (Math.random() - 0.5) * stallSeverity;
        this.rigidBody.applyForce(new Vector3(buffet * 100, buffet * 100, buffet * 100));
    }

    /**
     * Set control inputs
     * @param inputs Control inputs
     */
    public setControls(inputs: ControlInputs): void {
        this.controlSurfaces.setControls(inputs);
    }

    /**
     * Set throttle
     * @param throttle Throttle setting (0-1)
     */
    public setThrottle(throttle: number): void {
        this.propulsion.setThrottle(throttle);
    }

    /**
     * Start engines
     */
    public startEngines(): boolean {
        return this.propulsion.startAllEngines();
    }

    /**
     * Shutdown engines
     */
    public shutdownEngines(): void {
        this.propulsion.shutdownAllEngines();
    }

    /**
     * Reset aircraft to initial state
     * @param position Starting position
     * @param heading Starting heading in radians
     */
    public reset(position?: Vector3, heading?: number): void {
        // Reset rigid body
        this.rigidBody.reset();
        if (position) {
            this.rigidBody.position.copy(position);
        }
        if (heading !== undefined) {
            this.rigidBody.setEulerAngles(0, 0, heading);
        }

        // Reset aircraft state
        this.aircraftState.reset(this.rigidBody.position, heading);

        // Reset control surfaces
        this.controlSurfaces.reset();

        // Reset atmosphere
        this.atmosphere.reset();

        // Set initial fuel
        this.aircraftState.fuelMass = this.config.mass.maxFuel;

        // Reset simulation time
        this.simulationTime = 0;
        this.accumulator = 0;
    }

    /**
     * Get current aircraft state
     */
    public getState(): AircraftState {
        return this.aircraftState;
    }

    /**
     * Get interpolated position for rendering
     * @param alpha Interpolation factor (0-1)
     */
    public getInterpolatedPosition(alpha: number): Vector3 {
        return this.previousPosition.clone().lerp(this.rigidBody.position, alpha);
    }

    /**
     * Get interpolated orientation for rendering
     * @param alpha Interpolation factor (0-1)
     */
    public getInterpolatedOrientation(alpha: number): Quaternion {
        // Note: This is simplified - proper slerp would be better
        return this.rigidBody.orientation.clone();
    }

    /**
     * Set ground level at current position
     * @param groundLevel Ground elevation in meters
     */
    public setGroundLevel(groundLevel: number): void {
        this.groundLevel = groundLevel;
    }

    /**
     * Set weather conditions
     * @param weather Weather parameters
     */
    public setWeather(weather: WeatherConditions): void {
        if (weather.wind) {
            this.atmosphere.setWind(weather.wind.x, weather.wind.y, weather.wind.z);
        }
        if (weather.temperatureOffset !== undefined) {
            this.atmosphere.setWeatherConditions(weather.temperatureOffset, weather.pressureOffset || 0);
        }
    }

    /**
     * Get default aircraft configuration
     */
    private getDefaultConfig(): AircraftConfig {
        return {
            name: "Cessna 172",
            type: "general_aviation",
            mass: {
                empty: 680,      // kg
                maxFuel: 200,    // kg
                maxTakeoff: 1111 // kg
            },
            centerOfGravity: {
                x: 0,
                y: 0,
                z: -0.1
            },
            inertia: {
                ixx: 1285,
                iyy: 1825,
                izz: 2667,
                ixy: 0,
                ixz: 0,
                iyz: 0
            },
            aerodynamics: {
                wingArea: 16.2,
                wingSpan: 11.0,
                meanChord: 1.47,
                oswaldsEfficiency: 0.75
            },
            engines: [{
                type: 'piston',
                position: { x: 2, y: 0, z: 0 },
                orientation: { x: 1, y: 0, z: 0 },
                maxPower: 134000, // 180 HP in Watts
                propDiameter: 1.9,
                maxRPM: 2700
            }],
            controlSurfaces: {
                limits: {
                    aileron: 20,
                    elevator: 25,
                    rudder: 25,
                    flaps: [0, 10, 20, 30]
                }
            }
        };
    }
}

/**
 * Aircraft configuration
 */
export interface AircraftConfig {
    name: string;
    type: string;
    mass: {
        empty: number;
        maxFuel: number;
        maxTakeoff: number;
    };
    centerOfGravity: {
        x: number;
        y: number;
        z: number;
    };
    inertia: {
        ixx: number;
        iyy: number;
        izz: number;
        ixy?: number;
        ixz?: number;
        iyz?: number;
    };
    aerodynamics: {
        wingArea: number;
        wingSpan: number;
        meanChord?: number;
        oswaldsEfficiency?: number;
    };
    engines?: Array<{
        type: 'jet' | 'piston';
        position: { x: number; y: number; z: number };
        orientation: { x: number; y: number; z: number };
        maxThrust?: number;  // For jet
        maxPower?: number;   // For piston
        propDiameter?: number; // For piston
        maxRPM?: number;     // For piston
        bypassRatio?: number; // For jet
        tsfc?: number;       // For jet
    }>;
    controlSurfaces?: {
        limits?: {
            aileron?: number;
            elevator?: number;
            rudder?: number;
            flaps?: number | number[];
        };
        rates?: {
            aileron?: number;
            elevator?: number;
            rudder?: number;
            flaps?: number;
        };
    };
}

/**
 * Weather conditions
 */
export interface WeatherConditions {
    wind?: { x: number; y: number; z: number };
    temperatureOffset?: number; // Kelvin
    pressureOffset?: number;    // Pascals
    turbulence?: number;        // 0-1 intensity
}

// Export all physics modules
export { RigidBody } from './RigidBody';
export { Aerodynamics } from './Aerodynamics';
export { Atmosphere } from './Atmosphere';
export { PropulsionSystem, JetEngine, PistonEngine } from './Propulsion';
export { ControlSurfaceSystem } from './ControlSurfaces';
export { AircraftState } from './AircraftState';