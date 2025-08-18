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
            canvas: config.canvas || (document.getElementById('canvas') as HTMLCanvasElement),
            fixedTimeStep: config.fixedTimeStep || 1 / 120,
            maxSubSteps: config.maxSubSteps || 10,
            targetFPS: config.targetFPS || 60,
            enableStats: config.enableStats ?? true,
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

            this.renderer = new WebGPURenderer(this.config.canvas, this.eventBus);
            await this.renderer.initialize();
            console.log('Renderer initialized');

            const aircraftConfig = {
                name: 'Cessna 172',
                type: 'general_aviation',
                mass: {
                    empty: 680,
                    maxFuel: 200,
                    maxTakeoff: 1111,
                },
                aerodynamics: {
                    wingArea: 16.2,
                    wingSpan: 11,
                    meanChord: 1.47,
                    oswaldsEfficiency: 0.75,
                },
                controlSurfaces: {
                    limits: {
                        aileron: 20,
                        elevator: 25,
                        rudder: 25,
                        flaps: [0, 10, 20, 30],
                    },
                },
                inertia: {
                    ixx: 1285,
                    iyy: 1825,
                    izz: 2667,
                    ixy: 0,
                    ixz: 0,
                    iyz: 0,
                },
                centerOfGravity: { x: 0, y: 0, z: -0.1 },
                engines: [
                    {
                        type: 'piston' as const,
                        position: { x: 2, y: 0, z: 0 },
                        orientation: { x: 1, y: 0, z: 0 },
                        maxPower: 134000,
                        propDiameter: 1.9,
                        maxRPM: 2700,
                    },
                ],
            };

            this.physics = new FlightDynamics(aircraftConfig);
            this.physics.reset(new Vector3(0, 1000, 0), 0);
            console.log('Physics initialized');

            this.input = InputManager.getInstance();

            // Register keyboard controller
            const { KeyboardController } = await import('@controls/KeyboardController');
            const { InputDeviceType } = await import('@controls/InputManager');
            const keyboardController = new KeyboardController();
            this.input.registerController(InputDeviceType.KEYBOARD, keyboardController);

            this.input.start();
            console.log('Input system initialized');

            this.world = new WorldManager();
            await this.world.initialize();
            console.log('World system initialized');

            this.setupEventHandlers();

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
                // Get current canvas dimensions and call resize
                const canvas = this.config.canvas;
                this.renderer.resize(canvas.width, canvas.height);
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
        console.log('start(): begin');
        if (!this.initialized) {
            console.log('start(): engine not initialized, throwing error');
            throw new Error('Engine must be initialized before starting');
        }
        console.log('start(): engine is initialized');

        if (this.isRunning) {
            console.warn('Engine already running');
            return;
        }
        console.log('start(): engine not already running, proceeding');

        this.isRunning = true;
        this.lastTime = performance.now();
        this.accumulator = 0;

        console.log('Starting engine main loop');
        console.log('start(): scheduling gameLoop with time:', this.lastTime);

        // Use setTimeout to ensure the first gameLoop call is asynchronous
        // This prevents blocking the main thread during initialization
        setTimeout(() => {
            console.log('start(): calling gameLoop from setTimeout');
            this.gameLoop(this.lastTime);
        }, 0);

        console.log('start(): method complete, gameLoop scheduled');
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
        try {
            if (!this.isRunning) return;

            // Schedule next frame
            this.rafId = requestAnimationFrame(this.gameLoop);

            if (this.isPaused) return;

            const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.25);
            this.lastTime = currentTime;

            // Test: Re-enable update and lateUpdate (but not fixedUpdate)
            this.update(deltaTime);
            this.lateUpdate(deltaTime);
            this.render(deltaTime);

            this.frameCount++;

            // Log every 300 frames
            if (this.frameCount % 300 === 0) {
                console.log('Frame:', this.frameCount);
            }
        } catch (error) {
            console.error('Error in game loop:', error);
            this.stop();
        }
    };

    private fixedUpdate(deltaTime: number): void {
        // DISABLED FOR DEBUGGING - Physics update might be causing memory leak
        /*
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount
        };
        
        this.eventBus.emit(SystemEvent.ENGINE_FIXED_UPDATE, updateEvent);
        
        if (this.physics) {
            this.physics.update(deltaTime);
            const state = this.physics.getState();
            if (this.world && state) {
                // World will be updated in the update loop with camera position
            }
        }
        */
    }

    private update(deltaTime: number): void {
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount,
        };

        this.eventBus.emit(SystemEvent.ENGINE_UPDATE, updateEvent);

        // Update camera based on input
        if (this.input && this.renderer) {
            const camera = this.renderer.getCamera();
            if (camera) {
                const speed = 500 * deltaTime; // Units per second
                const position = camera.getPosition();

                // Simple WASD camera movement
                const inputState = this.input.getInputState();
                if (inputState.keys.has('KeyW')) {
                    position.z -= speed;
                }
                if (inputState.keys.has('KeyS')) {
                    position.z += speed;
                }
                if (inputState.keys.has('KeyA')) {
                    position.x -= speed;
                }
                if (inputState.keys.has('KeyD')) {
                    position.x += speed;
                }
                if (inputState.keys.has('KeyQ')) {
                    position.y -= speed;
                }
                if (inputState.keys.has('KeyE')) {
                    position.y += speed;
                }

                camera.setPosition(position);
                camera.setTarget(new Vector3(position.x, position.y - 100, position.z - 500));
            }
        }

        // Update world with camera position
        if (this.world && this.renderer) {
            const camera = this.renderer.getCamera();
            if (camera) {
                const position = camera.getPosition();
                this.world.update(position, null, deltaTime);
            }
        }
    }

    private lateUpdate(deltaTime: number): void {
        const updateEvent: EngineUpdateEvent = {
            deltaTime,
            totalTime: this.totalTime,
            frameCount: this.frameCount,
        };

        this.eventBus.emit(SystemEvent.ENGINE_LATE_UPDATE, updateEvent);
    }

    private render(interpolation: number): void {
        if (!this.renderer) return;

        this.eventBus.emit(SystemEvent.ENGINE_RENDER, { interpolation });

        // Pass terrain tiles to renderer
        if (this.world && this.renderer) {
            const terrainTiles = this.world.getRenderableTerrain();
            (this.renderer as any).setTerrainTiles?.(terrainTiles);
        }

        // Render the frame
        try {
            this.renderer.render(interpolation);
        } catch (error) {
            console.error('Render error:', error);
        }
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
                ${
                    state
                        ? `
                    Alt: ${state.altitude.toFixed(0)} ft<br>
                    IAS: ${state.airspeed.indicated.toFixed(0)} kts<br>
                    HDG: ${((state.heading * 180) / Math.PI).toFixed(0)}°<br>
                    AOA: ${((state.angleOfAttack * 180) / Math.PI).toFixed(1)}°
                `
                        : ''
                }
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
