import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    HydraulicsDisplayData,
    HydraulicSystemData,
    HydraulicReservoirData,
    AccumulatorData,
    HydraulicConfig,
    AlertData 
} from './InstrumentData';

/**
 * Comprehensive hydraulic system simulation
 * Models pressure generation, distribution, and actuator control
 */

export interface HydraulicPump {
    name: string;
    type: 'ENGINE' | 'ELECTRIC' | 'MANUAL' | 'RAT';
    system: string;
    status: SystemStatus;
    engineNumber?: number;
    pressure: number;           // PSI
    flow: number;               // GPM
    temperature: number;        // degrees C
    rpm: number;                // pump RPM
    efficiency: number;         // 0-1
    ratedPressure: number;      // PSI
    ratedFlow: number;          // GPM
    casePressure: number;       // PSI
    overridePressure: number;   // PSI for engine failure
    bypassValve: boolean;
    enabled: boolean;
    faults: string[];
}

export interface HydraulicReservoir {
    name: string;
    system: string;
    quantity: number;           // quarts
    capacity: number;           // quarts
    temperature: number;        // degrees C
    pressure: number;           // PSI (pressurization)
    level: number;              // 0-1
    lowLevelWarning: number;    // quarts
    filters: {
        return: FilterStatus;
        suction: FilterStatus;
    };
    airSeparator: boolean;
    overheatWarning: number;    // degrees C
}

export interface FilterStatus {
    differential: number;       // PSI
    bypassActive: boolean;
    changeRequired: boolean;
}

export interface HydraulicAccumulator {
    name: string;
    system: string;
    pressure: number;           // PSI
    precharge: number;          // PSI nitrogen
    capacity: number;           // cubic inches
    temperature: number;        // degrees C
    nitrogenLeakage: number;    // PSI per hour
    bladderIntegrity: boolean;
}

export interface HydraulicActuator {
    name: string;
    system: string;
    type: 'LINEAR' | 'ROTARY';
    position: number;           // 0-1 or degrees
    targetPosition: number;
    velocity: number;           // units per second
    force: number;              // lbs or ft-lbs
    pressure: {
        extend: number;         // PSI
        retract: number;        // PSI
    };
    area: {
        extend: number;         // square inches
        retract: number;        // square inches
    };
    stroke: number;             // inches or degrees
    leakage: number;            // GPM internal leakage
    friction: number;           // friction coefficient
    response: number;           // response time constant
}

export interface HydraulicValve {
    name: string;
    type: 'SHUTOFF' | 'RELIEF' | 'CHECK' | 'PRIORITY' | 'SELECTOR';
    position: number;           // 0-1
    pressure: {
        inlet: number;          // PSI
        outlet: number;         // PSI
    };
    flow: number;               // GPM
    crackPressure: number;      // PSI
    fullOpenPressure: number;   // PSI
    leakage: number;            // GPM
    automated: boolean;
    failed: boolean;
}

export interface SystemPriority {
    name: string;
    priority: number;           // 1=highest
    minPressure: number;        // PSI
    normalPressure: number;     // PSI
    shutoffPressure: number;    // PSI
}

export class HydraulicSystem {
    private config: HydraulicConfig;
    private systems: Map<string, {
        pressure: number;
        flow: number;
        temperature: number;
        status: SystemStatus;
    }> = new Map();
    
    private pumps: Map<string, HydraulicPump> = new Map();
    private reservoirs: Map<string, HydraulicReservoir> = new Map();
    private accumulators: Map<string, HydraulicAccumulator> = new Map();
    private actuators: Map<string, HydraulicActuator> = new Map();
    private valves: Map<string, HydraulicValve> = new Map();
    private priorities: Map<string, SystemPriority[]> = new Map();
    
    private alerts: AlertData[] = [];
    private engineRpm: number[] = [0, 0, 0, 0];
    private electricalPower: boolean[] = [false, false, false];
    private ratDeployed: boolean = false;
    private airspeed: number = 0;

    // System constants
    private readonly FLUID_DENSITY = 0.85; // specific gravity
    private readonly BULK_MODULUS = 300000; // PSI
    private readonly VISCOSITY_INDEX = 100;
    private readonly MIN_OPERATING_TEMP = -40; // degrees C
    private readonly MAX_OPERATING_TEMP = 135; // degrees C

    constructor(config: HydraulicConfig) {
        this.config = config;
        this.initializeSystem();
    }

    /**
     * Initialize hydraulic system components
     */
    private initializeSystem(): void {
        this.initializeSystems();
        this.initializePumps();
        this.initializeReservoirs();
        this.initializeAccumulators();
        this.initializeActuators();
        this.initializeValves();
        this.initializePriorities();
    }

