import { Vector3 } from '../core/math/Vector3';
import { Atmosphere } from './Atmosphere';

/**
 * Aerodynamic force and moment calculations
 * Implements lift, drag, and moment calculations based on coefficients
 */
export class Aerodynamics {
    // Aircraft configuration
    private wingArea: number;           // m²
    private wingSpan: number;           // m
    private meanChord: number;          // m
    private aspectRatio: number;        // dimensionless
    private oswaldsEfficiency: number; // dimensionless (typically 0.7-0.85)

    // Aerodynamic coefficients (will be loaded from aircraft data)
    private cl0: number = 0.1;          // Zero-lift coefficient
    private clAlpha: number = 5.7;      // Lift curve slope (per radian)
    private clMax: number = 1.4;        // Maximum lift coefficient
    private clMin: number = -1.0;       // Minimum lift coefficient
    private cd0: number = 0.02;         // Parasitic drag coefficient
    private cdAlpha2: number = 0.5;     // Drag polar coefficient
    private cmAlpha: number = -0.5;     // Pitching moment slope
    private cm0: number = 0.05;         // Zero-lift pitching moment

    // Control surface effectiveness
    private clDeltaFlap: number = 0.5;    // Flap lift increment
    private cdDeltaFlap: number = 0.05;   // Flap drag increment
    private clDeltaElevator: number = 0.3; // Elevator effectiveness
    private cyDeltaRudder: number = 0.3;   // Rudder effectiveness
    private clDeltaAileron: number = 0.2;  // Aileron effectiveness

    // Stall characteristics
    private alphaStall: number = 0.244;    // Stall angle (radians) ~14 degrees
    private stallTransition: number = 0.1;  // Transition region (radians)

    // Ground effect parameters
    private groundEffectHeight: number = 10; // Height for noticeable ground effect (m)
    private groundEffectFactor: number = 0.3; // Maximum reduction in induced drag

    constructor(config?: AerodynamicConfig) {
        if (config) {
            this.wingArea = config.wingArea;
            this.wingSpan = config.wingSpan;
            this.meanChord = config.meanChord || config.wingArea / config.wingSpan;
            this.aspectRatio = config.wingSpan * config.wingSpan / config.wingArea;
            this.oswaldsEfficiency = config.oswaldsEfficiency || 0.8;

            // Load coefficient data if provided
            if (config.coefficients) {
                Object.assign(this, config.coefficients);
            }
        } else {
            // Default values for a typical GA aircraft
            this.wingArea = 16.2;  // m²
            this.wingSpan = 11.0;  // m
            this.meanChord = 1.47; // m
            this.aspectRatio = 7.46;
            this.oswaldsEfficiency = 0.8;
        }
    }

    /**
     * Calculate aerodynamic forces and moments
     * @param state Current aircraft state
     * @param atmosphere Atmospheric conditions
     * @param controls Control surface deflections
     * @returns Aerodynamic forces and moments in body coordinates
     */
    public calculateForces(
        state: AircraftAeroState,
        atmosphere: Atmosphere,
        controls: ControlSurfaces
    ): AerodynamicForces {
        // Get atmospheric properties
        const atmProps = atmosphere.getProperties(state.altitude);
        const dynamicPressure = 0.5 * atmProps.density * state.airspeed * state.airspeed;

        // Calculate angle of attack and sideslip
        const alpha = state.angleOfAttack;
        const beta = state.sideslipAngle;

        // Calculate lift coefficient
        let cl = this.calculateLiftCoefficient(alpha, controls);

        // Apply ground effect
        const groundEffectMultiplier = this.calculateGroundEffect(state.altitude);
        
        // Calculate drag coefficient
        let cd = this.calculateDragCoefficient(alpha, cl, controls, groundEffectMultiplier);

        // Calculate side force coefficient
        const cy = this.calculateSideForceCoefficient(beta, controls);

        // Calculate moment coefficients
        const cm = this.calculatePitchingMoment(alpha, controls, state);
        const cll = this.calculateRollingMoment(beta, controls, state);
        const cn = this.calculateYawingMoment(beta, controls, state);

        // Calculate forces
        const lift = dynamicPressure * this.wingArea * cl;
        const drag = dynamicPressure * this.wingArea * cd;
        const sideForce = dynamicPressure * this.wingArea * cy;

        // Calculate moments
        const pitchingMoment = dynamicPressure * this.wingArea * this.meanChord * cm;
        const rollingMoment = dynamicPressure * this.wingArea * this.wingSpan * cll;
        const yawingMoment = dynamicPressure * this.wingArea * this.wingSpan * cn;

        // Convert to body frame forces
        // In stability frame: X = -Drag, Y = SideForce, Z = -Lift
        const cosAlpha = Math.cos(alpha);
        const sinAlpha = Math.sin(alpha);
        const cosBeta = Math.cos(beta);
        const sinBeta = Math.sin(beta);

        const forces = new Vector3(
            -drag * cosAlpha * cosBeta - sideForce * sinBeta + lift * sinAlpha * cosBeta,
            -drag * cosAlpha * sinBeta + sideForce * cosBeta + lift * sinAlpha * sinBeta,
            drag * sinAlpha - lift * cosAlpha
        );

        const moments = new Vector3(
            rollingMoment,
            pitchingMoment,
            yawingMoment
        );

        return {
            forces,
            moments,
            lift,
            drag,
            sideForce,
            coefficients: { cl, cd, cy, cm, cll, cn }
        };
    }

