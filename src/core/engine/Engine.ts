import { EventBus, globalEventBus } from '../events/EventBus';
import { SystemEvent, EngineUpdateEvent } from '../events/SystemEvents';
import { WebGPURenderer } from '@rendering/WebGPURenderer';
import { FlightDynamics } from '@physics/FlightDynamics';
import { InputManager } from '@controls/InputManager';
import { WorldManager } from '@world/index';
import { Vector3 } from '@core/math';

export interface EngineConfig {
    canvas: HTMLCanvasElement;
    fixedTimeStep: number;
    maxSubSteps: number;
    targetFPS: number;
    enableStats: boolean;
}

export class Engine {
    private config: EngineConfig;
    private eventBus: EventBus;
    private renderer: WebGPURenderer | null = null;
    private physics: FlightDynamics | null = null;
    private input: InputManager | null = null;
    private world: WorldManager | null = null;
    
    private isRunning = false;
    private isPaused = false;
    private lastTime = 0;
    private accumulator = 0;
    private frameCount = 0;
    private totalTime = 0;
    
    private rafId: number | null = null;
    private initialized = false;

    constructor(config: Partial<EngineConfig> = {}) {
        this.config = {
            canvas: config.canvas || document.getElementById('canvas') as HTMLCanvasElement,
            fixedTimeStep: config.fixedTimeStep || 1 / 120,
            maxSubSteps: config.maxSubSteps || 10,
            targetFPS: config.targetFPS || 60,
            enableStats: config.enableStats ?? true
        };
        
        this.eventBus = globalEventBus;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            console.warn('Engine already initialized');
            return;
        }

