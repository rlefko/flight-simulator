/**
 * Control Surface Management System
 * Handles control surface positions, rates, and limits
 */
export class ControlSurfaceSystem {
    // Control surface positions (normalized)
    private aileron: number = 0;       // -1 to 1
    private elevator: number = 0;      // -1 to 1
    private rudder: number = 0;        // -1 to 1
    private flaps: number = 0;         // 0 to 1
    private spoilers: number = 0;      // 0 to 1
    private gear: number = 1;          // 0 (up) or 1 (down)
    private speedBrake: number = 0;    // 0 to 1

    // Trim settings
    private elevatorTrim: number = 0;  // -1 to 1
    private aileronTrim: number = 0;   // -1 to 1
    private rudderTrim: number = 0;    // -1 to 1

    // Control surface limits (degrees)
    private limits = {
        aileron: 25,      // ±25 degrees
        elevator: 30,     // ±30 degrees
        rudder: 30,       // ±30 degrees
        flaps: [0, 10, 20, 30, 40], // Flap positions in degrees
        spoilers: 60,     // 60 degrees max
        speedBrake: 45    // 45 degrees max
    };

    // Control surface rates (degrees per second)
    private rates = {
        aileron: 80,      // Fast response
        elevator: 60,     // Medium response
        rudder: 50,       // Slower response
        flaps: 5,         // Slow deployment
        spoilers: 30,     // Medium deployment
        gear: 0.167,      // 6 seconds for full cycle
        speedBrake: 20    // Medium deployment
    };

    // Target positions for smooth movement
    private targets = {
        aileron: 0,
        elevator: 0,
        rudder: 0,
        flaps: 0,
        spoilers: 0,
        gear: 1,
        speedBrake: 0
    };

    // Control effectiveness factors (varies with airspeed)
    private effectiveness = {
        aileron: 1.0,
        elevator: 1.0,
        rudder: 1.0
    };

    // Failure states
    private failures = {
        aileron: false,
        elevator: false,
        rudder: false,
        flaps: false,
        spoilers: false,
        gear: false,
        hydraulics: false
    };

    constructor(config?: ControlSurfaceConfig) {
        if (config) {
            if (config.limits) Object.assign(this.limits, config.limits);
            if (config.rates) Object.assign(this.rates, config.rates);
            if (config.initialGearPosition !== undefined) {
                this.gear = config.initialGearPosition;
                this.targets.gear = config.initialGearPosition;
            }
        }
    }

    /**
     * Update control surface positions based on targets and time
     * @param dt Delta time in seconds
     */
    public update(dt: number): void {
        // Update primary flight controls (instant response with rate limiting)
        this.aileron = this.updateControl(
            this.aileron,
            this.targets.aileron + this.aileronTrim,
            this.rates.aileron,
            dt,
            this.failures.aileron || this.failures.hydraulics
        );

        this.elevator = this.updateControl(
            this.elevator,
            this.targets.elevator + this.elevatorTrim,
            this.rates.elevator,
            dt,
            this.failures.elevator || this.failures.hydraulics
        );

        this.rudder = this.updateControl(
            this.rudder,
            this.targets.rudder + this.rudderTrim,
            this.rates.rudder,
            dt,
            this.failures.rudder
        );

        // Update secondary controls (slower response)
        this.flaps = this.updateControl(
            this.flaps,
            this.targets.flaps,
            this.rates.flaps / 40, // Convert to normalized rate
            dt,
            this.failures.flaps || this.failures.hydraulics
        );

        this.spoilers = this.updateControl(
            this.spoilers,
            this.targets.spoilers,
            this.rates.spoilers / 60,
            dt,
            this.failures.spoilers || this.failures.hydraulics
        );

        this.speedBrake = this.updateControl(
            this.speedBrake,
            this.targets.speedBrake,
            this.rates.speedBrake / 45,
            dt,
            this.failures.hydraulics
        );

        // Landing gear (discrete positions)
        if (!this.failures.gear && !this.failures.hydraulics) {
            const gearDiff = this.targets.gear - this.gear;
            if (Math.abs(gearDiff) > 0.01) {
                const gearRate = this.rates.gear * dt;
                if (gearDiff > 0) {
                    this.gear = Math.min(1, this.gear + gearRate);
                } else {
                    this.gear = Math.max(0, this.gear - gearRate);
                }
            }
        }
    }