    /**
     * Calculate lift coefficient including stall effects
     * @param alpha Angle of attack in radians
     * @param controls Control surface positions
     * @returns Lift coefficient
     */
    private calculateLiftCoefficient(alpha: number, controls: ControlSurfaces): number {
        // Base lift coefficient
        let cl = this.cl0 + this.clAlpha * alpha;

        // Add control surface contributions
        cl += this.clDeltaFlap * controls.flaps;
        cl += this.clDeltaElevator * controls.elevator * 0.3; // Elevator contribution

        // Apply stall model
        cl = this.applyStallModel(cl, alpha);

        return cl;
    }

    /**
     * Apply stall characteristics to lift coefficient
     * @param cl Linear lift coefficient
     * @param alpha Angle of attack
     * @returns Modified lift coefficient
     */
    private applyStallModel(cl: number, alpha: number): number {
        const absAlpha = Math.abs(alpha);
        
        if (absAlpha < this.alphaStall) {
            // Pre-stall: linear region
            return cl;
        } else if (absAlpha < this.alphaStall + this.stallTransition) {
            // Stall transition: smooth blend
            const factor = (absAlpha - this.alphaStall) / this.stallTransition;
            const stallCl = this.clMax * Math.sign(alpha) * (1 - 0.5 * factor);
            return cl * (1 - factor) + stallCl * factor;
        } else {
            // Post-stall: reduced lift
            const postStallFactor = Math.exp(-2 * (absAlpha - this.alphaStall - this.stallTransition));
            return this.clMax * Math.sign(alpha) * (0.5 + 0.5 * postStallFactor);
        }
    }

    /**
     * Calculate drag coefficient
     * @param alpha Angle of attack
     * @param cl Lift coefficient
     * @param controls Control surface positions
     * @param groundEffect Ground effect multiplier
     * @returns Drag coefficient
     */
    private calculateDragCoefficient(
        alpha: number, 
        cl: number, 
        controls: ControlSurfaces,
        groundEffect: number
    ): number {
        // Parasitic drag
        let cd = this.cd0;

        // Induced drag (reduced by ground effect)
        const inducedDrag = (cl * cl) / (Math.PI * this.aspectRatio * this.oswaldsEfficiency);
        cd += inducedDrag * groundEffect;

        // Alpha-dependent drag
        cd += this.cdAlpha2 * alpha * alpha;

        // Control surface drag
        cd += this.cdDeltaFlap * controls.flaps;
        cd += 0.01 * Math.abs(controls.elevator); // Elevator drag
        cd += 0.005 * Math.abs(controls.aileron); // Aileron drag
        cd += 0.02 * controls.spoilers; // Spoiler drag

        // Landing gear drag
        cd += controls.gear * 0.02;

        return cd;
    }

    /**
     * Calculate side force coefficient
     * @param beta Sideslip angle
     * @param controls Control surface positions
     * @returns Side force coefficient
     */
    private calculateSideForceCoefficient(beta: number, controls: ControlSurfaces): number {
        // Basic side force from sideslip
        let cy = -0.5 * beta; // Typical value

        // Rudder contribution
        cy += this.cyDeltaRudder * controls.rudder;

        return cy;
    }

    /**
     * Calculate pitching moment coefficient
     * @param alpha Angle of attack
     * @param controls Control surface positions
     * @param state Aircraft state
     * @returns Pitching moment coefficient
     */
    private calculatePitchingMoment(
        alpha: number, 
        controls: ControlSurfaces,
        state: AircraftAeroState
    ): number {
        // Static moment
        let cm = this.cm0 + this.cmAlpha * alpha;

        // Elevator contribution
        cm += -0.8 * controls.elevator; // Typical elevator effectiveness

        // Pitch damping
        const qBar = state.pitchRate * this.meanChord / (2 * state.airspeed);
        cm += -5.0 * qBar; // Typical pitch damping

        // Flap contribution
        cm += -0.2 * controls.flaps;

        return cm;
    }

