import { InputManager, InputState } from './InputManager';
import { EventBus } from '../core/events/EventBus';

export enum ControlAxis {
    PITCH,
    ROLL,
    YAW,
    THROTTLE,
    RUDDER,
    BRAKE_LEFT,
    BRAKE_RIGHT,
    FLAPS,
    GEAR
}

export interface ControlProfile {
    name: string;
    description: string;
    mappings: Map<ControlAxis, InputMapping>;
}

export interface InputMapping {
    type: 'axis' | 'button' | 'key';
    source: string;
    sensitivity?: number;
    invert?: boolean;
    deadzone?: number;
}

export class ControlMapper {
    private inputManager: InputManager;
    private eventBus: EventBus;
    private profiles: Map<string, ControlProfile> = new Map();
    private activeProfile: string | null = null;

    constructor(inputManager: InputManager, eventBus: EventBus) {
        this.inputManager = inputManager;
        this.eventBus = eventBus;
    }

    public registerProfile(profile: ControlProfile): void {
        this.profiles.set(profile.name, profile);
    }

    public setActiveProfile(profileName: string): boolean {
        if (!this.profiles.has(profileName)) {
            console.error(`Control profile '${profileName}' not found`);
            return false;
        }
        
        this.activeProfile = profileName;
        return true;
    }

    public processInput(): Map<ControlAxis, number> {
        if (!this.activeProfile) {
            console.warn('No active control profile');
            return new Map();
        }

        const profile = this.profiles.get(this.activeProfile)!;
        const inputState = this.inputManager.getInputState();
        const controlValues = new Map<ControlAxis, number>();

        for (const [axis, mapping] of profile.mappings) {
            const value = this.mapInput(mapping, inputState);
            controlValues.set(axis, value);
        }

        return controlValues;
    }

    private mapInput(mapping: InputMapping, inputState: InputState): number {
        let rawValue = 0;

        switch (mapping.type) {
            case 'key':
                rawValue = inputState.keys.has(mapping.source) ? 1 : 0;
                break;
            case 'button':
                rawValue = inputState.gamepadButtons.get(parseInt(mapping.source)) || 0;
                break;
            case 'axis':
                const axisValue = inputState.gamepadAxes.get(parseInt(mapping.source)) || 0;
                rawValue = this.applyAxisProcessing(axisValue, mapping);
                break;
        }

        return rawValue;
    }

    private applyAxisProcessing(value: number, mapping: InputMapping): number {
        // Apply inversion
        let processedValue = mapping.invert ? -value : value;

        // Apply deadzone
        const deadzone = mapping.deadzone || 0.1;
        if (Math.abs(processedValue) < deadzone) {
            processedValue = 0;
        }

        // Apply sensitivity/scaling
        const sensitivity = mapping.sensitivity || 1;
        processedValue *= sensitivity;

        // Clamp to [-1, 1]
        return Math.max(-1, Math.min(1, processedValue));
    }

    public createDefaultProfiles(): void {
        // Arcade profile - more forgiving, easier control
        const arcadeProfile: ControlProfile = {
            name: 'arcade',
            description: 'Simplified, more responsive controls',
            mappings: new Map([
                [ControlAxis.PITCH, { type: 'axis', source: '1', sensitivity: 1.5, deadzone: 0.2 }],
                [ControlAxis.ROLL, { type: 'axis', source: '0', sensitivity: 1.5, deadzone: 0.2 }],
                [ControlAxis.THROTTLE, { type: 'axis', source: '2', sensitivity: 1, deadzone: 0.1 }],
                [ControlAxis.RUDDER, { type: 'axis', source: '3', sensitivity: 1, deadzone: 0.2 }]
            ])
        };

        // Realistic profile - more precise, simulation-like
        const realisticProfile: ControlProfile = {
            name: 'realistic',
            description: 'Precise, simulation-style controls',
            mappings: new Map([
                [ControlAxis.PITCH, { type: 'axis', source: '1', sensitivity: 1, deadzone: 0.1 }],
                [ControlAxis.ROLL, { type: 'axis', source: '0', sensitivity: 1, deadzone: 0.1 }],
                [ControlAxis.THROTTLE, { type: 'axis', source: '2', sensitivity: 1, deadzone: 0.05 }],
                [ControlAxis.RUDDER, { type: 'axis', source: '3', sensitivity: 1, deadzone: 0.1 }]
            ])
        };

        this.registerProfile(arcadeProfile);
        this.registerProfile(realisticProfile);
    }

    public saveProfileToLocalStorage(profileName: string): void {
        const profile = this.profiles.get(profileName);
        if (profile) {
            localStorage.setItem(`control_profile_${profileName}`, JSON.stringify(profile));
        }
    }

    public loadProfileFromLocalStorage(profileName: string): boolean {
        const savedProfile = localStorage.getItem(`control_profile_${profileName}`);
        if (savedProfile) {
            const profile: ControlProfile = JSON.parse(savedProfile);
            this.registerProfile(profile);
            return true;
        }
        return false;
    }
}