    private initializeSystems(): void {
        const systemNames = ['A', 'B', 'C'].slice(0, this.config.systems.count);
        
        systemNames.forEach(name => {
            this.systems.set(name, {
                pressure: 0,
                flow: 0,
                temperature: 20,
                status: SystemStatus.OFF
            });
        });
    }

    private initializePumps(): void {
        const systemNames = Array.from(this.systems.keys());
        
        // Engine-driven pumps
        systemNames.forEach((system, index) => {
            if (index < this.config.pumps.engine) {
                const pump: HydraulicPump = {
                    name: `ENG ${index + 1} PUMP ${system}`,
                    type: 'ENGINE',
                    system,
                    status: SystemStatus.OFF,
                    engineNumber: index + 1,
                    pressure: 0,
                    flow: 0,
                    temperature: 20,
                    rpm: 0,
                    efficiency: 0.85,
                    ratedPressure: this.config.systems.pressure,
                    ratedFlow: 30, // GPM
                    casePressure: 0,
                    overridePressure: this.config.systems.pressure,
                    bypassValve: false,
                    enabled: true,
                    faults: []
                };
                this.pumps.set(pump.name, pump);
            }
        });

        // Electric pumps
        systemNames.forEach((system, index) => {
            if (index < this.config.pumps.electric) {
                const pump: HydraulicPump = {
                    name: `ELEC PUMP ${system}`,
                    type: 'ELECTRIC',
                    system,
                    status: SystemStatus.OFF,
                    pressure: 0,
                    flow: 0,
                    temperature: 20,
                    rpm: 0,
                    efficiency: 0.80,
                    ratedPressure: this.config.systems.pressure,
                    ratedFlow: 20, // GPM
                    casePressure: 0,
                    overridePressure: 0,
                    bypassValve: false,
                    enabled: false,
                    faults: []
                };
                this.pumps.set(pump.name, pump);
            }
        });

        // Manual pumps (backup)
        if (this.config.pumps.manual > 0) {
            const pump: HydraulicPump = {
                name: 'MANUAL PUMP',
                type: 'MANUAL',
                system: 'B', // Usually connected to system B
                status: SystemStatus.OFF,
                pressure: 0,
                flow: 0,
                temperature: 20,
                rpm: 0,
                efficiency: 0.70,
                ratedPressure: this.config.systems.pressure,
                ratedFlow: 5, // GPM
                casePressure: 0,
                overridePressure: 0,
                bypassValve: false,
                enabled: false,
                faults: []
            };
            this.pumps.set(pump.name, pump);
        }

        // RAT pump (if equipped)
        if (systemNames.length >= 3) {
            const pump: HydraulicPump = {
                name: 'RAT PUMP',
                type: 'RAT',
                system: 'C',
                status: SystemStatus.OFF,
                pressure: 0,
                flow: 0,
                temperature: 20,
                rpm: 0,
                efficiency: 0.75,
                ratedPressure: this.config.systems.pressure * 0.8,
                ratedFlow: 15, // GPM
                casePressure: 0,
                overridePressure: 0,
                bypassValve: false,
                enabled: false,
                faults: []
            };
            this.pumps.set(pump.name, pump);
        }
    }

    private initializeReservoirs(): void {
        const systemNames = Array.from(this.systems.keys());
        
        systemNames.forEach(system => {
            const reservoir: HydraulicReservoir = {
                name: `RESERVOIR ${system}`,
                system,
                quantity: this.config.systems.capacity,
                capacity: this.config.systems.capacity,
                temperature: 20,
                pressure: 35, // PSI pressurization
                level: 1.0,
                lowLevelWarning: this.config.systems.capacity * 0.15,
                filters: {
                    return: {
                        differential: 0,
                        bypassActive: false,
                        changeRequired: false
                    },
                    suction: {
                        differential: 0,
                        bypassActive: false,
                        changeRequired: false
                    }
                },
                airSeparator: true,
                overheatWarning: 105
            };
            this.reservoirs.set(reservoir.name, reservoir);
        });
    }

    private initializeAccumulators(): void {
        const systemNames = Array.from(this.systems.keys());
        
        systemNames.forEach(system => {
            const accumulator: HydraulicAccumulator = {
                name: `ACCUM ${system}`,
                system,
                pressure: this.config.systems.pressure * 0.9,
                precharge: this.config.systems.pressure * 0.6,
                capacity: 80, // cubic inches
                temperature: 20,
                nitrogenLeakage: 0.1, // PSI per hour
                bladderIntegrity: true
            };
            this.accumulators.set(accumulator.name, accumulator);
        });
    }

