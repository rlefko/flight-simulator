import { InputControllerBase } from './InputManager';
import { globalEventBus } from '../core/events/EventBus';
import { SystemEvent, KeyEvent } from '../core/events/SystemEvents';

export class KeyboardController implements InputControllerBase {
    private eventBus = globalEventBus;
    private enabled = false;
    private boundKeyDown: (event: KeyboardEvent) => void;
    private boundKeyUp: (event: KeyboardEvent) => void;

    constructor() {
        this.boundKeyDown = this.handleKeyDown.bind(this);
        this.boundKeyUp = this.handleKeyUp.bind(this);
    }

    initialize(): void {
        this.setEnabled(true);
    }

    destroy(): void {
        this.setEnabled(false);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.enabled) return;

        this.enabled = enabled;

        if (enabled) {
            window.addEventListener('keydown', this.boundKeyDown);
            window.addEventListener('keyup', this.boundKeyUp);
        } else {
            window.removeEventListener('keydown', this.boundKeyDown);
            window.removeEventListener('keyup', this.boundKeyUp);
        }
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (!this.enabled) return;

        const keyEvent: KeyEvent = {
            key: event.key,
            code: event.code,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey
        };

        this.eventBus.emit(SystemEvent.INPUT_KEY_DOWN, keyEvent);
    }

    private handleKeyUp(event: KeyboardEvent): void {
        if (!this.enabled) return;

        const keyEvent: KeyEvent = {
            key: event.key,
            code: event.code,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey
        };

        this.eventBus.emit(SystemEvent.INPUT_KEY_UP, keyEvent);
    }
}