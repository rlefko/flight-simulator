export interface ForceFeedbackDevice {
    vibrate(intensity: number, duration: number): void;
    setConstantForce(force: number): void;
    playCondition(type: 'spring' | 'damper' | 'friction', strength: number): void;
}

export class ForceFeedbackManager {
    private devices: Map<string, ForceFeedbackDevice> = new Map();
    private gamepadRumbleSupport = new Map<number, boolean>();

    public detectDevices(): void {
        // Gamepad rumble detection
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;

            // Check if gamepad supports vibration
            if ('vibrationActuator' in gamepad) {
                this.gamepadRumbleSupport.set(gamepad.index, true);
            }
        }
    }

    public registerDevice(id: string, device: ForceFeedbackDevice): void {
        this.devices.set(id, device);
    }

    public simulateAerodynamicLoads(
        velocity: number, 
        angleOfAttack: number, 
        stall: boolean = false
    ): void {
        const intensity = this.calculateIntensity(velocity, angleOfAttack, stall);
        this.applyForceFeedback(intensity);
    }

    public simulateTurbulence(
        turbulenceIntensity: number, 
        frequency: number
    ): void {
        const devices = Array.from(this.devices.values());
        const gamepads = navigator.getGamepads();

        // Apply turbulence effect to all supported devices
        devices.forEach(device => {
            // Complex turbulence simulation 
            device.playCondition('spring', turbulenceIntensity);
        });

        // Basic gamepad rumble
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad || !this.gamepadRumbleSupport.get(gamepad.index)) continue;

            // Map turbulence to rumble
            const rumbleIntensity = Math.min(1, turbulenceIntensity * 0.5);
            gamepad.vibrationActuator?.playEffect('dual-rumble', {
                startDelay: 0,
                duration: 100, // ms
                weakMagnitude: rumbleIntensity,
                strongMagnitude: rumbleIntensity
            });
        }
    }

    public simulateGroundEffect(
        groundProximity: number, 
        groundSpeed: number
    ): void {
        const devices = Array.from(this.devices.values());
        
        // Simulate ground rumble based on proximity and speed
        const rumbleIntensity = this.calculateGroundRumble(groundProximity, groundSpeed);
        
        devices.forEach(device => {
            device.playCondition('friction', rumbleIntensity);
        });
    }

    private calculateIntensity(
        velocity: number, 
        angleOfAttack: number, 
        stall: boolean
    ): number {
        // Crude approximation of force feedback intensity
        const velocityFactor = velocity / 100; // Normalize velocity
        const aoaFactor = Math.abs(angleOfAttack) / 30; // Normalize AoA
        
        let intensity = velocityFactor * aoaFactor;
        
        // Increase intensity during stall
        if (stall) {
            intensity *= 1.5;
        }
        
        return Math.min(1, intensity);
    }

    private calculateGroundRumble(
        groundProximity: number, 
        groundSpeed: number
    ): number {
        // Inverse relationship with ground proximity
        const proximityFactor = 1 - Math.min(1, groundProximity / 10);
        const speedFactor = groundSpeed / 50; // Normalize ground speed
        
        return Math.min(1, proximityFactor * speedFactor);
    }

    private applyForceFeedback(intensity: number): void {
        const devices = Array.from(this.devices.values());
        const gamepads = navigator.getGamepads();

        // Apply to registered devices
        devices.forEach(device => {
            device.setConstantForce(intensity);
        });

        // Basic gamepad rumble
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad || !this.gamepadRumbleSupport.get(gamepad.index)) continue;

            gamepad.vibrationActuator?.playEffect('dual-rumble', {
                startDelay: 0,
                duration: 50, // ms
                weakMagnitude: intensity,
                strongMagnitude: intensity
            });
        }
    }
}