    private initializeActuators(): void {
        // Primary flight controls
        const primaryControls = [
            { name: 'AILERON L', system: 'A', stroke: 25, area: { extend: 15, retract: 12 } },
            { name: 'AILERON R', system: 'B', stroke: 25, area: { extend: 15, retract: 12 } },
            { name: 'ELEVATOR L', system: 'A', stroke: 20, area: { extend: 20, retract: 15 } },
            { name: 'ELEVATOR R', system: 'B', stroke: 20, area: { extend: 20, retract: 15 } },
            { name: 'RUDDER UPPER', system: 'A', stroke: 30, area: { extend: 18, retract: 14 } },
            { name: 'RUDDER LOWER', system: 'B', stroke: 30, area: { extend: 18, retract: 14 } }
        ];

        primaryControls.forEach(control => {
            const actuator: HydraulicActuator = {
                name: control.name,
                system: control.system,
                type: 'LINEAR',
                position: 0.5,
                targetPosition: 0.5,
                velocity: 0,
                force: 0,
                pressure: { extend: 0, retract: 0 },
                area: control.area,
                stroke: control.stroke,
                leakage: 0.01,
                friction: 0.02,
                response: 0.1
            };
            this.actuators.set(actuator.name, actuator);
        });

        // Secondary flight controls
        const secondaryControls = [
            { name: 'SPOILER 1', system: 'A', stroke: 45, area: { extend: 8, retract: 6 } },
            { name: 'SPOILER 2', system: 'B', stroke: 45, area: { extend: 8, retract: 6 } },
            { name: 'SPOILER 3', system: 'A', stroke: 45, area: { extend: 8, retract: 6 } },
            { name: 'SPOILER 4', system: 'B', stroke: 45, area: { extend: 8, retract: 6 } },
            { name: 'FLAP L', system: 'A', stroke: 60, area: { extend: 12, retract: 10 } },
            { name: 'FLAP R', system: 'B', stroke: 60, area: { extend: 12, retract: 10 } },
            { name: 'SLAT L', system: 'A', stroke: 30, area: { extend: 6, retract: 4 } },
            { name: 'SLAT R', system: 'B', stroke: 30, area: { extend: 6, retract: 4 } }
        ];

        secondaryControls.forEach(control => {
            const actuator: HydraulicActuator = {
                name: control.name,
                system: control.system,
                type: 'LINEAR',
                position: 0,
                targetPosition: 0,
                velocity: 0,
                force: 0,
                pressure: { extend: 0, retract: 0 },
                area: control.area,
                stroke: control.stroke,
                leakage: 0.005,
                friction: 0.015,
                response: 0.2
            };
            this.actuators.set(actuator.name, actuator);
        });

        // Landing gear
        const gearActuators = [
            { name: 'GEAR NOSE', system: 'A', stroke: 36, area: { extend: 25, retract: 20 } },
            { name: 'GEAR LEFT', system: 'B', stroke: 42, area: { extend: 30, retract: 25 } },
            { name: 'GEAR RIGHT', system: 'A', stroke: 42, area: { extend: 30, retract: 25 } },
            { name: 'GEAR DOORS', system: 'A', stroke: 20, area: { extend: 15, retract: 12 } }
        ];

        gearActuators.forEach(gear => {
            const actuator: HydraulicActuator = {
                name: gear.name,
                system: gear.system,
                type: 'LINEAR',
                position: 0, // 0 = up, 1 = down
                targetPosition: 0,
                velocity: 0,
                force: 0,
                pressure: { extend: 0, retract: 0 },
                area: gear.area,
                stroke: gear.stroke,
                leakage: 0.02,
                friction: 0.03,
                response: 0.3
            };
            this.actuators.set(actuator.name, actuator);
        });

        // Brakes
        const brakeActuators = [
            { name: 'BRAKE LEFT', system: 'A', area: { extend: 8, retract: 8 } },
            { name: 'BRAKE RIGHT', system: 'B', area: { extend: 8, retract: 8 } }
        ];

        brakeActuators.forEach(brake => {
            const actuator: HydraulicActuator = {
                name: brake.name,
                system: brake.system,
                type: 'LINEAR',
                position: 0,
                targetPosition: 0,
                velocity: 0,
                force: 0,
                pressure: { extend: 0, retract: 0 },
                area: brake.area,
                stroke: 2, // inches
                leakage: 0.001,
                friction: 0.01,
                response: 0.05
            };
            this.actuators.set(actuator.name, actuator);
        });
    }

