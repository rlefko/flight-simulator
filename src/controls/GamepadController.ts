import { InputControllerBase } from './InputManager';
import { globalEventBus } from '../core/events/EventBus';
import { SystemEvent, GamepadButtonEvent, GamepadAxisEvent } from '../core/events/SystemEvents';

export class GamepadController implements InputControllerBase {
    private eventBus = globalEventBus;
    private enabled = false;
    private gamepads: Map<number, Gamepad> = new Map();
    private animationFrameId: number | null = null;

    initialize(): void {
        this.setEnabled(true);
        window.addEventListener('gamepadconnected', this.handleGamepadConnected.bind(this));
        window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected.bind(this));
    }

    destroy(): void {
        this.setEnabled(false);
        window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
        window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.enabled) return;

        this.enabled = enabled;

        if (enabled) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    private startPolling(): void {
        this.animationFrameId = requestAnimationFrame(this.pollGamepads.bind(this));
    }

    private stopPolling(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private pollGamepads(): void {
        if (!this.enabled) return;

        const gamepads = navigator.getGamepads();
        
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;

            // Check if this is a new gamepad
            if (!this.gamepads.has(gamepad.index)) {
                this.handleGamepadConnected({ gamepad });
            }

            // Poll buttons
            gamepad.buttons.forEach((button, buttonIndex) => {
                const buttonEvent: GamepadButtonEvent = {
                    gamepadIndex: gamepad.index,
                    buttonIndex,
                    value: button.value,
                    pressed: button.pressed
                };

                if (button.pressed) {
                    this.eventBus.emit(SystemEvent.INPUT_GAMEPAD_BUTTON, buttonEvent);
                }
            });

            // Poll axes
            gamepad.axes.forEach((value, axisIndex) => {
                const axisEvent: GamepadAxisEvent = {
                    gamepadIndex: gamepad.index,
                    axisIndex,
                    value
                };

                this.eventBus.emit(SystemEvent.INPUT_GAMEPAD_AXIS, axisEvent);
            });
        }

        // Continue polling
        this.animationFrameId = requestAnimationFrame(this.pollGamepads.bind(this));
    }

    private handleGamepadConnected(event: GamepadEvent): void {
        const gamepad = event.gamepad;
        this.gamepads.set(gamepad.index, gamepad);
        
        this.eventBus.emit(SystemEvent.INPUT_GAMEPAD_CONNECTED, {
            gamepadIndex: gamepad.index,
            id: gamepad.id,
            buttons: gamepad.buttons.length,
            axes: gamepad.axes.length
        });
    }

    private handleGamepadDisconnected(event: GamepadEvent): void {
        const gamepad = event.gamepad;
        this.gamepads.delete(gamepad.index);

        this.eventBus.emit(SystemEvent.INPUT_GAMEPAD_DISCONNECTED, {
            gamepadIndex: gamepad.index,
            id: gamepad.id
        });
    }
}