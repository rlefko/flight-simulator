/**
 * Flight Dynamics Demo
 * Demonstrates the physics system with a simple takeoff scenario
 */

import { FlightDynamics } from './FlightDynamics';
import { Vector3 } from '../core/math/Vector3';

// Create flight dynamics system
const dynamics = new FlightDynamics();

// Reset to runway position
dynamics.reset(new Vector3(0, 0, 0), 0); // Start at origin, facing north

// Start engines
console.log('Starting engines...');
if (dynamics.startEngines()) {
    console.log('Engines started successfully');
} else {
    console.log('Failed to start engines');
}

// Configure for takeoff
dynamics.setControls({
    aileron: 0,
    elevator: 0,
    rudder: 0,
    flaps: 0.25, // 25% flaps for takeoff
    gear: 1      // Gear down
});

// Simulation parameters
const targetFPS = 60;
const frameTime = 1 / targetFPS;
let simulationTime = 0;
let frameCount = 0;

// Takeoff sequence
console.log('\n=== TAKEOFF SEQUENCE ===\n');

// Function to format state output
function logState(time: number): void {
    const state = dynamics.getState();
    const summary = state.getSummary();
    
    console.log(`Time: ${time.toFixed(1)}s`);
    console.log(`  Position: (${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}) m`);
    console.log(`  Altitude: ${summary.position.alt.toFixed(1)} m AGL: ${state.altitudeAGL.toFixed(1)} m`);
    console.log(`  Speeds: IAS: ${summary.speeds.indicated.toFixed(1)} m/s, GS: ${summary.speeds.ground.toFixed(1)} m/s`);
    console.log(`  Attitude: Pitch: ${summary.attitude.pitch.toFixed(1)}°, Roll: ${summary.attitude.roll.toFixed(1)}°`);
    console.log(`  AOA: ${summary.angles.aoa.toFixed(1)}°, G-Load: ${summary.loads.g.toFixed(2)}`);
    console.log(`  Status: ${state.onGround ? 'ON GROUND' : 'AIRBORNE'} ${state.stalled ? 'STALLED' : ''}`);
    console.log('---');
}

// Initial state
logState(0);

// Phase 1: Engine run-up (2 seconds)
console.log('\nPhase 1: Engine run-up');
dynamics.setThrottle(0.5);
for (let i = 0; i < 120; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
}
logState(simulationTime);

// Phase 2: Full throttle for takeoff roll (5 seconds)
console.log('\nPhase 2: Full throttle takeoff roll');
dynamics.setThrottle(1.0);
for (let i = 0; i < 300; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
    
    // Log every second
    if (i % 60 === 0) {
        logState(simulationTime);
    }
}

// Phase 3: Rotation (pull back on stick)
console.log('\nPhase 3: Rotation');
dynamics.setControls({
    aileron: 0,
    elevator: 0.3, // Pull back
    rudder: 0,
    flaps: 0.25,
    gear: 1
});

for (let i = 0; i < 120; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
    
    if (i % 30 === 0) {
        logState(simulationTime);
    }
}

// Phase 4: Initial climb
console.log('\nPhase 4: Initial climb');
dynamics.setControls({
    aileron: 0,
    elevator: 0.15, // Reduce back pressure
    rudder: 0,
    flaps: 0.25,
    gear: 0 // Retract gear
});

for (let i = 0; i < 300; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
    
    if (i % 60 === 0) {
        logState(simulationTime);
    }
}

// Phase 5: Clean up and continue climb
console.log('\nPhase 5: Clean configuration climb');
dynamics.setControls({
    aileron: 0,
    elevator: 0.1,
    rudder: 0,
    flaps: 0, // Retract flaps
    gear: 0
});

dynamics.setThrottle(0.85); // Reduce to climb power

for (let i = 0; i < 300; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
    
    if (i % 60 === 0) {
        logState(simulationTime);
    }
}

// Final summary
console.log('\n=== FLIGHT SUMMARY ===');
const finalState = dynamics.getState();
const finalSummary = finalState.getSummary();
console.log(`Total simulation time: ${simulationTime.toFixed(1)} seconds`);
console.log(`Final altitude: ${finalSummary.position.alt.toFixed(1)} meters`);
console.log(`Final airspeed: ${finalSummary.speeds.indicated.toFixed(1)} m/s`);
console.log(`Final heading: ${finalSummary.attitude.heading.toFixed(1)}°`);
console.log(`Distance traveled: ${Math.sqrt(finalState.position.x * finalState.position.x + finalState.position.z * finalState.position.z).toFixed(1)} meters`);

// Test stall behavior
console.log('\n=== STALL TEST ===');
console.log('Reducing throttle and increasing angle of attack...');

dynamics.setThrottle(0.0);
dynamics.setControls({
    aileron: 0,
    elevator: 1.0, // Full back stick
    rudder: 0,
    flaps: 0,
    gear: 0
});

for (let i = 0; i < 300; i++) {
    dynamics.update(frameTime);
    simulationTime += frameTime;
    
    if (i % 60 === 0) {
        const state = dynamics.getState();
        const summary = state.getSummary();
        console.log(`Time: ${simulationTime.toFixed(1)}s - IAS: ${summary.speeds.indicated.toFixed(1)} m/s, AOA: ${summary.angles.aoa.toFixed(1)}°, ${state.stalled ? 'STALLED' : 'OK'}`);
    }
}

console.log('\nDemo complete!');