    private initializeValves(): void {
        const systemNames = Array.from(this.systems.keys());
        
        systemNames.forEach(system => {
            // System isolation valves
            const isolationValve: HydraulicValve = {
                name: `ISOL ${system}`,
                type: 'SHUTOFF',
                position: 1.0, // Normally open
                pressure: { inlet: 0, outlet: 0 },
                flow: 0,
                crackPressure: 50,
                fullOpenPressure: 100,
                leakage: 0,
                automated: false,
                failed: false
            };
            this.valves.set(isolationValve.name, isolationValve);

            // Priority valves
            const priorityValve: HydraulicValve = {
                name: `PRIORITY ${system}`,
                type: 'PRIORITY',
                position: 0.5,
                pressure: { inlet: 0, outlet: 0 },
                flow: 0,
                crackPressure: this.config.systems.pressure * 0.85,
                fullOpenPressure: this.config.systems.pressure * 0.9,
                leakage: 0.01,
                automated: true,
                failed: false
            };
            this.valves.set(priorityValve.name, priorityValve);

            // Relief valves
            const reliefValve: HydraulicValve = {
                name: `RELIEF ${system}`,
                type: 'RELIEF',
                position: 0,
                pressure: { inlet: 0, outlet: 0 },
                flow: 0,
                crackPressure: this.config.systems.pressure * 1.1,
                fullOpenPressure: this.config.systems.pressure * 1.15,
                leakage: 0,
                automated: true,
                failed: false
            };
            this.valves.set(reliefValve.name, reliefValve);
        });
    }

    private initializePriorities(): void {
        const systemNames = Array.from(this.systems.keys());
        
        systemNames.forEach(system => {
            const priorities: SystemPriority[] = [
                {
                    name: 'PRIMARY_FLIGHT_CONTROLS',
                    priority: 1,
                    minPressure: this.config.systems.pressure * 0.8,
                    normalPressure: this.config.systems.pressure,
                    shutoffPressure: this.config.systems.pressure * 0.6
                },
                {
                    name: 'LANDING_GEAR',
                    priority: 2,
                    minPressure: this.config.systems.pressure * 0.7,
                    normalPressure: this.config.systems.pressure,
                    shutoffPressure: this.config.systems.pressure * 0.5
                },
                {
                    name: 'SECONDARY_FLIGHT_CONTROLS',
                    priority: 3,
                    minPressure: this.config.systems.pressure * 0.6,
                    normalPressure: this.config.systems.pressure,
                    shutoffPressure: this.config.systems.pressure * 0.4
                },
                {
                    name: 'BRAKES',
                    priority: 4,
                    minPressure: this.config.systems.pressure * 0.5,
                    normalPressure: this.config.systems.pressure,
                    shutoffPressure: this.config.systems.pressure * 0.3
                }
            ];
            this.priorities.set(system, priorities);
        });
    }

    /**
     * Update hydraulic system
     */
    public update(deltaTime: number, aircraftState: any, electricalStatus: any): void {
        this.updateInputs(aircraftState, electricalStatus);
        this.updatePumps(deltaTime);
        this.updateReservoirs(deltaTime);
        this.updateAccumulators(deltaTime);
        this.updateSystemPressures(deltaTime);
        this.updateActuators(deltaTime);
        this.updateValves(deltaTime);
        this.performPriorityManagement();
        this.checkAlerts();
    }

    private updateInputs(aircraftState: any, electricalStatus: any): void {
        if (aircraftState.engines) {
            this.engineRpm = aircraftState.engines.map((engine: any) => engine.n2 || 0);
        }
        
        if (electricalStatus.buses) {
            this.electricalPower = electricalStatus.buses
                .filter((bus: any) => bus.name.includes('MAIN') && bus.powered)
                .map(() => true);
        }
        
        this.airspeed = aircraftState.airspeed?.true || 0;
    }

    private updatePumps(deltaTime: number): void {
        this.pumps.forEach(pump => {
            this.updatePump(pump, deltaTime);
        });
    }