    /**
     * Calculate rolling moment coefficient
     * @param beta Sideslip angle
     * @param controls Control surface positions
     * @param state Aircraft state
     * @returns Rolling moment coefficient
     */
    private calculateRollingMoment(
        beta: number,
        controls: ControlSurfaces,
        state: AircraftAeroState
    ): number {
        // Dihedral effect
        let cll = -0.1 * beta;

        // Aileron contribution
        cll += this.clDeltaAileron * controls.aileron;

        // Roll damping
        const pBar = state.rollRate * this.wingSpan / (2 * state.airspeed);
        cll += -0.4 * pBar;

        // Yaw-roll coupling (adverse yaw)
        const rBar = state.yawRate * this.wingSpan / (2 * state.airspeed);
        cll += 0.15 * rBar;

        return cll;
    }

    /**
     * Calculate yawing moment coefficient
     * @param beta Sideslip angle
     * @param controls Control surface positions
     * @param state Aircraft state
     * @returns Yawing moment coefficient
     */
    private calculateYawingMoment(
        beta: number,
        controls: ControlSurfaces,
        state: AircraftAeroState
    ): number {
        // Weathercock stability
        let cn = 0.1 * beta;

        // Rudder contribution
        cn += -0.15 * controls.rudder;

        // Yaw damping
        const rBar = state.yawRate * this.wingSpan / (2 * state.airspeed);
        cn += -0.3 * rBar;

        // Aileron adverse yaw
        cn += -0.01 * controls.aileron;

        return cn;
    }

    /**
     * Calculate ground effect multiplier for induced drag
     * @param altitude Height above ground in meters
     * @returns Multiplier for induced drag (1.0 = no effect, < 1.0 = reduced drag)
     */
    private calculateGroundEffect(altitude: number): number {
        if (altitude > this.groundEffectHeight) {
            return 1.0;
        }

        // Exponential decay of ground effect with altitude
        const heightRatio = altitude / this.wingSpan;
        const effectStrength = Math.exp(-4 * heightRatio);
        
        return 1.0 - this.groundEffectFactor * effectStrength;
    }

    /**
     * Update aerodynamic configuration
     * @param config New configuration
     */
    public updateConfiguration(config: Partial<AerodynamicConfig>): void {
        if (config.wingArea !== undefined) this.wingArea = config.wingArea;
        if (config.wingSpan !== undefined) this.wingSpan = config.wingSpan;
        if (config.meanChord !== undefined) this.meanChord = config.meanChord;
        if (config.oswaldsEfficiency !== undefined) this.oswaldsEfficiency = config.oswaldsEfficiency;
        
        // Recalculate derived values
        if (config.wingArea || config.wingSpan) {
            this.aspectRatio = this.wingSpan * this.wingSpan / this.wingArea;
            if (!config.meanChord) {
                this.meanChord = this.wingArea / this.wingSpan;
            }
        }

        if (config.coefficients) {
            Object.assign(this, config.coefficients);
        }
    }
}

/**
 * Aircraft aerodynamic state
 */
export interface AircraftAeroState {
    airspeed: number;        // m/s
    altitude: number;        // m above ground
    angleOfAttack: number;   // radians
    sideslipAngle: number;   // radians
    rollRate: number;        // rad/s
    pitchRate: number;       // rad/s
    yawRate: number;         // rad/s
}

/**
 * Control surface positions (normalized -1 to 1 except where noted)
 */
export interface ControlSurfaces {
    aileron: number;    // -1 (left) to 1 (right)
    elevator: number;   // -1 (down) to 1 (up)
    rudder: number;     // -1 (left) to 1 (right)
    flaps: number;      // 0 to 1 (retracted to fully deployed)
    spoilers: number;   // 0 to 1 (retracted to fully deployed)
    gear: number;       // 0 (up) or 1 (down)
}

/**
 * Aerodynamic forces and moments
 */
export interface AerodynamicForces {
    forces: Vector3;     // Force vector in body frame (N)
    moments: Vector3;    // Moment vector in body frame (N·m)
    lift: number;       // Lift magnitude (N)
    drag: number;       // Drag magnitude (N)
    sideForce: number;  // Side force magnitude (N)
    coefficients: {
        cl: number;     // Lift coefficient
        cd: number;     // Drag coefficient
        cy: number;     // Side force coefficient
        cm: number;     // Pitching moment coefficient
        cll: number;    // Rolling moment coefficient
        cn: number;     // Yawing moment coefficient
    };
}

/**
 * Aerodynamic configuration
 */
export interface AerodynamicConfig {
    wingArea: number;
    wingSpan: number;
    meanChord?: number;
    oswaldsEfficiency?: number;
    coefficients?: Partial<{
        cl0: number;
        clAlpha: number;
        clMax: number;
        clMin: number;
        cd0: number;
        cdAlpha2: number;
        cmAlpha: number;
        cm0: number;
        alphaStall: number;
    }>;
}