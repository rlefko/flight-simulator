import { Vector3 } from '../core/math/Vector3';
import { Quaternion } from '../core/math/Quaternion';

/**
 * Complete aircraft state management
 * Tracks all state variables for the aircraft
 */
export class AircraftState {
    // Position and orientation
    public position: Vector3;           // World position (m)
    public altitude: number;            // Altitude above sea level (m)
    public altitudeAGL: number;         // Altitude above ground level (m)
    public orientation: Quaternion;     // Aircraft orientation
    public heading: number;             // Magnetic heading (radians)
    public track: number;               // Ground track (radians)

    // Linear motion
    public velocity: Vector3;           // Velocity in world frame (m/s)
    public acceleration: Vector3;       // Acceleration in world frame (m/s²)
    public groundSpeed: number;         // Ground speed (m/s)
    public verticalSpeed: number;       // Vertical speed (m/s)

    // Airspeed measurements
    public trueAirspeed: number;       // TAS (m/s)
    public indicatedAirspeed: number;  // IAS (m/s)
    public calibratedAirspeed: number; // CAS (m/s)
    public machNumber: number;         // Mach number
    public equivalentAirspeed: number; // EAS (m/s)

    // Angular motion
    public angularVelocity: Vector3;   // Angular velocity (rad/s)
    public rollRate: number;           // Roll rate (rad/s)
    public pitchRate: number;          // Pitch rate (rad/s)
    public yawRate: number;            // Yaw rate (rad/s)

    // Attitude
    public pitch: number;              // Pitch angle (radians)
    public roll: number;               // Roll/bank angle (radians)
    public yaw: number;                // Yaw angle (radians)

    // Aerodynamic angles
    public angleOfAttack: number;      // AOA (radians)
    public sideslipAngle: number;      // Sideslip (radians)
    public flightPathAngle: number;    // FPA (radians)

    // Load factors
    public loadFactor: number;         // G-force
    public loadFactorNormal: number;   // Normal G (vertical)
    public loadFactorLateral: number;  // Lateral G
    public loadFactorLongitudinal: number; // Longitudinal G

    // Weight and balance
    public mass: number;               // Current mass (kg)
    public fuelMass: number;           // Fuel mass (kg)
    public centerOfGravity: Vector3;  // CG position
    public momentOfInertia: Vector3;  // Moments of inertia

    // Engine parameters
    public thrust: number;             // Total thrust (N)
    public throttle: number;           // Throttle setting (0-1)
    public fuelFlow: number;           // Fuel flow rate (kg/s)

    // Environmental
    public windSpeed: Vector3;         // Wind velocity (m/s)
    public temperature: number;        // Outside air temp (K)
    public pressure: number;           // Ambient pressure (Pa)
    public density: number;            // Air density (kg/m³)

    // Performance metrics
    public stallSpeed: number;         // Current stall speed (m/s)
    public maxSpeed: number;           // Never exceed speed (m/s)
    public cruiseSpeed: number;        // Cruise speed (m/s)
    public range: number;              // Estimated range (m)
    public endurance: number;          // Estimated endurance (s)

    // Status flags
    public onGround: boolean;          // Aircraft on ground
    public stalled: boolean;           // Stall condition
    public overspeeding: boolean;      // Overspeed condition
    public spinning: boolean;          // Spin condition
    public inverted: boolean;          // Inverted flight

    constructor() {
        // Initialize vectors
        this.position = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0);
        this.acceleration = new Vector3(0, 0, 0);
        this.orientation = new Quaternion(0, 0, 0, 1);
        this.angularVelocity = new Vector3(0, 0, 0);
        this.centerOfGravity = new Vector3(0, 0, 0);
        this.momentOfInertia = new Vector3(1000, 1000, 1000);
        this.windSpeed = new Vector3(0, 0, 0);

        // Initialize scalars
        this.altitude = 0;
        this.altitudeAGL = 0;
        this.heading = 0;
        this.track = 0;
        this.groundSpeed = 0;
        this.verticalSpeed = 0;
        this.trueAirspeed = 0;
        this.indicatedAirspeed = 0;
        this.calibratedAirspeed = 0;
        this.machNumber = 0;
        this.equivalentAirspeed = 0;
        this.rollRate = 0;
        this.pitchRate = 0;
        this.yawRate = 0;
        this.pitch = 0;
        this.roll = 0;
        this.yaw = 0;
        this.angleOfAttack = 0;
        this.sideslipAngle = 0;
        this.flightPathAngle = 0;
        this.loadFactor = 1;
        this.loadFactorNormal = 1;
        this.loadFactorLateral = 0;
        this.loadFactorLongitudinal = 0;
        this.mass = 1000;
        this.fuelMass = 100;
        this.thrust = 0;
        this.throttle = 0;
        this.fuelFlow = 0;
        this.temperature = 288.15;
        this.pressure = 101325;
        this.density = 1.225;
        this.stallSpeed = 25;
        this.maxSpeed = 100;
        this.cruiseSpeed = 50;
        this.range = 1000000;
        this.endurance = 14400;

