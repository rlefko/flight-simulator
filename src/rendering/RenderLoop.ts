import { EventBus } from '../core/events/EventBus';
import { WebGPURenderer } from './WebGPURenderer';

interface FrameData {
    frameNumber: number;
    timestamp: number;
    deltaTime: number;
    fps: number;
    interpolation: number;
}

interface RenderLoopOptions {
    targetFPS?: number;
    vSync?: boolean;
    adaptiveSync?: boolean;
    maxFrameSkip?: number;
    performanceMode?: 'quality' | 'performance' | 'balanced';
}

export class RenderLoop {
    private renderer: WebGPURenderer;
    private eventBus: EventBus;
    private options: RenderLoopOptions;
    
    // Timing state
    private isRunning = false;
    private frameNumber = 0;
    private lastFrameTime = 0;
    private accumulator = 0;
    private currentTime = 0;
    private frameTime = 1000 / 60; // Default 60 FPS
    private maxFrameTime = 1000 / 20; // Minimum 20 FPS
    
    // Performance tracking
    private fps = 60;
    private frameHistory: number[] = [];
    private frameHistorySize = 60; // Track last 60 frames
    private performanceUpdateTime = 0;
    private performanceUpdateInterval = 1000; // 1 second
    
    // Animation frame handling
    private animationFrameId: number | null = null;
    
    // Frame pacing
    private skippedFrames = 0;
    private renderSkipThreshold = 2;
    
    constructor(renderer: WebGPURenderer, eventBus: EventBus, options: RenderLoopOptions = {}) {
        this.renderer = renderer;
        this.eventBus = eventBus;
        
        this.options = {
            targetFPS: 60,
            vSync: true,
            adaptiveSync: false,
            maxFrameSkip: 3,
            performanceMode: 'balanced',
            ...options,
        };
        
        this.frameTime = 1000 / (this.options.targetFPS || 60);
        this.setupEventListeners();
    }
    