    private updatePump(pump: HydraulicPump, deltaTime: number): void {
        let targetRpm = 0;
        let powerAvailable = false;

        // Determine pump drive conditions
        switch (pump.type) {
            case 'ENGINE':
                if (pump.engineNumber && pump.engineNumber <= this.engineRpm.length) {
                    const engineRpm = this.engineRpm[pump.engineNumber - 1];
                    targetRpm = engineRpm * 1.5; // Gear ratio
                    powerAvailable = engineRpm > 1000;
                }
                break;

            case 'ELECTRIC':
                powerAvailable = pump.enabled && 
                    this.electricalPower.length > 0 && 
                    this.electricalPower[0];
                targetRpm = powerAvailable ? 3600 : 0;
                break;

            case 'MANUAL':
                targetRpm = pump.enabled ? 1800 : 0;
                powerAvailable = pump.enabled;
                break;

            case 'RAT':
                powerAvailable = this.ratDeployed && this.airspeed > 130;
                targetRpm = powerAvailable ? Math.min(4800, this.airspeed * 30) : 0;
                break;
        }

        // Update pump RPM with realistic acceleration
        const rpmAccel = 1000; // RPM per second
        const rpmDelta = Math.sign(targetRpm - pump.rpm) * Math.min(
            Math.abs(targetRpm - pump.rpm),
            rpmAccel * deltaTime / 1000
        );
        pump.rpm = Math.max(0, pump.rpm + rpmDelta);

        // Update pump status
        if (powerAvailable && pump.rpm > 500 && pump.faults.length === 0) {
            pump.status = SystemStatus.ON;
        } else {
            pump.status = SystemStatus.OFF;
        }

        // Calculate pump output
        if (pump.status === SystemStatus.ON) {
            const speedRatio = Math.min(1, pump.rpm / 3600);
            const efficiency = pump.efficiency * speedRatio;
            
            pump.flow = pump.ratedFlow * speedRatio * efficiency;
            
            // Pressure depends on system back pressure and pump curve
            const system = this.systems.get(pump.system);
            if (system) {
                const backPressure = system.pressure;
                const pressureRatio = Math.min(1, pump.flow / pump.ratedFlow);
                pump.pressure = Math.min(
                    pump.ratedPressure,
                    pump.ratedPressure * pressureRatio - backPressure * 0.1
                );
            }
        } else {
            pump.flow = 0;
            pump.pressure = 0;
        }

        // Update pump temperature
        const heatGeneration = pump.flow * pump.pressure * (1 - pump.efficiency) * 0.0001;
        const cooling = (pump.temperature - 20) * 0.1;
        pump.temperature += (heatGeneration - cooling) * deltaTime / 1000;

        // Check for bypass valve operation
        if (pump.pressure < pump.ratedPressure * 0.5 && pump.status === SystemStatus.ON) {
            pump.bypassValve = true;
        } else {
            pump.bypassValve = false;
        }

        // Case pressure (indicates internal leakage)
        pump.casePressure = pump.pressure * 0.02 + pump.temperature * 0.1;
    }

    private updateReservoirs(deltaTime: number): void {
        this.reservoirs.forEach(reservoir => {
            this.updateReservoir(reservoir, deltaTime);
        });
    }

    private updateReservoir(reservoir: HydraulicReservoir, deltaTime: number): void {
        // Calculate fluid usage/return from pumps and actuators
        let netFlow = 0; // GPM

        // Flow out to pumps
        this.pumps.forEach(pump => {
            if (pump.system === reservoir.system && pump.status === SystemStatus.ON) {
                netFlow -= pump.flow;
            }
        });

        // Flow back from actuators (return flow)
        this.actuators.forEach(actuator => {
            if (actuator.system === reservoir.system) {
                netFlow += actuator.leakage; // Internal leakage returns to reservoir
            }
        });

        // Update quantity
        const deltaQuantity = netFlow * deltaTime / (1000 * 60); // GPM to quarts/second
        reservoir.quantity = Math.max(0, Math.min(reservoir.capacity, 
            reservoir.quantity + deltaQuantity));
        
        reservoir.level = reservoir.quantity / reservoir.capacity;

        // Update temperature from return fluid and ambient
        const system = this.systems.get(reservoir.system);
        if (system && system.temperature > reservoir.temperature) {
            const tempRise = (system.temperature - reservoir.temperature) * 0.1;
            reservoir.temperature += tempRise * deltaTime / 1000;
        }
        
        // Cooling to ambient
        const cooling = (reservoir.temperature - 20) * 0.05;
        reservoir.temperature -= cooling * deltaTime / 1000;

        // Update filter status
        const flowRate = Math.abs(netFlow);
        const filterDelta = flowRate * 0.001; // PSI per GPM
        
        reservoir.filters.return.differential += filterDelta * deltaTime / 1000;
        reservoir.filters.suction.differential += filterDelta * deltaTime / 1000;
        
        // Filter bypass
        reservoir.filters.return.bypassActive = reservoir.filters.return.differential > 25;
        reservoir.filters.suction.bypassActive = reservoir.filters.suction.differential > 15;
        
        // Filter change required
        reservoir.filters.return.changeRequired = reservoir.filters.return.differential > 40;
        reservoir.filters.suction.changeRequired = reservoir.filters.suction.differential > 25;
    }

    private updateAccumulators(deltaTime: number): void {
        this.accumulators.forEach(accumulator => {
            this.updateAccumulator(accumulator, deltaTime);
        });
    }