        // Initialize flags
        this.onGround = true;
        this.stalled = false;
        this.overspeeding = false;
        this.spinning = false;
        this.inverted = false;
    }

    /**
     * Update derived state variables
     * @param dt Time step
     */
    public update(dt: number): void {
        // Update attitude from orientation
        const euler = this.getEulerFromQuaternion(this.orientation);
        this.pitch = euler.pitch;
        this.roll = euler.roll;
        this.yaw = euler.yaw;

        // Update heading and track
        this.heading = this.normalizeAngle(this.yaw);
        const groundVel = new Vector3(this.velocity.x, 0, this.velocity.z);
        if (groundVel.length() > 0.1) {
            this.track = Math.atan2(groundVel.x, groundVel.z);
        }

        // Update angular rates
        this.rollRate = this.angularVelocity.x;
        this.pitchRate = this.angularVelocity.y;
        this.yawRate = this.angularVelocity.z;

        // Update speeds
        this.groundSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        this.verticalSpeed = this.velocity.y;

        // Calculate airspeed vector (velocity relative to air mass)
        const airspeedVector = this.velocity.clone().sub(this.windSpeed);
        this.trueAirspeed = airspeedVector.length();

        // Calculate aerodynamic angles
        if (this.trueAirspeed > 1) {
            // Transform airspeed to body frame
            const bodyAirspeed = this.worldToBody(airspeedVector, this.orientation);
            
            // Angle of attack
            this.angleOfAttack = Math.atan2(-bodyAirspeed.z, bodyAirspeed.x);
            
            // Sideslip angle
            this.sideslipAngle = Math.asin(Math.max(-1, Math.min(1, bodyAirspeed.y / this.trueAirspeed)));
            
            // Flight path angle
            this.flightPathAngle = Math.asin(Math.max(-1, Math.min(1, -this.verticalSpeed / this.groundSpeed)));
        } else {
            this.angleOfAttack = 0;
            this.sideslipAngle = 0;
            this.flightPathAngle = 0;
        }

        // Calculate indicated airspeed (simplified)
        const pressureRatio = this.pressure / 101325;
        const densityRatio = this.density / 1.225;
        this.indicatedAirspeed = this.trueAirspeed * Math.sqrt(densityRatio);
        this.calibratedAirspeed = this.indicatedAirspeed; // Simplified (no position error)
        this.equivalentAirspeed = this.trueAirspeed * Math.sqrt(densityRatio);

        // Calculate Mach number
        const speedOfSound = Math.sqrt(1.4 * 287.058 * this.temperature);
        this.machNumber = this.trueAirspeed / speedOfSound;

        // Update status flags
        this.inverted = Math.abs(this.roll) > Math.PI / 2;
        this.stalled = this.indicatedAirspeed < this.stallSpeed && !this.onGround;
        this.overspeeding = this.indicatedAirspeed > this.maxSpeed;
        
        // Detect spin (simplified)
        this.spinning = this.stalled && Math.abs(this.yawRate) > 0.5;

        // Update performance estimates
        if (this.fuelFlow > 0) {
            this.endurance = this.fuelMass / this.fuelFlow;
            this.range = this.groundSpeed * this.endurance;
        }

        // Update stall speed based on load factor and configuration
        const baseStallSpeed = 25; // Base stall speed in m/s
        this.stallSpeed = baseStallSpeed * Math.sqrt(Math.abs(this.loadFactor));
    }

    /**
     * Convert world coordinates to body frame
     * @param worldVector Vector in world coordinates
     * @param orientation Aircraft orientation
     * @returns Vector in body coordinates
     */
    private worldToBody(worldVector: Vector3, orientation: Quaternion): Vector3 {
        // Create rotation matrix from quaternion
        const q = orientation;
        const x = worldVector.x;
        const y = worldVector.y;
        const z = worldVector.z;

        // Apply inverse rotation (conjugate for quaternion)
        const qConjugate = new Quaternion(-q.x, -q.y, -q.z, q.w);
        
        // Rotate vector using quaternion
        const qVector = new Quaternion(x, y, z, 0);
        const rotated = new Quaternion();
        rotated.multiplyQuaternions(qConjugate, qVector);
        rotated.multiply(q);

        return new Vector3(rotated.x, rotated.y, rotated.z);
    }

    /**
     * Get Euler angles from quaternion
     * @param q Quaternion
     * @returns Euler angles in radians
     */
    private getEulerFromQuaternion(q: Quaternion): { roll: number; pitch: number; yaw: number } {
        const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
        const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);

        const sinp = 2 * (q.w * q.y - q.z * q.x);
        const pitch = Math.abs(sinp) >= 1 
            ? Math.sign(sinp) * Math.PI / 2 
            : Math.asin(sinp);

        const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);

        return { roll, pitch, yaw };
    }

    /**
     * Normalize angle to -PI to PI range
     * @param angle Angle in radians
     * @returns Normalized angle
     */
    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    /**
     * Calculate load factors from accelerations
     * @param bodyAcceleration Acceleration in body frame
     * @param gravity Gravitational acceleration
     */
    public calculateLoadFactors(bodyAcceleration: Vector3, gravity: number = 9.81): void {
        // Load factors are accelerations divided by gravity
        this.loadFactorLongitudinal = bodyAcceleration.x / gravity;
        this.loadFactorLateral = bodyAcceleration.y / gravity;
        this.loadFactorNormal = -bodyAcceleration.z / gravity + 1; // Include gravity

        // Total load factor
        this.loadFactor = Math.sqrt(
            this.loadFactorLongitudinal * this.loadFactorLongitudinal +
            this.loadFactorLateral * this.loadFactorLateral +
            this.loadFactorNormal * this.loadFactorNormal
        );
    }

    /**
     * Reset aircraft to initial state
     * @param position Initial position
     * @param heading Initial heading in radians
     */
    public reset(position?: Vector3, heading?: number): void {
        // Reset position and orientation
        this.position = position || new Vector3(0, 0, 0);
        this.altitude = this.position.y;
        this.altitudeAGL = this.altitude;
        
        const hdg = heading || 0;
        this.orientation.setFromEuler(0, 0, hdg, 'YXZ');
        this.heading = hdg;

        // Reset velocities
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);

        // Reset all derived values
        this.groundSpeed = 0;
        this.verticalSpeed = 0;
        this.trueAirspeed = 0;
        this.indicatedAirspeed = 0;
        this.rollRate = 0;
        this.pitchRate = 0;
        this.yawRate = 0;
        this.pitch = 0;
        this.roll = 0;
        this.yaw = hdg;
        this.angleOfAttack = 0;
        this.sideslipAngle = 0;
        this.flightPathAngle = 0;
        this.loadFactor = 1;
        this.loadFactorNormal = 1;
        this.loadFactorLateral = 0;
        this.loadFactorLongitudinal = 0;

        // Reset status
        this.onGround = true;
        this.stalled = false;
        this.overspeeding = false;
        this.spinning = false;
        this.inverted = false;
    }

    /**
     * Get state summary for display/telemetry
     */
    public getSummary(): AircraftStateSummary {
        return {
            position: {
                lat: 0, // Would need conversion from world coordinates
                lon: 0,
                alt: this.altitude
            },
            attitude: {
                pitch: this.pitch * 180 / Math.PI,
                roll: this.roll * 180 / Math.PI,
                heading: this.heading * 180 / Math.PI
            },
            speeds: {
                indicated: this.indicatedAirspeed,
                true: this.trueAirspeed,
                ground: this.groundSpeed,
                vertical: this.verticalSpeed,
                mach: this.machNumber
            },
            angles: {
                aoa: this.angleOfAttack * 180 / Math.PI,
                sideslip: this.sideslipAngle * 180 / Math.PI,
                fpa: this.flightPathAngle * 180 / Math.PI
            },
            loads: {
                g: this.loadFactor,
                normal: this.loadFactorNormal,
                lateral: this.loadFactorLateral,
                longitudinal: this.loadFactorLongitudinal
            },
            status: {
                onGround: this.onGround,
                stalled: this.stalled,
                overspeeding: this.overspeeding,
                spinning: this.spinning,
                inverted: this.inverted
            }
        };
    }
}

/**
 * Aircraft state summary for telemetry
 */
export interface AircraftStateSummary {
    position: {
        lat: number;
        lon: number;
        alt: number;
    };
    attitude: {
        pitch: number;  // degrees
        roll: number;   // degrees
        heading: number; // degrees
    };
    speeds: {
        indicated: number;  // m/s
        true: number;       // m/s
        ground: number;     // m/s
        vertical: number;   // m/s
        mach: number;
    };
    angles: {
        aoa: number;       // degrees
        sideslip: number;  // degrees
        fpa: number;       // degrees
    };
    loads: {
        g: number;
        normal: number;
        lateral: number;
        longitudinal: number;
    };
    status: {
        onGround: boolean;
        stalled: boolean;
        overspeeding: boolean;
        spinning: boolean;
        inverted: boolean;
    };
}