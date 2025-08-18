import { InputControllerBase } from './InputManager';
import { globalEventBus } from '../core/events/EventBus';
import { SystemEvent, MouseEvent } from '../core/events/SystemEvents';

export class MouseController implements InputControllerBase {
    private eventBus = globalEventBus;
    private enabled = false;
    private mousePosition = { x: 0, y: 0 };
    private boundMouseMove: (event: MouseEvent) => void;
    private boundMouseDown: (event: MouseEvent) => void;
    private boundMouseUp: (event: MouseEvent) => void;
    private boundMouseWheel: (event: WheelEvent) => void;

    constructor() {
        this.boundMouseMove = this.handleMouseMove.bind(this);
        this.boundMouseDown = this.handleMouseDown.bind(this);
        this.boundMouseUp = this.handleMouseUp.bind(this);
        this.boundMouseWheel = this.handleMouseWheel.bind(this);
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
            window.addEventListener('mousemove', this.boundMouseMove);
            window.addEventListener('mousedown', this.boundMouseDown);
            window.addEventListener('mouseup', this.boundMouseUp);
            window.addEventListener('wheel', this.boundMouseWheel);
        } else {
            window.removeEventListener('mousemove', this.boundMouseMove);
            window.removeEventListener('mousedown', this.boundMouseDown);
            window.removeEventListener('mouseup', this.boundMouseUp);
            window.removeEventListener('wheel', this.boundMouseWheel);
        }
    }

    private handleMouseMove(event: MouseEvent): void {
        if (!this.enabled) return;

        const mouseEvent: MouseEvent = {
            x: event.clientX,
            y: event.clientY,
            deltaX: event.clientX - this.mousePosition.x,
            deltaY: event.clientY - this.mousePosition.y
        };

        this.mousePosition.x = event.clientX;
        this.mousePosition.y = event.clientY;

        this.eventBus.emit(SystemEvent.INPUT_MOUSE_MOVE, mouseEvent);
    }

    private handleMouseDown(event: MouseEvent): void {
        if (!this.enabled) return;

        const mouseEvent: MouseEvent = {
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            buttons: event.buttons
        };

        this.eventBus.emit(SystemEvent.INPUT_MOUSE_DOWN, mouseEvent);
    }

    private handleMouseUp(event: MouseEvent): void {
        if (!this.enabled) return;

        const mouseEvent: MouseEvent = {
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            buttons: event.buttons
        };

        this.eventBus.emit(SystemEvent.INPUT_MOUSE_UP, mouseEvent);
    }

    private handleMouseWheel(event: WheelEvent): void {
        if (!this.enabled) return;

        const mouseEvent: MouseEvent = {
            x: event.clientX,
            y: event.clientY,
            deltaX: event.deltaX,
            deltaY: event.deltaY
        };

        this.eventBus.emit(SystemEvent.INPUT_MOUSE_WHEEL, mouseEvent);
    }
}