    private updateAccumulator(accumulator: HydraulicAccumulator, deltaTime: number): void {
        const system = this.systems.get(accumulator.system);
        if (!system) return;

        // Accumulator charges when system pressure is higher
        if (system.pressure > accumulator.pressure) {
            const chargeDelta = (system.pressure - accumulator.pressure) * 0.1;
            accumulator.pressure += chargeDelta * deltaTime / 1000;
        }
        
        // Accumulator discharges when system pressure drops
        if (system.pressure < accumulator.pressure && system.pressure < accumulator.precharge) {
            const dischargeDelta = (accumulator.pressure - system.pressure) * 0.05;
            accumulator.pressure -= dischargeDelta * deltaTime / 1000;
            
            // Add pressure to system from accumulator
            system.pressure += dischargeDelta * 0.5 * deltaTime / 1000;
        }

        // Nitrogen leakage
        accumulator.pressure -= accumulator.nitrogenLeakage * deltaTime / 3600000;
        accumulator.pressure = Math.max(accumulator.precharge * 0.5, accumulator.pressure);

        // Temperature follows system
        accumulator.temperature += (system.temperature - accumulator.temperature) * 0.2 * deltaTime / 1000;
    }

    private updateSystemPressures(deltaTime: number): void {
        this.systems.forEach((system, name) => {
            this.updateSystemPressure(system, name, deltaTime);
        });
    }

    private updateSystemPressure(system: any, systemName: string, deltaTime: number): void {
        // Collect pressure sources
        let totalFlow = 0;
        let maxPressure = 0;

        this.pumps.forEach(pump => {
            if (pump.system === systemName && pump.status === SystemStatus.ON) {
                totalFlow += pump.flow;
                maxPressure = Math.max(maxPressure, pump.pressure);
            }
        });

        // Calculate demand from actuators
        let demandFlow = 0;
        this.actuators.forEach(actuator => {
            if (actuator.system === systemName) {
                const flowDemand = Math.abs(actuator.velocity) * 
                    (actuator.velocity > 0 ? actuator.area.extend : actuator.area.retract) / 231; // cu in/sec to GPM
                demandFlow += flowDemand;
            }
        });

        // System pressure calculation with fluid dynamics
        const netFlow = totalFlow - demandFlow;
        const pressureChange = netFlow * this.BULK_MODULUS / (system.flow || 1) * 0.001;
        
        system.pressure += pressureChange * deltaTime / 1000;
        system.pressure = Math.max(0, Math.min(maxPressure, system.pressure));
        
        system.flow = totalFlow;

        // Temperature calculation
        const heatGeneration = system.pressure * totalFlow * 0.0001;
        const cooling = (system.temperature - 20) * 0.2;
        system.temperature += (heatGeneration - cooling) * deltaTime / 1000;

        // System status
        if (system.pressure > this.config.systems.pressure * 0.8) {
            system.status = SystemStatus.ON;
        } else if (system.pressure > this.config.systems.pressure * 0.5) {
            system.status = SystemStatus.STANDBY;
        } else {
            system.status = SystemStatus.OFF;
        }
    }

    private updateActuators(deltaTime: number): void {
        this.actuators.forEach(actuator => {
            this.updateActuator(actuator, deltaTime);
        });
    }

    private updateActuator(actuator: HydraulicActuator, deltaTime: number): void {
        const system = this.systems.get(actuator.system);
        if (!system) return;

        // Determine available pressure for each side
        actuator.pressure.extend = system.status === SystemStatus.ON ? system.pressure : 0;
        actuator.pressure.retract = system.status === SystemStatus.ON ? system.pressure : 0;

        // Calculate force based on pressure differential
        const positionError = actuator.targetPosition - actuator.position;
        const direction = Math.sign(positionError);
        
        let activePressure = 0;
        let activeArea = 0;
        
        if (direction > 0) { // Extending
            activePressure = actuator.pressure.extend;
            activeArea = actuator.area.extend;
        } else if (direction < 0) { // Retracting
            activePressure = actuator.pressure.retract;
            activeArea = actuator.area.retract;
        }

        // Calculate net force
        const pressureForce = activePressure * activeArea;
        const frictionForce = actuator.friction * pressureForce;
        const netForce = pressureForce - frictionForce;

        actuator.force = netForce;

        // Update position with realistic dynamics
        if (Math.abs(positionError) > 0.001 && netForce > 0) {
            const acceleration = netForce / 100; // Simplified mass
            const targetVelocity = Math.sign(positionError) * Math.sqrt(2 * acceleration * Math.abs(positionError));
            const maxVelocity = actuator.stroke / actuator.response; // Max velocity based on response time
            
            targetVelocity = Math.sign(targetVelocity) * Math.min(Math.abs(targetVelocity), maxVelocity);
            
            // First-order velocity response
            const velocityError = targetVelocity - actuator.velocity;
            actuator.velocity += velocityError * (1 / actuator.response) * deltaTime / 1000;
            
            // Update position
            const deltaPosition = actuator.velocity * deltaTime / 1000;
            actuator.position += deltaPosition;
            
            // Limit position
            if (actuator.type === 'LINEAR') {
                actuator.position = Math.max(0, Math.min(1, actuator.position));
            }
        } else {
            actuator.velocity = 0;
        }
    }

