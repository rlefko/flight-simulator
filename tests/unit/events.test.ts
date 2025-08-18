import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '@core/events/EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should emit and receive events', () => {
    const handler = vi.fn();
    eventBus.on('test', handler);
    eventBus.emit('test', { data: 'test' });
    
    expect(handler).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should handle multiple listeners', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    
    eventBus.on('test', handler1);
    eventBus.on('test', handler2);
    eventBus.emit('test', 'data');
    
    expect(handler1).toHaveBeenCalledWith('data');
    expect(handler2).toHaveBeenCalledWith('data');
  });

  it('should respect priority order', () => {
    const calls: number[] = [];
    
    eventBus.on('test', () => calls.push(1), 0);
    eventBus.on('test', () => calls.push(2), 10);
    eventBus.on('test', () => calls.push(3), 5);
    
    eventBus.emit('test');
    
    expect(calls).toEqual([2, 3, 1]);
  });

  it('should handle once listeners', () => {
    const handler = vi.fn();
    
    eventBus.once('test', handler);
    eventBus.emit('test');
    eventBus.emit('test');
    
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should remove listeners', () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.on('test', handler);
    
    eventBus.emit('test');
    expect(handler).toHaveBeenCalledTimes(1);
    
    unsubscribe();
    eventBus.emit('test');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should remove all listeners for an event', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    
    eventBus.on('test', handler1);
    eventBus.on('test', handler2);
    eventBus.off('test');
    eventBus.emit('test');
    
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should clear all events', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    
    eventBus.on('test1', handler1);
    eventBus.on('test2', handler2);
    eventBus.clear();
    
    eventBus.emit('test1');
    eventBus.emit('test2');
    
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should check if event has listeners', () => {
    expect(eventBus.hasListeners('test')).toBe(false);
    
    const unsubscribe = eventBus.on('test', () => {});
    expect(eventBus.hasListeners('test')).toBe(true);
    
    unsubscribe();
    expect(eventBus.hasListeners('test')).toBe(false);
  });

  it('should count listeners', () => {
    expect(eventBus.getListenerCount('test')).toBe(0);
    
    eventBus.on('test', () => {});
    eventBus.on('test', () => {});
    expect(eventBus.getListenerCount('test')).toBe(2);
    
    eventBus.on('other', () => {});
    expect(eventBus.getListenerCount()).toBe(3);
  });

  it('should handle errors in handlers gracefully', () => {
    const handler1 = vi.fn(() => {
      throw new Error('Test error');
    });
    const handler2 = vi.fn();
    
    eventBus.on('test', handler1);
    eventBus.on('test', handler2);
    
    expect(() => eventBus.emit('test')).not.toThrow();
    expect(handler2).toHaveBeenCalled();
  });

  it('should process queued events', () => {
    const calls: string[] = [];
    
    eventBus.on('test1', () => {
      calls.push('test1');
      eventBus.emit('test2');
    });
    
    eventBus.on('test2', () => {
      calls.push('test2');
    });
    
    eventBus.emit('test1');
    
    expect(calls).toEqual(['test1', 'test2']);
  });
});