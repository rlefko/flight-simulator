import { globalEventBus } from '../core/events/EventBus';
import {
    SystemEvent,
    KeyEvent,
    MouseEvent,
    GamepadButtonEvent,
    GamepadAxisEvent,
} from '../core/events/SystemEvents';

export enum InputDeviceType {
    KEYBOARD,
    MOUSE,
    GAMEPAD,
    TOUCH,
    VR_CONTROLLER,
}

export interface InputControllerBase {
    initialize(): void;
    destroy(): void;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
}

export interface InputState {
    keys: Map<string, boolean>;
    mousePosition: { x: number; y: number };
    mouseButtons: Map<number, boolean>;
    gamepadAxes: Map<number, number>;
    gamepadButtons: Map<number, number>;
}

export class InputManager {
    private static instance: InputManager;
    private controllers: Map<InputDeviceType, InputControllerBase> = new Map();
    private inputState: InputState = {
        keys: new Map(),
        mousePosition: { x: 0, y: 0 },
        mouseButtons: new Map(),
        gamepadAxes: new Map(),
        gamepadButtons: new Map(),
    };
    private eventBus = globalEventBus;
    private isRunning = false;
    private processingInterval: number | null = null;

    private constructor() {
        this.setupEventListeners();
    }

    public static getInstance(): InputManager {
        if (!InputManager.instance) {
            InputManager.instance = new InputManager();
        }
        return InputManager.instance;
    }

    public registerController(type: InputDeviceType, controller: InputControllerBase): void {
        if (this.controllers.has(type)) {
            console.warn(`Controller for type ${type} already registered. Replacing.`);
        }
        this.controllers.set(type, controller);
        controller.initialize();
    }

    public unregisterController(type: InputDeviceType): void {
        const controller = this.controllers.get(type);
        if (controller) {
            controller.destroy();
            this.controllers.delete(type);
        }
    }

    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;

        // Start each registered controller
        this.controllers.forEach((controller) => {
            if (!controller.isEnabled()) {
                controller.setEnabled(true);
            }
        });

        // Optional processing interval for continuous input checking
        // Disabled for now to prevent potential memory issues
        // this.processingInterval = window.setInterval(() => {
        //     this.processInputState();
        // }, 16); // ~60 FPS
    }

    public stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;

        // Stop each registered controller
        this.controllers.forEach((controller) => {
            controller.setEnabled(false);
        });

        // Clear processing interval
        if (this.processingInterval !== null) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    public getInputState(): InputState {
        // Create deep copy of the input state to avoid reference issues
        return {
            keys: new Map(this.inputState.keys),
            mousePosition: { ...this.inputState.mousePosition },
            mouseButtons: new Map(this.inputState.mouseButtons),
            gamepadAxes: new Map(this.inputState.gamepadAxes),
            gamepadButtons: new Map(this.inputState.gamepadButtons),
        };
    }

    private setupEventListeners(): void {
        // Listen to system-level input events
        this.eventBus.on<KeyEvent>(SystemEvent.INPUT_KEY_DOWN, this.handleKeyDown.bind(this));
        this.eventBus.on<KeyEvent>(SystemEvent.INPUT_KEY_UP, this.handleKeyUp.bind(this));
        this.eventBus.on<MouseEvent>(SystemEvent.INPUT_MOUSE_MOVE, this.handleMouseMove.bind(this));
        this.eventBus.on<MouseEvent>(SystemEvent.INPUT_MOUSE_DOWN, this.handleMouseDown.bind(this));
        this.eventBus.on<MouseEvent>(SystemEvent.INPUT_MOUSE_UP, this.handleMouseUp.bind(this));
        this.eventBus.on<GamepadButtonEvent>(
            SystemEvent.INPUT_GAMEPAD_BUTTON,
            this.handleGamepadButton.bind(this)
        );
        this.eventBus.on<GamepadAxisEvent>(
            SystemEvent.INPUT_GAMEPAD_AXIS,
            this.handleGamepadAxis.bind(this)
        );
    }

    private handleKeyDown(event: KeyEvent): void {
        this.inputState.keys.set(event.code, true);
    }

    private handleKeyUp(event: KeyEvent): void {
        this.inputState.keys.delete(event.code);
    }

    private handleMouseMove(event: MouseEvent): void {
        this.inputState.mousePosition.x = event.x;
        this.inputState.mousePosition.y = event.y;
    }

    private handleMouseDown(event: MouseEvent): void {
        if (event.button !== undefined) {
            this.inputState.mouseButtons.set(event.button, true);
        }
    }

    private handleMouseUp(event: MouseEvent): void {
        if (event.button !== undefined) {
            this.inputState.mouseButtons.delete(event.button);
        }
    }

    private handleGamepadButton(event: GamepadButtonEvent): void {
        this.inputState.gamepadButtons.set(event.buttonIndex, event.value);
    }

    private handleGamepadAxis(event: GamepadAxisEvent): void {
        this.inputState.gamepadAxes.set(event.axisIndex, event.value);
    }

    private processInputState(): void {
        // Process continuous input state, can emit events or update simulation
        this.eventBus.emit('input:state', this.inputState);
    }
}

// Optional: Singleton export for easy access
export const inputManager = InputManager.getInstance();