    private setupEventListeners(): void {
        // Handle visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pause();
            } else if (this.isRunning) {
                this.resume();
            }
        });
        
        // Handle renderer errors
        this.eventBus.on('renderer:error', (error) => {
            console.error('Renderer error, pausing render loop:', error);
            this.pause();
        });
        
        // Handle device lost
        this.eventBus.on('renderer:device-lost', () => {
            console.warn('WebGPU device lost, pausing render loop');
            this.pause();
        });
        
        // Handle settings changes
        this.eventBus.on('settings:fps-limit-changed', (targetFPS: number) => {
            this.setTargetFPS(targetFPS);
        });
        
        this.eventBus.on('settings:vsync-changed', (enabled: boolean) => {
            this.options.vSync = enabled;
        });
    }
    
    start(): void {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.frameNumber = 0;
        this.lastFrameTime = performance.now();
        this.accumulator = 0;
        this.skippedFrames = 0;
        
        this.eventBus.emit('render-loop:started');
        this.scheduleFrame();
    }
    
    stop(): void {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        this.eventBus.emit('render-loop:stopped');
    }
    
    pause(): void {
        if (!this.isRunning) return;
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        this.eventBus.emit('render-loop:paused');
    }
    
    resume(): void {
        if (!this.isRunning || this.animationFrameId !== null) return;
        
        this.lastFrameTime = performance.now();
        this.scheduleFrame();
        this.eventBus.emit('render-loop:resumed');
    }
    
    private scheduleFrame(): void {
        if (!this.isRunning) return;
        
        if (this.options.vSync) {
            this.animationFrameId = requestAnimationFrame((timestamp) => {
                this.tick(timestamp);
            });
        } else {
            // Manual frame pacing
            const now = performance.now();
            const elapsed = now - this.lastFrameTime;
            const targetDelay = Math.max(0, this.frameTime - elapsed);
            
            setTimeout(() => {
                if (this.isRunning) {
                    this.animationFrameId = requestAnimationFrame((timestamp) => {
                        this.tick(timestamp);
                    });
                }
            }, targetDelay);
        }
    }
    
    private tick(timestamp: number): void {
        if (!this.isRunning) return;
        
        this.currentTime = timestamp;
        
        // Calculate frame timing
        let deltaTime = this.currentTime - this.lastFrameTime;
        this.lastFrameTime = this.currentTime;
        
        // Clamp delta time to prevent spiral of death
        deltaTime = Math.min(deltaTime, this.maxFrameTime);
        
        // Update accumulator for fixed timestep systems
        this.accumulator += deltaTime;
        
        // Performance mode adjustments
        const shouldRender = this.shouldRender(deltaTime);
        
        if (shouldRender) {
            // Update performance tracking
            this.updatePerformanceStats(deltaTime);
            
            // Calculate interpolation factor for smooth rendering
            const interpolation = this.accumulator / this.frameTime;
            
            // Create frame data
            const frameData: FrameData = {
                frameNumber: this.frameNumber,
                timestamp: this.currentTime,
                deltaTime: deltaTime / 1000, // Convert to seconds
                fps: this.fps,
                interpolation: Math.min(interpolation, 1.0),
            };
            
            // Emit frame start event
            this.eventBus.emit('frame:start', frameData);
            
            try {
                // Render the frame
                this.renderer.render(frameData.deltaTime);
                
                // Emit frame rendered event
                this.eventBus.emit('frame:rendered', frameData);
                
                this.frameNumber++;
                this.skippedFrames = 0;
                
            } catch (error) {
                console.error('Error during frame rendering:', error);
                this.eventBus.emit('render-loop:error', { error, frameData });
                
                // Skip this frame but continue rendering
                this.skippedFrames++;
                
                if (this.skippedFrames >= (this.options.maxFrameSkip || 3)) {
                    console.error('Too many consecutive frame errors, stopping render loop');
                    this.stop();
                    return;
                }
            }
            
            // Consume accumulator for rendered frame
            if (this.accumulator >= this.frameTime) {
                this.accumulator -= this.frameTime;
            }
            
            // Emit frame end event
            this.eventBus.emit('frame:end', frameData);
        }
        
        // Schedule next frame
        this.scheduleFrame();
    }
    
    private shouldRender(deltaTime: number): boolean {
        switch (this.options.performanceMode) {
            case 'quality':
                // Always render for best quality
                return true;
                
            case 'performance':
                // Skip frames aggressively to maintain performance
                if (this.fps < (this.options.targetFPS || 60) * 0.8) {
                    this.renderSkipThreshold = Math.min(this.renderSkipThreshold + 1, 5);
                } else {
                    this.renderSkipThreshold = Math.max(this.renderSkipThreshold - 1, 1);
                }
                return this.frameNumber % this.renderSkipThreshold === 0;
                
            case 'balanced':
            default:
                // Adaptive rendering based on performance
                if (this.options.adaptiveSync) {
                    // Only skip if we're significantly behind
                    return this.accumulator < this.frameTime * 2;
                }
                return true;
        }
    }
    
    private updatePerformanceStats(deltaTime: number): void {
        // Add frame time to history
        this.frameHistory.push(deltaTime);
        if (this.frameHistory.length > this.frameHistorySize) {
            this.frameHistory.shift();
        }
        
        // Update FPS periodically
        if (this.currentTime - this.performanceUpdateTime >= this.performanceUpdateInterval) {
            if (this.frameHistory.length > 0) {
                const averageFrameTime = this.frameHistory.reduce((sum, time) => sum + time, 0) / this.frameHistory.length;
                this.fps = 1000 / averageFrameTime;
            }
            
            // Emit performance stats
            this.eventBus.emit('render-loop:stats', {
                fps: this.fps,
                frameNumber: this.frameNumber,
                averageFrameTime: this.frameHistory.reduce((sum, time) => sum + time, 0) / this.frameHistory.length,
                skippedFrames: this.skippedFrames,
            });
            
            this.performanceUpdateTime = this.currentTime;
        }
    }
    
    // Public API
    setTargetFPS(fps: number): void {
        this.options.targetFPS = Math.max(1, Math.min(fps, 240)); // Clamp between 1-240 FPS
        this.frameTime = 1000 / this.options.targetFPS;
    }
    
    setPerformanceMode(mode: 'quality' | 'performance' | 'balanced'): void {
        this.options.performanceMode = mode;
        this.renderSkipThreshold = mode === 'performance' ? 2 : 1;
    }
    
    setVSync(enabled: boolean): void {
        this.options.vSync = enabled;
    }
    
    setAdaptiveSync(enabled: boolean): void {
        this.options.adaptiveSync = enabled;
    }
    
    // Getters
    getIsRunning(): boolean {
        return this.isRunning;
    }
    
    getFPS(): number {
        return this.fps;
    }
    
    getFrameNumber(): number {
        return this.frameNumber;
    }
    
    getOptions(): RenderLoopOptions {
        return { ...this.options };
    }
    
    getPerformanceStats() {
        return {
            fps: this.fps,
            frameNumber: this.frameNumber,
            averageFrameTime: this.frameHistory.length > 0 
                ? this.frameHistory.reduce((sum, time) => sum + time, 0) / this.frameHistory.length 
                : 0,
            skippedFrames: this.skippedFrames,
            isRunning: this.isRunning,
        };
    }
}