    private updateValves(deltaTime: number): void {
        this.valves.forEach(valve => {
            this.updateValve(valve, deltaTime);
        });
    }

    private updateValve(valve: HydraulicValve, deltaTime: number): void {
        // Update valve position based on type and conditions
        switch (valve.type) {
            case 'RELIEF':
                if (valve.pressure.inlet > valve.crackPressure) {
                    const openAmount = Math.min(1, 
                        (valve.pressure.inlet - valve.crackPressure) / 
                        (valve.fullOpenPressure - valve.crackPressure));
                    valve.position = openAmount;
                } else {
                    valve.position = 0;
                }
                break;

            case 'PRIORITY':
                // Priority valve modulates based on downstream pressure
                if (valve.automated) {
                    const targetPosition = valve.pressure.inlet > valve.crackPressure ? 1 : 0;
                    const positionError = targetPosition - valve.position;
                    valve.position += positionError * 2 * deltaTime / 1000; // Fast response
                }
                break;

            case 'CHECK':
                valve.position = valve.pressure.inlet > valve.pressure.outlet ? 1 : 0;
                break;
        }

        // Calculate flow through valve
        if (valve.position > 0) {
            const pressureDrop = Math.max(0, valve.pressure.inlet - valve.pressure.outlet);
            const flowCoeff = 10 * valve.position; // Cv coefficient
            valve.flow = flowCoeff * Math.sqrt(pressureDrop / this.FLUID_DENSITY);
        } else {
            valve.flow = 0;
        }

        // Account for leakage
        valve.flow += valve.leakage;
    }

    private performPriorityManagement(): void {
        this.systems.forEach((system, systemName) => {
            const priorities = this.priorities.get(systemName);
            if (!priorities) return;

            // Sort actuators by priority
            const systemActuators = Array.from(this.actuators.values())
                .filter(actuator => actuator.system === systemName);

            // If system pressure is low, prioritize critical functions
            if (system.pressure < this.config.systems.pressure * 0.8) {
                systemActuators.forEach(actuator => {
                    let priority = this.getActuatorPriority(actuator.name);
                    let minPressure = this.config.systems.pressure * 0.5;

                    const priorityLevel = priorities.find(p => p.name === this.getActuatorCategory(actuator.name));
                    if (priorityLevel) {
                        minPressure = priorityLevel.minPressure;
                    }

                    // Reduce available pressure for low-priority actuators
                    if (system.pressure < minPressure) {
                        actuator.pressure.extend *= 0.5;
                        actuator.pressure.retract *= 0.5;
                    }
                });
            }
        });
    }

    private getActuatorPriority(actuatorName: string): number {
        if (actuatorName.includes('AILERON') || actuatorName.includes('ELEVATOR') || actuatorName.includes('RUDDER')) {
            return 1; // Primary flight controls
        } else if (actuatorName.includes('GEAR')) {
            return 2; // Landing gear
        } else if (actuatorName.includes('SPOILER') || actuatorName.includes('FLAP') || actuatorName.includes('SLAT')) {
            return 3; // Secondary flight controls
        } else if (actuatorName.includes('BRAKE')) {
            return 4; // Brakes
        }
        return 5; // Other systems
    }

    private getActuatorCategory(actuatorName: string): string {
        if (actuatorName.includes('AILERON') || actuatorName.includes('ELEVATOR') || actuatorName.includes('RUDDER')) {
            return 'PRIMARY_FLIGHT_CONTROLS';
        } else if (actuatorName.includes('GEAR')) {
            return 'LANDING_GEAR';
        } else if (actuatorName.includes('SPOILER') || actuatorName.includes('FLAP') || actuatorName.includes('SLAT')) {
            return 'SECONDARY_FLIGHT_CONTROLS';
        } else if (actuatorName.includes('BRAKE')) {
            return 'BRAKES';
        }
        return 'OTHER';
    }

