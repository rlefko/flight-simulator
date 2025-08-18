export enum SystemEvent {
    ENGINE_START = 'engine:start',
    ENGINE_STOP = 'engine:stop',
    ENGINE_PAUSE = 'engine:pause',
    ENGINE_RESUME = 'engine:resume',
    ENGINE_UPDATE = 'engine:update',
    ENGINE_FIXED_UPDATE = 'engine:fixed_update',
    ENGINE_LATE_UPDATE = 'engine:late_update',
    ENGINE_RENDER = 'engine:render',
    
    PHYSICS_START = 'physics:start',
    PHYSICS_STEP = 'physics:step',
    PHYSICS_COLLISION = 'physics:collision',
    
    INPUT_KEY_DOWN = 'input:key_down',
    INPUT_KEY_UP = 'input:key_up',
    INPUT_MOUSE_MOVE = 'input:mouse_move',
    INPUT_MOUSE_DOWN = 'input:mouse_down',
    INPUT_MOUSE_UP = 'input:mouse_up',
    INPUT_MOUSE_WHEEL = 'input:mouse_wheel',
    INPUT_GAMEPAD_CONNECTED = 'input:gamepad_connected',
    INPUT_GAMEPAD_DISCONNECTED = 'input:gamepad_disconnected',
    INPUT_GAMEPAD_BUTTON = 'input:gamepad_button',
    INPUT_GAMEPAD_AXIS = 'input:gamepad_axis',
    
    AIRCRAFT_SPAWN = 'aircraft:spawn',
    AIRCRAFT_DESPAWN = 'aircraft:despawn',
    AIRCRAFT_ENGINE_START = 'aircraft:engine_start',
    AIRCRAFT_ENGINE_STOP = 'aircraft:engine_stop',
    AIRCRAFT_GEAR_UP = 'aircraft:gear_up',
    AIRCRAFT_GEAR_DOWN = 'aircraft:gear_down',
    AIRCRAFT_FLAPS_CHANGE = 'aircraft:flaps_change',
    AIRCRAFT_AUTOPILOT_ENGAGE = 'aircraft:autopilot_engage',
    AIRCRAFT_AUTOPILOT_DISENGAGE = 'aircraft:autopilot_disengage',
    
    WORLD_CHUNK_LOAD = 'world:chunk_load',
    WORLD_CHUNK_UNLOAD = 'world:chunk_unload',
    WORLD_LOD_CHANGE = 'world:lod_change',
    
    WEATHER_UPDATE = 'weather:update',
    WEATHER_CHANGE = 'weather:change',
    
    RENDER_RESIZE = 'render:resize',
    RENDER_QUALITY_CHANGE = 'render:quality_change',
    RENDER_SCREENSHOT = 'render:screenshot',
    
    UI_MENU_OPEN = 'ui:menu_open',
    UI_MENU_CLOSE = 'ui:menu_close',
    UI_DIALOG_OPEN = 'ui:dialog_open',
    UI_DIALOG_CLOSE = 'ui:dialog_close',
    
    NETWORK_CONNECT = 'network:connect',
    NETWORK_DISCONNECT = 'network:disconnect',
    NETWORK_MESSAGE = 'network:message',
    
    PERFORMANCE_WARNING = 'performance:warning',
    PERFORMANCE_CRITICAL = 'performance:critical',
    
    ERROR = 'system:error',
    WARNING = 'system:warning',
    INFO = 'system:info',
}

export interface KeyEvent {
    key: string;
    code: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

export interface MouseEvent {
    x: number;
    y: number;
    deltaX?: number;
    deltaY?: number;
    button?: number;
    buttons?: number;
}

export interface GamepadButtonEvent {
    gamepadIndex: number;
    buttonIndex: number;
    value: number;
    pressed: boolean;
}

export interface GamepadAxisEvent {
    gamepadIndex: number;
    axisIndex: number;
    value: number;
}

export interface CollisionEvent {
    bodyA: any;
    bodyB: any;
    contactPoint: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    impulse: number;
}

export interface EngineUpdateEvent {
    deltaTime: number;
    totalTime: number;
    frameCount: number;
}

export interface ChunkEvent {
    x: number;
    z: number;
    lod: number;
}

export interface WeatherUpdateEvent {
    temperature: number;
    pressure: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    visibility: number;
    cloudCoverage: number;
    precipitation: number;
}