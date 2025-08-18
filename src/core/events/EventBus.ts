export type EventHandler<T = any> = (data: T) => void;
export type UnsubscribeFn = () => void;

interface EventSubscription {
    handler: EventHandler;
    once: boolean;
    priority: number;
}

export class EventBus {
    private events: Map<string, EventSubscription[]> = new Map();
    private eventQueue: Array<{ event: string; data: any }> = [];
    private isProcessing = false;

    on<T = any>(event: string, handler: EventHandler<T>, priority = 0): UnsubscribeFn {
        return this.addListener(event, handler, false, priority);
    }

    once<T = any>(event: string, handler: EventHandler<T>, priority = 0): UnsubscribeFn {
        return this.addListener(event, handler, true, priority);
    }

    private addListener(
        event: string,
        handler: EventHandler,
        once: boolean,
        priority: number
    ): UnsubscribeFn {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        const subscription: EventSubscription = { handler, once, priority };
        const subscriptions = this.events.get(event)!;
        
        const insertIndex = subscriptions.findIndex(sub => sub.priority < priority);
        if (insertIndex === -1) {
            subscriptions.push(subscription);
        } else {
            subscriptions.splice(insertIndex, 0, subscription);
        }

        return () => this.removeListener(event, handler);
    }

    off(event: string, handler?: EventHandler): void {
        if (!handler) {
            this.events.delete(event);
        } else {
            this.removeListener(event, handler);
        }
    }

    private removeListener(event: string, handler: EventHandler): void {
        const subscriptions = this.events.get(event);
        if (!subscriptions) return;

        const index = subscriptions.findIndex(sub => sub.handler === handler);
        if (index !== -1) {
            subscriptions.splice(index, 1);
            if (subscriptions.length === 0) {
                this.events.delete(event);
            }
        }
    }

    emit<T = any>(event: string, data?: T): void {
        this.eventQueue.push({ event, data });
        
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    emitImmediate<T = any>(event: string, data?: T): void {
        const subscriptions = this.events.get(event);
        if (!subscriptions) return;

        const toRemove: EventHandler[] = [];
        
        for (const subscription of [...subscriptions]) {
            try {
                subscription.handler(data);
                if (subscription.once) {
                    toRemove.push(subscription.handler);
                }
            } catch (error) {
                console.error(`Error in event handler for "${event}":`, error);
            }
        }

        for (const handler of toRemove) {
            this.removeListener(event, handler);
        }
    }

    private processQueue(): void {
        this.isProcessing = true;

        while (this.eventQueue.length > 0) {
            const { event, data } = this.eventQueue.shift()!;
            this.emitImmediate(event, data);
        }

        this.isProcessing = false;
    }

    clear(): void {
        this.events.clear();
        this.eventQueue = [];
    }

    hasListeners(event: string): boolean {
        return this.events.has(event) && this.events.get(event)!.length > 0;
    }

    getListenerCount(event?: string): number {
        if (event) {
            const subscriptions = this.events.get(event);
            return subscriptions ? subscriptions.length : 0;
        }
        
        let count = 0;
        for (const subscriptions of this.events.values()) {
            count += subscriptions.length;
        }
        return count;
    }
}

export const globalEventBus = new EventBus();