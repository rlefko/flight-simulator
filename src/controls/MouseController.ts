import { InputControllerBase, InputDeviceType, InputManager } from './InputManager';
import { globalEventBus } from '../core/events/EventBus';
import { SystemEvent, MouseEvent } from '../core/events/SystemEvents';

export class MouseController implements InputControllerBase {
    private canvas: HTMLCanvasElement;
    private enabled = false;
    private isPointerLocked = false;
    private lastX = 0;
    private lastY = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    initialize(): void {
        // Mouse move events
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));

        // Mouse button events
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // Mouse wheel
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this));

        // Pointer lock events
        this.canvas.addEventListener('click', this.requestPointerLock.bind(this));
        document.addEventListener('pointerlockchange', this.handlePointerLockChange.bind(this));
        document.addEventListener('pointerlockerror', this.handlePointerLockError.bind(this));
    }

    destroy(): void {
        this.setEnabled(false);
        document.exitPointerLock();
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled && this.isPointerLocked) {
            document.exitPointerLock();
        }
    }

    private requestPointerLock(): void {
        if (this.enabled && !this.isPointerLocked) {
            this.canvas.requestPointerLock();
        }
    }

    private handlePointerLockChange(): void {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        console.log('Pointer lock:', this.isPointerLocked ? 'enabled' : 'disabled');
    }

    private handlePointerLockError(): void {
        console.error('Failed to lock pointer');
    }

    private handleMouseMove(event: any): void {
        if (!this.enabled) return;

        if (this.isPointerLocked) {
            // Use movement deltas when pointer is locked
            const deltaX = event.movementX || 0;
            const deltaY = event.movementY || 0;

            globalEventBus.emit<MouseEvent>(SystemEvent.INPUT_MOUSE_MOVE, {
                x: deltaX,
                y: deltaY,
                deltaX: deltaX,
                deltaY: deltaY,
                buttons: event.buttons,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                isPointerLocked: true,
            });
        } else {
            // Use absolute position when pointer is not locked
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const deltaX = x - this.lastX;
            const deltaY = y - this.lastY;

            this.lastX = x;
            this.lastY = y;

            globalEventBus.emit<MouseEvent>(SystemEvent.INPUT_MOUSE_MOVE, {
                x: x,
                y: y,
                deltaX: deltaX,
                deltaY: deltaY,
                buttons: event.buttons,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                isPointerLocked: false,
            });
        }
    }

    private handleMouseDown(event: any): void {
        if (!this.enabled) return;

        const rect = this.canvas.getBoundingClientRect();
        globalEventBus.emit<MouseEvent>(SystemEvent.INPUT_MOUSE_DOWN, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            button: event.button,
            buttons: event.buttons,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
    }

    private handleMouseUp(event: any): void {
        if (!this.enabled) return;

        const rect = this.canvas.getBoundingClientRect();
        globalEventBus.emit<MouseEvent>(SystemEvent.INPUT_MOUSE_UP, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            button: event.button,
            buttons: event.buttons,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
    }

    private handleWheel(event: WheelEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        globalEventBus.emit('input:wheel', {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
    }
}
