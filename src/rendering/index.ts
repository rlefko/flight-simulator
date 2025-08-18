// Main rendering system exports
export { WebGPURenderer } from './WebGPURenderer';
export type {
    WebGPURenderingCapabilities,
    QualitySettings,
    RenderStats,
} from './WebGPURenderer';

export { Camera, CameraMode } from './Camera';
export type {
    CameraConfiguration,
    FlightCameraControls,
    ViewFrustum,
} from './Camera';

export { RenderLoop } from './RenderLoop';
export type { FrameData } from './RenderLoop';

export { WebGL2Fallback } from './WebGL2Fallback';

// Pipeline exports
export { RenderPipeline } from './pipeline/RenderPipeline';
export { ShaderManager } from './pipeline/ShaderManager';
export type { ShaderBindingInfo, ShaderInfo } from './pipeline/ShaderManager';

export { UniformBufferManager } from './pipeline/UniformBufferManager';
export {
    CameraUniformsLayout,
    ModelUniformsLayout,
    MaterialUniformsLayout,
    LightingUniformsLayout,
} from './pipeline/UniformBufferManager';

// Usage example and factory functions
export function createWebGPURenderer(
    canvas: HTMLCanvasElement,
    eventBus: any, // Import EventBus type from core/events
    options: Partial<QualitySettings> = {}
): WebGPURenderer {
    return new WebGPURenderer(canvas, eventBus);
}

export function createRenderLoop(
    renderer: WebGPURenderer,
    eventBus: any,
    options = {}
): RenderLoop {
    return new RenderLoop(renderer, eventBus, options);
}