    /**
     * Update a control surface position with rate limiting
     * @param current Current position
     * @param target Target position
     * @param rate Maximum rate (normalized per second)
     * @param dt Delta time
     * @param failed Whether the control is failed
     * @returns New position
     */
    private updateControl(
        current: number,
        target: number,
        rate: number,
        dt: number,
        failed: boolean
    ): number {
        if (failed) return current; // No movement if failed

        // Clamp target
        target = Math.max(-1, Math.min(1, target));

        const diff = target - current;
        const maxChange = rate * dt;

        if (Math.abs(diff) <= maxChange) {
            return target;
        } else {
            return current + Math.sign(diff) * maxChange;
        }
    }

    /**
     * Set control inputs (from pilot or autopilot)
     * @param controls Control input object
     */
    public setControls(controls: ControlInputs): void {
        if (controls.aileron !== undefined) this.targets.aileron = controls.aileron;
        if (controls.elevator !== undefined) this.targets.elevator = controls.elevator;
        if (controls.rudder !== undefined) this.targets.rudder = controls.rudder;
        if (controls.flaps !== undefined) this.setFlaps(controls.flaps);
        if (controls.spoilers !== undefined) this.targets.spoilers = controls.spoilers;
        if (controls.gear !== undefined) this.targets.gear = controls.gear;
        if (controls.speedBrake !== undefined) this.targets.speedBrake = controls.speedBrake;
    }

    /**
     * Set flap position (handles discrete positions)
     * @param position Desired flap position (0-1 or specific detent)
     */
    public setFlaps(position: number): void {
        if (typeof this.limits.flaps === 'number') {
            this.targets.flaps = Math.max(0, Math.min(1, position));
        } else {
            // Map to nearest flap detent
            const positions = this.limits.flaps;
            const maxFlaps = positions[positions.length - 1];
            const targetDegrees = position * maxFlaps;
            
            let closest = 0;
            let minDiff = Math.abs(targetDegrees);
            
            for (let i = 0; i < positions.length; i++) {
                const diff = Math.abs(targetDegrees - positions[i]);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = positions[i] / maxFlaps;
                }
            }
            
            this.targets.flaps = closest;
        }
    }

    /**
     * Set trim values
     * @param trim Trim settings
     */
    public setTrim(trim: TrimSettings): void {
        if (trim.elevator !== undefined) {
            this.elevatorTrim = Math.max(-1, Math.min(1, trim.elevator));
        }
        if (trim.aileron !== undefined) {
            this.aileronTrim = Math.max(-1, Math.min(1, trim.aileron));
        }
        if (trim.rudder !== undefined) {
            this.rudderTrim = Math.max(-1, Math.min(1, trim.rudder));
        }
    }

    /**
     * Update control effectiveness based on airspeed
     * @param airspeed Current airspeed (m/s)
     * @param stallSpeed Stall speed (m/s)
     */
    public updateEffectiveness(airspeed: number, stallSpeed: number): void {
        // Control effectiveness reduces at low speeds
        const minSpeed = stallSpeed * 0.5;
        const normalSpeed = stallSpeed * 2;
        
        if (airspeed < minSpeed) {
            // Very low effectiveness
            this.effectiveness.aileron = 0.1;
            this.effectiveness.elevator = 0.1;
            this.effectiveness.rudder = 0.2; // Rudder remains somewhat effective
        } else if (airspeed < normalSpeed) {
            // Reduced effectiveness
            const factor = (airspeed - minSpeed) / (normalSpeed - minSpeed);
            this.effectiveness.aileron = 0.1 + 0.9 * factor;
            this.effectiveness.elevator = 0.1 + 0.9 * factor;
            this.effectiveness.rudder = 0.2 + 0.8 * factor;
        } else {
            // Full effectiveness (can reduce at very high speeds for realism)
            this.effectiveness.aileron = 1.0;
            this.effectiveness.elevator = 1.0;
            this.effectiveness.rudder = 1.0;
            
            // Reduce effectiveness at high Mach numbers
            const mach = airspeed / 340; // Approximate
            if (mach > 0.8) {
                const machFactor = Math.max(0.5, 1.5 - mach);
                this.effectiveness.aileron *= machFactor;
                this.effectiveness.elevator *= machFactor;
            }
        }
    }

    /**
     * Get current control surface positions
     * @returns Control surface state
     */
    public getState(): ControlSurfaceState {
        return {
            aileron: this.aileron * this.effectiveness.aileron,
            elevator: this.elevator * this.effectiveness.elevator,
            rudder: this.rudder * this.effectiveness.rudder,
            flaps: this.flaps,
            spoilers: this.spoilers,
            gear: this.gear,
            speedBrake: this.speedBrake,
            elevatorTrim: this.elevatorTrim,
            aileronTrim: this.aileronTrim,
            rudderTrim: this.rudderTrim
        };
    }

    /**
     * Get control surface angles in degrees
     * @returns Control surface angles
     */
    public getAngles(): ControlSurfaceAngles {
        const flapsAngle = typeof this.limits.flaps === 'number' 
            ? this.flaps * this.limits.flaps
            : this.flaps * this.limits.flaps[this.limits.flaps.length - 1];

        return {
            aileron: this.aileron * this.limits.aileron,
            elevator: this.elevator * this.limits.elevator,
            rudder: this.rudder * this.limits.rudder,
            flaps: flapsAngle,
            spoilers: this.spoilers * this.limits.spoilers,
            speedBrake: this.speedBrake * this.limits.speedBrake
        };
    }

    /**
     * Simulate control surface failure
     * @param surface Surface to fail
     * @param failed Failure state
     */
    public setFailure(surface: keyof typeof this.failures, failed: boolean): void {
        this.failures[surface] = failed;
    }

    /**
     * Reset all controls to neutral
     */
    public reset(): void {
        this.aileron = 0;
        this.elevator = 0;
        this.rudder = 0;
        this.flaps = 0;
        this.spoilers = 0;
        this.gear = 1;
        this.speedBrake = 0;
        
        this.targets = {
            aileron: 0,
            elevator: 0,
            rudder: 0,
            flaps: 0,
            spoilers: 0,
            gear: 1,
            speedBrake: 0
        };
        
        this.elevatorTrim = 0;
        this.aileronTrim = 0;
        this.rudderTrim = 0;
        
        // Reset failures
        for (const key in this.failures) {
            this.failures[key as keyof typeof this.failures] = false;
        }
    }

    /**
     * Check if landing gear is fully extended
     */
    public isGearDown(): boolean {
        return this.gear >= 0.99;
    }

    /**
     * Check if landing gear is fully retracted
     */
    public isGearUp(): boolean {
        return this.gear <= 0.01;
    }

    /**
     * Check if landing gear is in transit
     */
    public isGearInTransit(): boolean {
        return this.gear > 0.01 && this.gear < 0.99;
    }
}

