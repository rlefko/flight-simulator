/**
 * Example usage of the WebGPU Rendering Pipeline
 * This file demonstrates how to initialize and use the complete rendering system
 */

import { EventBus } from '../core/events/EventBus';
import { Vector3 } from '../core/math';
import { WebGPURenderer, RenderLoop, CameraMode } from './index';

export class FlightSimRenderer {
    private canvas: HTMLCanvasElement;
    private eventBus: EventBus;
    private renderer: WebGPURenderer;
    private renderLoop: RenderLoop;
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.eventBus = new EventBus();
        
        // Create renderer with flight sim optimized settings
        this.renderer = new WebGPURenderer(this.canvas, this.eventBus);
        
        // Create render loop with performance-focused settings
        this.renderLoop = new RenderLoop(this.renderer, this.eventBus, {
            targetFPS: 60,
            vSync: true,
            adaptiveSync: true,
            performanceMode: 'balanced',
        });
        
        this.setupEventHandlers();
    }
    
    async initialize(): Promise<void> {
        try {
            // Initialize the renderer (will fall back to WebGL2 if WebGPU fails)
            await this.renderer.initialize();
            
            // Configure camera for flight simulation
            const camera = this.renderer.getCamera();
            camera.setMode(CameraMode.EXTERNAL);
            camera.setPosition(new Vector3(0, 10, 50));
            camera.setTarget(new Vector3(0, 0, 0));
            camera.setFOV(75); // Wide field of view for flight sim
            camera.setNearFar(0.1, 100000); // Extended far plane for terrain
            
            // Set quality settings optimized for flight simulation
            this.renderer.setQualitySettings({
                shadowMapSize: 4096,
                msaaSamples: 4,
                anisotropicFiltering: 16,
                tessellationLevel: 8,
                lodBias: 0,
                enablePostProcessing: true,
                enableVolumetricFog: true,
                enableSSR: true,
                enableSSAO: true,
            });
            
            console.log('Flight simulator renderer initialized successfully');
            console.log('Capabilities:', this.renderer.getCapabilities());
            
        } catch (error) {
            console.error('Failed to initialize renderer:', error);
            throw error;
        }
    }
    
    start(): void {
        this.renderLoop.start();
    }
    
    stop(): void {
        this.renderLoop.stop();
    }
    
    // Update camera based on aircraft state
    updateCamera(aircraftPosition: Vector3, aircraftRotation: any, cameraMode: CameraMode = CameraMode.EXTERNAL): void {
        const camera = this.renderer.getCamera();
        
        camera.setMode(cameraMode);
        
        switch (cameraMode) {
            case CameraMode.COCKPIT:
                // Inside the aircraft
                camera.setPosition(aircraftPosition.clone().add(new Vector3(0, 1.5, 0)));
                camera.setTarget(aircraftPosition.clone().add(new Vector3(0, 1.5, -10)));
                break;
                
            case CameraMode.EXTERNAL:
                // External orbital camera
                const distance = 50;
                const height = 10;
                camera.setTarget(aircraftPosition);
                camera.setPosition(aircraftPosition.clone().add(new Vector3(
                    distance * Math.sin(Date.now() * 0.001),
                    height,
                    distance * Math.cos(Date.now() * 0.001)
                )));
                break;
                
            case CameraMode.CHASE:
                // Behind the aircraft
                const offset = new Vector3(0, 5, 25);
                camera.setPosition(aircraftPosition.clone().add(offset));
                camera.setTarget(aircraftPosition);
                break;
                
            case CameraMode.TOWER:
                // Fixed tower view
                camera.setPosition(new Vector3(0, 20, 100));
                camera.setTarget(aircraftPosition);
                break;
        }
    }
    
    // Simulate turbulence effects
    addTurbulence(intensity: number): void {
        const camera = this.renderer.getCamera();
        camera.addShake(intensity);
    }
    
    // Handle window resize
    resize(width: number, height: number): void {
        this.renderer.resize(width, height);
    }
    
    private setupEventHandlers(): void {
        // Performance monitoring
        this.eventBus.on('render-loop:stats', (stats) => {
            // Update UI with performance stats
            console.log(`FPS: ${stats.fps.toFixed(1)}, Frame: ${stats.frameNumber}`);
        });
        
        // Error handling
        this.eventBus.on('renderer:error', (error) => {
            console.error('Rendering error:', error);
            // Could trigger fallback modes or quality reduction
        });
        
        // Device lost handling
        this.eventBus.on('renderer:device-lost', () => {
            console.warn('Graphics device lost, attempting recovery...');
            // Could trigger reinitialization or graceful degradation
        });
        
        // Quality adaptation based on performance
        this.eventBus.on('render-loop:stats', (stats) => {
            if (stats.fps < 30 && stats.frameNumber > 60) {
                // Reduce quality if FPS is consistently low
                console.warn('Performance degraded, reducing quality settings');
                this.renderer.setQualitySettings({
                    shadowMapSize: 2048,
                    msaaSamples: 2,
                    enableSSAO: false,
                });
            }
        });
        
        // Camera controls
        this.setupCameraControls();
    }
    
    private setupCameraControls(): void {
        let isMouseDown = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
        this.canvas.addEventListener('mousedown', (event) => {
            isMouseDown = true;
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
            this.canvas.style.cursor = 'grabbing';
        });
        
        this.canvas.addEventListener('mouseup', () => {
            isMouseDown = false;
            this.canvas.style.cursor = 'grab';
        });
        
        this.canvas.addEventListener('mousemove', (event) => {
            if (!isMouseDown) return;
            
            const deltaX = event.clientX - lastMouseX;
            const deltaY = event.clientY - lastMouseY;
            
            const camera = this.renderer.getCamera();
            camera.orbit(deltaX * 0.5, deltaY * 0.5);
            
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
        });
        
        this.canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const camera = this.renderer.getCamera();
            camera.zoom(event.deltaY * 0.001);
        });
        
        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            const camera = this.renderer.getCamera();
            
            switch (event.key) {
                case '1':
                    camera.setMode(CameraMode.COCKPIT);
                    break;
                case '2':
                    camera.setMode(CameraMode.EXTERNAL);
                    break;
                case '3':
                    camera.setMode(CameraMode.CHASE);
                    break;
                case '4':
                    camera.setMode(CameraMode.TOWER);
                    break;
                case 't':
                    this.addTurbulence(2.0);
                    break;
            }
        });
    }
    
    getRenderer(): WebGPURenderer {
        return this.renderer;
    }
    
    getRenderLoop(): RenderLoop {
        return this.renderLoop;
    }
    
    getEventBus(): EventBus {
        return this.eventBus;
    }
    
    destroy(): void {
        this.renderLoop.stop();
        this.renderer.destroy();
        this.eventBus.clear();
    }
}

// Usage example:
/*
const canvas = document.getElementById('flight-sim-canvas') as HTMLCanvasElement;
const flightRenderer = new FlightSimRenderer(canvas);

async function initFlightSim() {
    try {
        await flightRenderer.initialize();
        flightRenderer.start();
        
        // Simulate aircraft movement
        setInterval(() => {
            const time = Date.now() * 0.001;
            const aircraftPos = new Vector3(
                Math.sin(time * 0.1) * 100,
                Math.sin(time * 0.2) * 20 + 50,
                Math.cos(time * 0.1) * 100
            );
            
            flightRenderer.updateCamera(aircraftPos, null, CameraMode.EXTERNAL);
        }, 16); // 60 FPS
        
    } catch (error) {
        console.error('Failed to start flight simulator:', error);
    }
}

initFlightSim();
*/