    private checkAlerts(): void {
        this.alerts = [];

        // System pressure alerts
        this.systems.forEach((system, name) => {
            if (system.pressure < this.config.systems.pressure * 0.8) {
                this.alerts.push({
                    id: `HYD_${name}_LOW_PRESS`,
                    level: system.pressure < this.config.systems.pressure * 0.6 ? 
                        AlertLevel.WARNING : AlertLevel.CAUTION,
                    message: `HYD ${name} LOW PRESS`,
                    system: 'HYDRAULIC',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: system.pressure < this.config.systems.pressure * 0.6
                });
            }

            if (system.temperature > this.MAX_OPERATING_TEMP * 0.9) {
                this.alerts.push({
                    id: `HYD_${name}_OVHT`,
                    level: AlertLevel.WARNING,
                    message: `HYD ${name} OVHT`,
                    system: 'HYDRAULIC',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
        });

        // Reservoir alerts
        this.reservoirs.forEach(reservoir => {
            if (reservoir.quantity < reservoir.lowLevelWarning) {
                this.alerts.push({
                    id: `HYD_${reservoir.system}_RSVR_LOW`,
                    level: AlertLevel.CAUTION,
                    message: `HYD ${reservoir.system} RSVR LOW`,
                    system: 'HYDRAULIC',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
        });

        // Pump alerts
        this.pumps.forEach(pump => {
            if (pump.status === SystemStatus.FAILED || pump.faults.length > 0) {
                this.alerts.push({
                    id: `${pump.name}_FAIL`,
                    level: AlertLevel.WARNING,
                    message: `${pump.name} FAIL`,
                    system: 'HYDRAULIC',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
        });
    }

    /**
     * Control methods
     */
    public setElectricPump(system: string, enabled: boolean): void {
        const pumpName = `ELEC PUMP ${system}`;
        const pump = this.pumps.get(pumpName);
        if (pump) {
            pump.enabled = enabled;
        }
    }

    public setManualPump(enabled: boolean): void {
        const pump = this.pumps.get('MANUAL PUMP');
        if (pump) {
            pump.enabled = enabled;
        }
    }

    public deployRAT(): void {
        this.ratDeployed = true;
    }

    public setActuatorTarget(actuatorName: string, target: number): void {
        const actuator = this.actuators.get(actuatorName);
        if (actuator) {
            actuator.targetPosition = Math.max(0, Math.min(1, target));
        }
    }

    public getActuatorPosition(actuatorName: string): number {
        const actuator = this.actuators.get(actuatorName);
        return actuator ? actuator.position : 0;
    }

    /**
     * Get display data for instruments
     */
    public getDisplayData(): HydraulicsDisplayData {
        const systemsData: HydraulicSystemData[] = Array.from(this.systems.entries()).map(([name, system]) => {
            const pumps = Array.from(this.pumps.values()).filter(p => p.system === name);
            const reservoir = this.reservoirs.get(`RESERVOIR ${name}`);
            
            return {
                name,
                status: system.status,
                pressure: system.pressure,
                flow: system.flow,
                temperature: system.temperature,
                pumps: {
                    engine: pumps.some(p => p.type === 'ENGINE' && p.status === SystemStatus.ON),
                    electric: pumps.some(p => p.type === 'ELECTRIC' && p.status === SystemStatus.ON),
                    manual: pumps.some(p => p.type === 'MANUAL' && p.status === SystemStatus.ON),
                    rat: pumps.some(p => p.type === 'RAT' && p.status === SystemStatus.ON)
                },
                quantity: reservoir ? reservoir.quantity : 0,
                filters: {
                    return: reservoir ? !reservoir.filters.return.bypassActive : true,
                    suction: reservoir ? !reservoir.filters.suction.bypassActive : true
                }
            };
        });

        const reservoirsData: HydraulicReservoirData[] = Array.from(this.reservoirs.values()).map(reservoir => ({
            system: reservoir.system,
            quantity: reservoir.quantity,
            capacity: reservoir.capacity,
            temperature: reservoir.temperature,
            pressure: reservoir.pressure
        }));

        const accumulatorsData: AccumulatorData[] = Array.from(this.accumulators.values()).map(accumulator => ({
            system: accumulator.system,
            pressure: accumulator.pressure,
            precharge: accumulator.precharge
        }));

        return {
            systems: systemsData,
            reservoirs: reservoirsData,
            accumulators: accumulatorsData
        };
    }

    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public getActuatorStatus(): Map<string, { position: number; force: number; pressure: number }> {
        const status = new Map();
        this.actuators.forEach((actuator, name) => {
            status.set(name, {
                position: actuator.position,
                force: actuator.force,
                pressure: Math.max(actuator.pressure.extend, actuator.pressure.retract)
            });
        });
        return status;
    }

    /**
     * System health and diagnostics
     */
    public isSystemHealthy(): boolean {
        return this.alerts.filter(alert => 
            alert.level === AlertLevel.WARNING || alert.level === AlertLevel.EMERGENCY
        ).length === 0;
    }

    public getSystemEfficiency(): { overall: number; systems: Map<string, number> } {
        let totalEfficiency = 0;
        const systemEfficiencies = new Map<string, number>();

        this.systems.forEach((system, name) => {
            const targetPressure = this.config.systems.pressure;
            const efficiency = Math.min(1, system.pressure / targetPressure);
            systemEfficiencies.set(name, efficiency);
            totalEfficiency += efficiency;
        });

        return {
            overall: totalEfficiency / this.systems.size,
            systems: systemEfficiencies
        };
    }
}