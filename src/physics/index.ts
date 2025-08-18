/**
 * Physics Module - Flight Dynamics and Simulation
 * 
 * This module provides a comprehensive flight physics simulation system
 * with accurate aerodynamics, propulsion, and 6DOF rigid body dynamics.
 */

// Main flight dynamics engine
export { FlightDynamics } from './FlightDynamics';
export type { AircraftConfig, WeatherConditions } from './FlightDynamics';

// Core physics systems
export { RigidBody } from './RigidBody';
export { Aerodynamics } from './Aerodynamics';
export type { AerodynamicConfig, AerodynamicForces, AircraftAeroState } from './Aerodynamics';
export { Atmosphere } from './Atmosphere';
export type { AtmosphericProperties } from './Atmosphere';

// Propulsion systems
export { 
    PropulsionSystem, 
    Engine,
    JetEngine, 
    PistonEngine
} from './Propulsion';
export type {
    JetEngineConfig,
    PistonEngineConfig 
} from './Propulsion';

// Control systems
export { 
    ControlSurfaceSystem
} from './ControlSurfaces';
export type {
    ControlSurfaceConfig,
    ControlInputs,
    TrimSettings,
    ControlSurfaceState,
    ControlSurfaceAngles
} from './ControlSurfaces';

// Aircraft state management
export { AircraftState } from './AircraftState';
export type { AircraftStateSummary } from './AircraftState';

/**
 * Quick Start Example:
 * 
 * ```typescript
 * import { FlightDynamics } from './physics';
 * 
 * // Create flight dynamics with default Cessna 172 config
 * const dynamics = new FlightDynamics();
 * 
 * // Start engines
 * dynamics.startEngines();
 * 
 * // Set controls
 * dynamics.setControls({
 *     aileron: 0,
 *     elevator: 0.1,
 *     rudder: 0,
 *     flaps: 0,
 *     gear: 1
 * });
 * 
 * // Set throttle
 * dynamics.setThrottle(0.75);
 * 
 * // Update physics (60 FPS example)
 * const interpolation = dynamics.update(1/60);
 * 
 * // Get aircraft state
 * const state = dynamics.getState();
 * console.log(`Altitude: ${state.altitude}m`);
 * console.log(`Airspeed: ${state.indicatedAirspeed}m/s`);
 * console.log(`Heading: ${state.heading * 180/Math.PI}°`);
 * ```
 */

/**
 * Advanced Configuration Example:
 * 
 * ```typescript
 * const jetConfig: AircraftConfig = {
 *     name: "Boeing 737-800",
 *     type: "airliner",
 *     mass: {
 *         empty: 41413,
 *         maxFuel: 20894,
 *         maxTakeoff: 79015
 *     },
 *     centerOfGravity: { x: 0, y: 0, z: -0.25 },
 *     inertia: {
 *         ixx: 2470000,
 *         iyy: 4490000,
 *         izz: 6730000
 *     },
 *     aerodynamics: {
 *         wingArea: 124.6,
 *         wingSpan: 34.32,
 *         meanChord: 3.95,
 *         oswaldsEfficiency: 0.8
 *     },
 *     engines: [
 *         {
 *             type: 'jet',
 *             position: { x: -2.5, y: -1.2, z: 5.3 },
 *             orientation: { x: 1, y: 0, z: 0 },
 *             maxThrust: 117000,
 *             bypassRatio: 5.1
 *         },
 *         {
 *             type: 'jet',
 *             position: { x: -2.5, y: -1.2, z: -5.3 },
 *             orientation: { x: 1, y: 0, z: 0 },
 *             maxThrust: 117000,
 *             bypassRatio: 5.1
 *         }
 *     ]
 * };
 * 
 * const dynamics = new FlightDynamics(jetConfig);
 * ```
 */