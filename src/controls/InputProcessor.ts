export interface InputCommand {
    type: string;
    payload: any;
}

export interface InputChord {
    keys: string[];
    command: InputCommand;
}

export interface InputProfile {
    name: string;
    chords: InputChord[];
    axisMappings: Record<string, string>;
}

export class InputProcessor {
    private profiles: Map<string, InputProfile> = new Map();
    private activeProfile: string | null = null;
    private keyState: Set<string> = new Set();
    private axisState: Map<string, number> = new Map();
    private buttonState: Map<string, boolean> = new Map();

    constructor() {
        this.registerDefaultProfiles();
    }

    private registerDefaultProfiles(): void {
        const defaultProfile: InputProfile = {
            name: 'default',
            chords: [
                // Example chord: Ctrl+P for pause
                {
                    keys: ['Control', 'p'], 
                    command: { type: 'TOGGLE_PAUSE', payload: null }
                },
                // Example chord: Shift+G for gear toggle
                {
                    keys: ['Shift', 'g'], 
                    command: { type: 'TOGGLE_GEAR', payload: null }
                }
            ],
            axisMappings: {
                pitch: 'gamepad.axes.1',
                roll: 'gamepad.axes.0',
                throttle: 'gamepad.axes.2',
                rudder: 'gamepad.axes.3'
            }
        };

        this.registerProfile(defaultProfile);
        this.setActiveProfile('default');
    }

    public registerProfile(profile: InputProfile): void {
        this.profiles.set(profile.name, profile);
    }

    public setActiveProfile(profileName: string): boolean {
        if (!this.profiles.has(profileName)) {
            console.error(`Profile '${profileName}' not found`);
            return false;
        }
        this.activeProfile = profileName;
        return true;
    }

    public updateKeyState(key: string, pressed: boolean): void {
        if (pressed) {
            this.keyState.add(key);
        } else {
            this.keyState.delete(key);
        }
        this.checkChords();
    }

    public updateAxisState(axis: string, value: number): void {
        this.axisState.set(axis, value);
    }

    public updateButtonState(button: string, pressed: boolean): void {
        this.buttonState.set(button, pressed);
    }

    private checkChords(): void {
        if (!this.activeProfile) return;

        const profile = this.profiles.get(this.activeProfile)!;
        
        for (const chord of profile.chords) {
            const chordActivated = chord.keys.every(key => this.keyState.has(key));
            
            if (chordActivated) {
                this.processCommand(chord.command);
                
                // Remove activated keys to prevent repeated triggers
                chord.keys.forEach(key => this.keyState.delete(key));
            }
        }
    }

    public processCommand(command: InputCommand): void {
        // Placeholder for command processing
        // In a real implementation, this would dispatch to appropriate system
        console.log('Processing command:', command);
    }

    public getAxisValue(axisName: string): number {
        if (!this.activeProfile) return 0;

        const profile = this.profiles.get(this.activeProfile)!;
        const mappedAxis = profile.axisMappings[axisName];
        
        if (!mappedAxis) {
            console.warn(`No mapping found for axis '${axisName}'`);
            return 0;
        }

        // Parse axis mapping (e.g., 'gamepad.axes.1')
        const [source, type, index] = mappedAxis.split('.');
        
        switch (source) {
            case 'gamepad':
                return this.getGamepadAxisValue(parseInt(index));
            default:
                console.warn(`Unknown axis source: ${source}`);
                return 0;
        }
    }

    private getGamepadAxisValue(index: number): number {
        const value = this.axisState.get(`gamepad.axes.${index}`);
        return value !== undefined ? this.applyDeadzone(value) : 0;
    }

    private applyDeadzone(value: number, deadzone: number = 0.1): number {
        // Linear deadzone for now
        return Math.abs(value) > deadzone ? value : 0;
    }

    public saveProfile(profileName: string): void {
        const profile = this.profiles.get(profileName);
        if (profile) {
            localStorage.setItem(`input_profile_${profileName}`, JSON.stringify(profile));
        }
    }

    public loadProfile(profileName: string): boolean {
        const savedProfile = localStorage.getItem(`input_profile_${profileName}`);
        if (savedProfile) {
            const profile: InputProfile = JSON.parse(savedProfile);
            this.registerProfile(profile);
            return true;
        }
        return false;
    }
}