        try {
            console.log('Initializing Flight Simulator Engine...');
            
            this.renderer = new WebGPURenderer(this.config.canvas);
            await this.renderer.initialize();
            console.log('Renderer initialized');
            
            this.physics = new FlightDynamics();
            console.log('Physics initialized');
            
            this.input = new InputManager();
            this.input.initialize();
            console.log('Input system initialized');
            
            this.world = new WorldManager();
            await this.world.initialize();
            console.log('World system initialized');
            
            this.setupEventHandlers();
            
            const aircraftConfig = {
                mass: 1200,
                wingArea: 16.2,
                wingSpan: 11,
                position: new Vector3(0, 1000, 0),
                engines: [{
                    type: 'piston' as const,
                    maxPower: 180,
                    propDiameter: 1.9
                }]
            };
            this.physics.loadAircraft(aircraftConfig);
            
            this.world.setViewerPosition(0, 1000, 0);
            
            this.initialized = true;
            this.eventBus.emit(SystemEvent.ENGINE_START);
            console.log('Engine initialization complete');
            
        } catch (error) {
            console.error('Failed to initialize engine:', error);
            throw error;
        }
    }

    private setupEventHandlers(): void {
        this.eventBus.on(SystemEvent.ENGINE_PAUSE, () => {
            this.pause();
        });
        
        this.eventBus.on(SystemEvent.ENGINE_RESUME, () => {
            this.resume();
        });
        
        this.eventBus.on(SystemEvent.RENDER_RESIZE, () => {
            if (this.renderer) {
                this.renderer.handleResize();
            }
        });
        
        window.addEventListener('resize', () => {
            this.eventBus.emit(SystemEvent.RENDER_RESIZE);
        });
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pause();
            } else {
                this.resume();
            }
        });
    }

    start(): void {
        if (!this.initialized) {
            throw new Error('Engine must be initialized before starting');
        }
        
        if (this.isRunning) {
            console.warn('Engine already running');
            return;
        }
        
        this.isRunning = true;
        this.lastTime = performance.now();
        this.accumulator = 0;
        
        console.log('Starting engine main loop');
        this.gameLoop(this.lastTime);
    }

    stop(): void {
        this.isRunning = false;
        
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        
        this.eventBus.emit(SystemEvent.ENGINE_STOP);
        console.log('Engine stopped');
    }

    pause(): void {
        if (!this.isPaused) {
            this.isPaused = true;
            this.eventBus.emit(SystemEvent.ENGINE_PAUSE);
            console.log('Engine paused');
        }
    }

    resume(): void {
        if (this.isPaused) {
            this.isPaused = false;
            this.lastTime = performance.now();
            this.accumulator = 0;
            this.eventBus.emit(SystemEvent.ENGINE_RESUME);
            console.log('Engine resumed');
        }
    }

    private gameLoop = (currentTime: number): void => {
        if (!this.isRunning) return;
        
        this.rafId = requestAnimationFrame(this.gameLoop);
        
        if (this.isPaused) return;
        
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.25);
        this.lastTime = currentTime;
        
        this.accumulator += deltaTime;
        
        let substeps = 0;
        while (this.accumulator >= this.config.fixedTimeStep && substeps < this.config.maxSubSteps) {
            this.fixedUpdate(this.config.fixedTimeStep);
            this.accumulator -= this.config.fixedTimeStep;
            substeps++;
        }
        
        const interpolation = this.accumulator / this.config.fixedTimeStep;
        
        this.update(deltaTime);
        this.lateUpdate(deltaTime);
        this.render(interpolation);
        
        this.frameCount++;
        this.totalTime += deltaTime;
        
        if (this.config.enableStats) {
            this.updateStats(deltaTime);
        }
    };

    private fixedUpdate(deltaTime: number): void {
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount
        };
        
        this.eventBus.emit(SystemEvent.ENGINE_FIXED_UPDATE, updateEvent);
        
        if (this.physics) {
            this.physics.update(deltaTime);
            
            const state = this.physics.getAircraftState();
            if (this.world && state) {
                this.world.setViewerPosition(
                    state.position.x,
                    state.position.y,
                    state.position.z
                );
            }
        }
    }

    private update(deltaTime: number): void {
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount
        };
        
        this.eventBus.emit(SystemEvent.ENGINE_UPDATE, updateEvent);
        
        if (this.input) {
            this.input.update(deltaTime);
            
            const axes = this.input.getAxes();
            if (this.physics && axes) {
                this.physics.setControlInputs({
                    aileron: axes.roll || 0,
                    elevator: axes.pitch || 0,
                    rudder: axes.yaw || 0,
                    throttle: axes.throttle || 0,
                    flaps: axes.flaps || 0,
                    gear: axes.gear || 0,
                    speedbrake: axes.speedbrake || 0,
                    parkingBrake: axes.parkingBrake || 0
                });
            }
        }
        
        if (this.world) {
            this.world.update(deltaTime);
        }
    }

    private lateUpdate(deltaTime: number): void {
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount
        };
        
        this.eventBus.emit(SystemEvent.ENGINE_LATE_UPDATE, updateEvent);
    }

    private render(interpolation: number): void {
        if (!this.renderer) return;
        
        this.eventBus.emit(SystemEvent.ENGINE_RENDER, { interpolation });
        
        this.renderer.beginFrame();
        
        if (this.world) {
            const visibleTiles = this.world.getVisibleTerrain();
        }
        
        if (this.physics) {
            const state = this.physics.getAircraftState();
        }
        
        this.renderer.endFrame();
    }

    private updateStats(deltaTime: number): void {
        const fps = 1 / deltaTime;
        const statsElement = document.getElementById('stats');
        
        if (statsElement && this.frameCount % 10 === 0) {
            const state = this.physics?.getAircraftState();
            const memoryUsage = (performance as any).memory?.usedJSHeapSize 
                ? ((performance as any).memory.usedJSHeapSize / 1024 / 1024).toFixed(1)
                : 'N/A';
            
            statsElement.innerHTML = `
                FPS: ${fps.toFixed(0)}<br>
                Frame: ${this.frameCount}<br>
                Memory: ${memoryUsage} MB<br>
                ${state ? `
                    Alt: ${state.altitude.toFixed(0)} ft<br>
                    IAS: ${state.airspeed.indicated.toFixed(0)} kts<br>
                    HDG: ${(state.heading * 180 / Math.PI).toFixed(0)}°<br>
                    AOA: ${(state.angleOfAttack * 180 / Math.PI).toFixed(1)}°
                ` : ''}
            `;
        }
    }

    async cleanup(): Promise<void> {
        this.stop();
        
        if (this.renderer) {
            await this.renderer.cleanup();
        }
        
        if (this.input) {
            this.input.cleanup();
        }
        
        if (this.world) {
            this.world.cleanup();
        }
        
        this.eventBus.clear();
        this.initialized = false;
        
        console.log('Engine cleanup complete');
    }

    getRenderer(): WebGPURenderer | null {
        return this.renderer;
    }

    getPhysics(): FlightDynamics | null {
        return this.physics;
    }

    getInput(): InputManager | null {
        return this.input;
    }

    getWorld(): WorldManager | null {
        return this.world;
    }
}