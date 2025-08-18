import { InputControllerBase } from './InputManager';
import { globalEventBus } from '../core/events/EventBus';
import { SystemEvent } from '../core/events/SystemEvents';

export interface TouchControllerOptions {
    enableMultitouch?: boolean;
    preventDefaultTouch?: boolean;
}

export class TouchController implements InputControllerBase {
    private eventBus = globalEventBus;
    private enabled = false;
    private options: TouchControllerOptions;
    private activeTouches: Map<number, Touch> = new Map();

    private boundTouchStart: (event: TouchEvent) => void;
    private boundTouchMove: (event: TouchEvent) => void;
    private boundTouchEnd: (event: TouchEvent) => void;
    private boundTouchCancel: (event: TouchEvent) => void;

    constructor(options: TouchControllerOptions = {}) {
        this.options = {
            enableMultitouch: true,
            preventDefaultTouch: true,
            ...options
        };

        this.boundTouchStart = this.handleTouchStart.bind(this);
        this.boundTouchMove = this.handleTouchMove.bind(this);
        this.boundTouchEnd = this.handleTouchEnd.bind(this);
        this.boundTouchCancel = this.handleTouchCancel.bind(this);
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
            window.addEventListener('touchstart', this.boundTouchStart, { passive: !this.options.preventDefaultTouch });
            window.addEventListener('touchmove', this.boundTouchMove, { passive: !this.options.preventDefaultTouch });
            window.addEventListener('touchend', this.boundTouchEnd, { passive: !this.options.preventDefaultTouch });
            window.addEventListener('touchcancel', this.boundTouchCancel, { passive: !this.options.preventDefaultTouch });
        } else {
            window.removeEventListener('touchstart', this.boundTouchStart);
            window.removeEventListener('touchmove', this.boundTouchMove);
            window.removeEventListener('touchend', this.boundTouchEnd);
            window.removeEventListener('touchcancel', this.boundTouchCancel);
        }
    }

    private handleTouchStart(event: TouchEvent): void {
        if (!this.enabled) return;

        if (this.options.preventDefaultTouch) {
            event.preventDefault();
        }

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            this.activeTouches.set(touch.identifier, touch);

            this.eventBus.emit(SystemEvent.INPUT_MOUSE_DOWN, {
                x: touch.clientX,
                y: touch.clientY,
                button: 0, // Primary touch is like left mouse button
                buttons: 1
            });
        }
    }

    private handleTouchMove(event: TouchEvent): void {
        if (!this.enabled) return;

        if (this.options.preventDefaultTouch) {
            event.preventDefault();
        }

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const previousTouch = this.activeTouches.get(touch.identifier);

            if (previousTouch) {
                this.eventBus.emit(SystemEvent.INPUT_MOUSE_MOVE, {
                    x: touch.clientX,
                    y: touch.clientY,
                    deltaX: touch.clientX - previousTouch.clientX,
                    deltaY: touch.clientY - previousTouch.clientY
                });

                this.activeTouches.set(touch.identifier, touch);
            }
        }
    }

    private handleTouchEnd(event: TouchEvent): void {
        if (!this.enabled) return;

        if (this.options.preventDefaultTouch) {
            event.preventDefault();
        }

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            this.activeTouches.delete(touch.identifier);

            this.eventBus.emit(SystemEvent.INPUT_MOUSE_UP, {
                x: touch.clientX,
                y: touch.clientY,
                button: 0, // Primary touch is like left mouse button
                buttons: 0
            });
        }
    }

    private handleTouchCancel(event: TouchEvent): void {
        if (!this.enabled) return;

        if (this.options.preventDefaultTouch) {
            event.preventDefault();
        }

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            this.activeTouches.delete(touch.identifier);
        }
    }
}