/**
 * Control surface configuration
 */
export interface ControlSurfaceConfig {
    limits?: Partial<{
        aileron: number;
        elevator: number;
        rudder: number;
        flaps: number | number[];
        spoilers: number;
        speedBrake: number;
    }>;
    rates?: Partial<{
        aileron: number;
        elevator: number;
        rudder: number;
        flaps: number;
        spoilers: number;
        gear: number;
        speedBrake: number;
    }>;
    initialGearPosition?: number;
}

/**
 * Control inputs from pilot or autopilot
 */
export interface ControlInputs {
    aileron?: number;     // -1 to 1
    elevator?: number;    // -1 to 1
    rudder?: number;      // -1 to 1
    flaps?: number;       // 0 to 1
    spoilers?: number;    // 0 to 1
    gear?: number;        // 0 or 1
    speedBrake?: number;  // 0 to 1
}

/**
 * Trim settings
 */
export interface TrimSettings {
    elevator?: number;    // -1 to 1
    aileron?: number;     // -1 to 1
    rudder?: number;      // -1 to 1
}

/**
 * Control surface state (with effectiveness applied)
 */
export interface ControlSurfaceState {
    aileron: number;
    elevator: number;
    rudder: number;
    flaps: number;
    spoilers: number;
    gear: number;
    speedBrake: number;
    elevatorTrim: number;
    aileronTrim: number;
    rudderTrim: number;
}

/**
 * Control surface angles in degrees
 */
export interface ControlSurfaceAngles {
    aileron: number;
    elevator: number;
    rudder: number;
    flaps: number;
    spoilers: number;
    speedBrake: number;
}