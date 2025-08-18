import { Vector3 } from '../../core/math/Vector3';
import { ElectricalSystem } from './ElectricalSystem';
import { HydraulicSystem } from './HydraulicSystem';
import { FuelSystem } from './FuelSystem';
import { AvionicsSystem } from './AvionicsSystem';
import { EnvironmentalSystem } from './EnvironmentalSystem';
import { WarningSystem } from './WarningSystem';
import { 
    SystemConfiguration,
    ElectricalConfig,
    HydraulicConfig,
    FuelConfig,
    AvionicsConfig,
    EnvironmentalConfig,
    AlertData,
    EicasData,
    SystemStatus,
    AlertLevel
} from './InstrumentData';

/**
 * Central aircraft systems manager
 * Coordinates all aircraft systems, manages power distribution, and handles cross-system dependencies
 */

export interface SystemsConfiguration {
    electrical: ElectricalConfig;
    hydraulic: HydraulicConfig;
    fuel: FuelConfig;
    avionics: AvionicsConfig;
    environmental: EnvironmentalConfig;
}

export interface SystemsState {
    electrical: any;
    hydraulic: any;
    fuel: any;
    avionics: any;
    environmental: any;
    warnings: any;
    overall: {
        healthy: boolean;
        criticalFailures: string[];
        systemsOnline: number;
        totalSystems: number;
        powerAvailable: boolean;
        emergencyPower: boolean;
    };
}

export interface CrossSystemDependencies {
    electricalToHydraulic: boolean;    // Hydraulic pumps need electrical power
    electricalToFuel: boolean;         // Fuel pumps need electrical power  
    electricalToAvionics: boolean;     // Avionics need electrical power
    electricalToEnvironmental: boolean; // Environmental systems need electrical power
    hydraulicToFlight: boolean;        // Flight controls need hydraulic power
    fuelToEngines: boolean;           // Engines need fuel
    bleedToEnvironmental: boolean;     // Environmental systems need bleed air
}

export interface EmergencyProcedures {
    electricalFailure: EmergencyProcedure;
    hydraulicFailure: EmergencyProcedure;
    engineFailure: EmergencyProcedure;
    pressurization: EmergencyProcedure;
    fire: EmergencyProcedure;
    evacuation: EmergencyProcedure;
}

export interface EmergencyProcedure {
    id: string;
    name: string;
    priority: number;           // 1 = highest priority
    active: boolean;
    completed: boolean;
    steps: EmergencyStep[];
    conditions: EmergencyCondition[];
    timeCritical: boolean;
    timeLimit?: number;         // seconds
}

export interface EmergencyStep {
    id: string;
    description: string;
    action: string;
    completed: boolean;
    automatic: boolean;         // automatically completed by systems
    verification: string;       // how to verify completion
}

export interface EmergencyCondition {
    parameter: string;
    operator: '>' | '<' | '=' | '!=';
    value: number | boolean | string;
    met: boolean;
}

export interface SystemIntegrationData {
    powerFlow: PowerFlow;
    fluidFlow: FluidFlow;
    dataFlow: DataFlow;
    dependencies: Map<string, string[]>;
    conflicts: SystemConflict[];
}

export interface PowerFlow {
    sources: PowerSource[];
    loads: PowerLoad[];
    distribution: PowerDistribution;
    backup: BackupPower;
}

export interface PowerSource {
    name: string;
    type: 'GENERATOR' | 'BATTERY' | 'APU' | 'GROUND' | 'RAT';
    available: boolean;
    priority: number;
    capacity: number;           // watts or amps
    voltage: number;            // volts
    frequency?: number;         // Hz for AC
}

export interface PowerLoad {
    name: string;
    system: string;
    essential: boolean;
    priority: number;
    consumption: number;        // watts or amps
    powered: boolean;
    shed: boolean;              // load shed status
}

export interface PowerDistribution {
    buses: Map<string, BusStatus>;
    switchState: Map<string, boolean>;
    loadShedding: LoadSheddingStatus;
}

export interface BusStatus {
    name: string;
    powered: boolean;
    voltage: number;
    frequency: number;
    load: number;
    capacity: number;
    essential: boolean;
}

export interface BackupPower {
    available: boolean;
    source: string;
    duration: number;           // minutes
    systemsCovered: string[];
}

export interface LoadSheddingStatus {
    active: boolean;
    sequence: string[];         // load shedding sequence
    currentLevel: number;       // current shed level
    automatic: boolean;
}

export interface FluidFlow {
    hydraulic: HydraulicFlow;
    fuel: FuelFlow;
    air: AirFlow;
}

export interface HydraulicFlow {
    systems: Map<string, HydraulicSystemFlow>;
    crossConnections: CrossConnection[];
    priorityValves: PriorityValve[];
}

export interface HydraulicSystemFlow {
    name: string;
    pressure: number;           // PSI
    flow: number;               // GPM
    consumers: FlowConsumer[];
    available: boolean;
}

export interface CrossConnection {
    from: string;
    to: string;
    active: boolean;
    valve: string;
}

export interface PriorityValve {
    system: string;
    consumer: string;
    priority: number;
    active: boolean;
}

export interface FuelFlow {
    tanks: Map<string, TankFlow>;
    engines: Map<string, EngineFlow>;
    crossfeed: CrossfeedStatus;
    jettison: JettisonStatus;
}

export interface TankFlow {
    name: string;
    quantity: number;           // lbs or gallons
    flowOut: number;            // GPH
    flowIn: number;             // GPH
    pumps: PumpFlow[];
}

export interface PumpFlow {
    name: string;
    active: boolean;
    flow: number;               // GPH
    pressure: number;           // PSI
}

export interface EngineFlow {
    engineNumber: number;
    demand: number;             // GPH
    supply: number;             // GPH
    source: string;             // source tank
}

export interface CrossfeedStatus {
    active: boolean;
    valve: string;
    flow: number;               // GPH
}

export interface JettisonStatus {
    active: boolean;
    rate: number;               // GPH
    systems: string[];
}

export interface AirFlow {
    bleed: BleedFlow;
    cabin: CabinFlow;
    cooling: CoolingFlow;
}

export interface BleedFlow {
    sources: Map<string, BleedSource>;
    consumers: Map<string, BleedConsumer>;
    manifold: ManifoldStatus;
}

export interface BleedSource {
    name: string;
    available: boolean;
    pressure: number;           // PSI
    temperature: number;        // degrees C
    flow: number;               // lbs/min
}

export interface BleedConsumer {
    name: string;
    demand: number;             // lbs/min
    supplied: number;           // lbs/min
    priority: number;
}

export interface ManifoldStatus {
    pressure: number;           // PSI
    temperature: number;        // degrees C
    totalFlow: number;          // lbs/min
}

export interface CabinFlow {
    supply: number;             // CFM
    recirculation: number;      // CFM
    exhaust: number;            // CFM
    pressurization: PressurizeFlow;
}

export interface PressurizeFlow {
    inflow: number;             // CFM
    outflow: number;            // CFM
    differential: number;       // PSI
}

export interface CoolingFlow {
    airflow: number;            // CFM
    temperature: number;        // degrees C
    effectiveness: number;      // 0-1
}

export interface DataFlow {
    buses: Map<string, DataBus>;
    networks: Map<string, DataNetwork>;
    interfaces: DataInterface[];
}

export interface DataBus {
    name: string;
    type: 'ARINC429' | 'ARINC664' | 'CAN' | 'ETHERNET';
    active: boolean;
    bandwidth: number;          // Mbps
    utilization: number;        // percentage
    nodes: DataNode[];
}

export interface DataNetwork {
    name: string;
    redundant: boolean;
    primary: boolean;
    nodes: number;
    traffic: number;            // packets/second
}

export interface DataNode {
    name: string;
    system: string;
    transmitting: boolean;
    receiving: boolean;
    address: string;
}

export interface DataInterface {
    from: string;
    to: string;
    protocol: string;
    rate: number;               // Hz
    data: string[];             // data types
}

export interface FlowConsumer {
    name: string;
    system: string;
    demand: number;             // flow units
    supplied: number;           // actual supply
    priority: number;
    essential: boolean;
}

export interface SystemConflict {
    id: string;
    systems: string[];
    type: 'RESOURCE' | 'OPERATIONAL' | 'SAFETY';
    description: string;
    resolution: string;
    priority: number;
    active: boolean;
}

export class SystemsManager {
    private electrical: ElectricalSystem;
    private hydraulic: HydraulicSystem;
    private fuel: FuelSystem;
    private avionics: AvionicsSystem;
    private environmental: EnvironmentalSystem;
    private warnings: WarningSystem;
    
    private config: SystemsConfiguration;
    private dependencies: CrossSystemDependencies;
    private emergencyProcedures: EmergencyProcedures;
    private integrationData: SystemIntegrationData;
    
    private aircraftState: any = {};
    private alerts: AlertData[] = [];
    
    private emergencyMode: boolean = false;
    private systemsHealthy: boolean = true;
    private lastUpdateTime: number = 0;
    
    // Update timing
    private readonly UPDATE_RATE = 20; // Hz
    private updateCounter = 0;

    constructor(config: SystemsConfiguration) {
        this.config = config;
        this.initializeSystems();
        this.initializeDependencies();
        this.initializeEmergencyProcedures();
        this.initializeIntegration();
    }

    /**
     * Initialize all aircraft systems
     */
    private initializeSystems(): void {
        this.electrical = new ElectricalSystem(this.config.electrical);
        this.hydraulic = new HydraulicSystem(this.config.hydraulic);
        this.fuel = new FuelSystem(this.config.fuel);
        this.avionics = new AvionicsSystem(this.config.avionics);
        this.environmental = new EnvironmentalSystem(this.config.environmental);
        this.warnings = new WarningSystem();
    }

    private initializeDependencies(): void {
        this.dependencies = {
            electricalToHydraulic: true,
            electricalToFuel: true,
            electricalToAvionics: true,
            electricalToEnvironmental: true,
            hydraulicToFlight: true,
            fuelToEngines: true,
            bleedToEnvironmental: true
        };
    }

    private initializeEmergencyProcedures(): void {
        this.emergencyProcedures = {
            electricalFailure: {
                id: 'ELEC_FAILURE',
                name: 'Electrical System Failure',
                priority: 2,
                active: false,
                completed: false,
                timeCritical: false,
                steps: [
                    {
                        id: 'ELEC_1',
                        description: 'Check battery switches',
                        action: 'BATTERY switches - ON',
                        completed: false,
                        automatic: false,
                        verification: 'Battery voltage available'
                    },
                    {
                        id: 'ELEC_2', 
                        description: 'Check generators',
                        action: 'Generator switches - check ON',
                        completed: false,
                        automatic: false,
                        verification: 'Generator online indications'
                    },
                    {
                        id: 'ELEC_3',
                        description: 'Consider APU start',
                        action: 'APU - START (if required)',
                        completed: false,
                        automatic: false,
                        verification: 'APU generator online'
                    }
                ],
                conditions: [
                    {
                        parameter: 'electrical.totalGeneration',
                        operator: '<',
                        value: 1000,
                        met: false
                    }
                ]
            },
            hydraulicFailure: {
                id: 'HYD_FAILURE',
                name: 'Hydraulic System Failure',
                priority: 3,
                active: false,
                completed: false,
                timeCritical: false,
                steps: [
                    {
                        id: 'HYD_1',
                        description: 'Identify failed system',
                        action: 'Check hydraulic system indications',
                        completed: false,
                        automatic: true,
                        verification: 'System identification'
                    },
                    {
                        id: 'HYD_2',
                        description: 'Activate backup systems',
                        action: 'Electric hydraulic pumps - ON',
                        completed: false,
                        automatic: false,
                        verification: 'Backup system pressure'
                    },
                    {
                        id: 'HYD_3',
                        description: 'Consider manual reversion',
                        action: 'Prepare for manual flight controls',
                        completed: false,
                        automatic: false,
                        verification: 'Control feel and response'
                    }
                ],
                conditions: [
                    {
                        parameter: 'hydraulic.systemsHealthy',
                        operator: '=',
                        value: false,
                        met: false
                    }
                ]
            },
            engineFailure: {
                id: 'ENG_FAILURE',
                name: 'Engine Failure',
                priority: 1,
                active: false,
                completed: false,
                timeCritical: true,
                timeLimit: 30,
                steps: [
                    {
                        id: 'ENG_1',
                        description: 'Maintain control',
                        action: 'Control aircraft attitude and heading',
                        completed: false,
                        automatic: false,
                        verification: 'Stable flight maintained'
                    },
                    {
                        id: 'ENG_2',
                        description: 'Throttle failed engine',
                        action: 'Throttle - IDLE (failed engine)',
                        completed: false,
                        automatic: false,
                        verification: 'Engine parameters confirm shutdown'
                    },
                    {
                        id: 'ENG_3',
                        description: 'Identify and secure',
                        action: 'Engine - SECURE (if required)',
                        completed: false,
                        automatic: false,
                        verification: 'Engine secured indications'
                    }
                ],
                conditions: [
                    {
                        parameter: 'engines.failed',
                        operator: '>',
                        value: 0,
                        met: false
                    }
                ]
            },
            pressurization: {
                id: 'CABIN_PRESS',
                name: 'Cabin Pressurization Failure',
                priority: 1,
                active: false,
                completed: false,
                timeCritical: true,
                timeLimit: 20,
                steps: [
                    {
                        id: 'PRESS_1',
                        description: 'Don oxygen masks',
                        action: 'Crew oxygen masks - DON and 100%',
                        completed: false,
                        automatic: false,
                        verification: 'Oxygen flow established'
                    },
                    {
                        id: 'PRESS_2',
                        description: 'Emergency descent',
                        action: 'Initiate emergency descent to 10,000 ft',
                        completed: false,
                        automatic: false,
                        verification: 'Descent rate >6000 fpm'
                    },
                    {
                        id: 'PRESS_3',
                        description: 'Passenger oxygen',
                        action: 'Passenger oxygen - verify deployed',
                        completed: false,
                        automatic: true,
                        verification: 'Passenger masks deployed'
                    }
                ],
                conditions: [
                    {
                        parameter: 'environmental.cabinAltitude',
                        operator: '>',
                        value: 14000,
                        met: false
                    }
                ]
            },
            fire: {
                id: 'FIRE',
                name: 'Fire Warning',
                priority: 1,
                active: false,
                completed: false,
                timeCritical: true,
                timeLimit: 10,
                steps: [
                    {
                        id: 'FIRE_1',
                        description: 'Throttle affected engine',
                        action: 'Throttle - IDLE (affected engine)',
                        completed: false,
                        automatic: false,
                        verification: 'Engine at idle'
                    },
                    {
                        id: 'FIRE_2',
                        description: 'Fire handle pull',
                        action: 'Fire handle - PULL',
                        completed: false,
                        automatic: false,
                        verification: 'Engine shutdown and isolation'
                    },
                    {
                        id: 'FIRE_3',
                        description: 'Discharge fire bottle',
                        action: 'Fire extinguisher - DISCHARGE',
                        completed: false,
                        automatic: false,
                        verification: 'Extinguisher bottle pressure drop'
                    }
                ],
                conditions: [
                    {
                        parameter: 'fire.detected',
                        operator: '=',
                        value: true,
                        met: false
                    }
                ]
            },
            evacuation: {
                id: 'EVACUATION',
                name: 'Emergency Evacuation',
                priority: 1,
                active: false,
                completed: false,
                timeCritical: true,
                timeLimit: 90,
                steps: [
                    {
                        id: 'EVAC_1',
                        description: 'Set parking brake',
                        action: 'Parking brake - SET',
                        completed: false,
                        automatic: false,
                        verification: 'Aircraft stopped'
                    },
                    {
                        id: 'EVAC_2',
                        description: 'Engine shutdown',
                        action: 'All engines - SHUTDOWN',
                        completed: false,
                        automatic: false,
                        verification: 'All engines stopped'
                    },
                    {
                        id: 'EVAC_3',
                        description: 'Evacuate aircraft',
                        action: 'EVACUATE command',
                        completed: false,
                        automatic: false,
                        verification: 'Evacuation in progress'
                    }
                ],
                conditions: [
                    {
                        parameter: 'evacuation.required',
                        operator: '=',
                        value: true,
                        met: false
                    }
                ]
            }
        };
    }

    private initializeIntegration(): void {
        this.integrationData = {
            powerFlow: {
                sources: [],
                loads: [],
                distribution: {
                    buses: new Map(),
                    switchState: new Map(),
                    loadShedding: {
                        active: false,
                        sequence: ['GALLEY', 'CABIN_LTG', 'ENTERTAINMENT'],
                        currentLevel: 0,
                        automatic: true
                    }
                },
                backup: {
                    available: false,
                    source: '',
                    duration: 0,
                    systemsCovered: []
                }
            },
            fluidFlow: {
                hydraulic: {
                    systems: new Map(),
                    crossConnections: [],
                    priorityValves: []
                },
                fuel: {
                    tanks: new Map(),
                    engines: new Map(),
                    crossfeed: { active: false, valve: '', flow: 0 },
                    jettison: { active: false, rate: 0, systems: [] }
                },
                air: {
                    bleed: {
                        sources: new Map(),
                        consumers: new Map(),
                        manifold: { pressure: 0, temperature: 0, totalFlow: 0 }
                    },
                    cabin: {
                        supply: 0,
                        recirculation: 0,
                        exhaust: 0,
                        pressurization: { inflow: 0, outflow: 0, differential: 0 }
                    },
                    cooling: { airflow: 0, temperature: 0, effectiveness: 0 }
                }
            },
            dataFlow: {
                buses: new Map(),
                networks: new Map(),
                interfaces: []
            },
            dependencies: new Map(),
            conflicts: []
        };
    }

    /**
     * Main update method - coordinates all system updates
     */
    public update(deltaTime: number, aircraftState: any): void {
        this.aircraftState = aircraftState;
        this.lastUpdateTime = Date.now();

        // Update at specified rate
        this.updateCounter += deltaTime;
        if (this.updateCounter < 1000 / this.UPDATE_RATE) return;

        const dt = this.updateCounter;
        this.updateCounter = 0;

        // Update systems in dependency order
        this.updateSystemsSequence(dt);
        
        // Process cross-system interactions
        this.processSystemDependencies();
        
        // Update integration data
        this.updateIntegrationData();
        
        // Process emergency procedures
        this.processEmergencyProcedures();
        
        // Consolidate alerts
        this.consolidateAlerts();
        
        // Update overall system health
        this.updateSystemHealth();
    }

    private updateSystemsSequence(deltaTime: number): void {
        // Update electrical system first (everything depends on power)
        const electricalStatus = this.electrical.getDisplayData();
        this.electrical.update(deltaTime, this.aircraftState);

        // Update fuel system (engines need fuel)
        this.fuel.update(deltaTime, this.aircraftState, electricalStatus);
        const fuelStatus = this.fuel.getDisplayData();

        // Update hydraulic system (depends on electrical power)
        this.hydraulic.update(deltaTime, this.aircraftState, electricalStatus);
        const hydraulicStatus = this.hydraulic.getDisplayData();

        // Update environmental system (depends on electrical and bleed air)
        this.environmental.update(deltaTime, this.aircraftState, electricalStatus);
        const environmentalStatus = this.environmental.getDisplayData();

        // Update avionics (depends on electrical power)
        this.avionics.update(deltaTime, this.aircraftState, electricalStatus);
        const avionicsStatus = this.avionics.getDisplayData();

        // Update warning system last (monitors all other systems)
        const systemStates = new Map();
        systemStates.set('electrical', electricalStatus);
        systemStates.set('hydraulic', hydraulicStatus);
        systemStates.set('fuel', fuelStatus);
        systemStates.set('avionics', avionicsStatus);
        systemStates.set('environmental', environmentalStatus);
        
        this.warnings.update(deltaTime, this.aircraftState, systemStates);
    }

    private processSystemDependencies(): void {
        // Check electrical to hydraulic dependency
        if (this.dependencies.electricalToHydraulic) {
            const electricalHealthy = this.electrical.isSystemHealthy();
            const powerStatus = this.electrical.getPowerStatus();
            
            if (!electricalHealthy || powerStatus.totalGeneration < 1000) {
                // Reduce hydraulic pump effectiveness
                this.hydraulic.setElectricPump('A', false);
                this.hydraulic.setElectricPump('B', false);
            }
        }

        // Check fuel to engines dependency
        if (this.dependencies.fuelToEngines) {
            const fuelPlanning = this.fuel.getFuelPlanning();
            if (fuelPlanning.usableFuel < 100) {
                // Engine flame-out conditions
                this.triggerFuelStarvation();
            }
        }

        // Check hydraulic to flight controls
        if (this.dependencies.hydraulicToFlight) {
            const hydraulicHealth = this.hydraulic.isSystemHealthy();
            const efficiency = this.hydraulic.getSystemEfficiency();
            
            if (!hydraulicHealth || efficiency.overall < 0.5) {
                this.triggerHydraulicEmergency();
            }
        }

        // Check bleed air to environmental
        if (this.dependencies.bleedToEnvironmental) {
            // Environmental systems need bleed air from engines or APU
            const enginesRunning = this.getEnginesRunning();
            const apuRunning = this.aircraftState.apu?.running || false;
            
            if (!enginesRunning && !apuRunning) {
                this.environmental.setPack('PACK 1', false);
                this.environmental.setPack('PACK 2', false);
            }
        }
    }

    private updateIntegrationData(): void {
        this.updatePowerFlow();
        this.updateFluidFlow();
        this.updateDataFlow();
        this.checkSystemConflicts();
    }

    private updatePowerFlow(): void {
        const electricalData = this.electrical.getDisplayData();
        
        // Update power sources
        this.integrationData.powerFlow.sources = electricalData.generators.map(gen => ({
            name: gen.name,
            type: gen.name.includes('APU') ? 'APU' : 
                  gen.name.includes('GROUND') ? 'GROUND' : 'GENERATOR',
            available: gen.online,
            priority: gen.name.includes('1') ? 1 : 2,
            capacity: gen.power * 1000, // KW to watts
            voltage: gen.voltage,
            frequency: gen.frequency
        }));

        // Add batteries as sources
        electricalData.batteries.forEach(batt => {
            this.integrationData.powerFlow.sources.push({
                name: batt.name,
                type: 'BATTERY',
                available: batt.status === SystemStatus.ON,
                priority: 3,
                capacity: Math.abs(batt.current * batt.voltage),
                voltage: batt.voltage
            });
        });

        // Update bus status
        electricalData.buses.forEach(bus => {
            this.integrationData.powerFlow.distribution.buses.set(bus.name, {
                name: bus.name,
                powered: bus.powered,
                voltage: bus.voltage,
                frequency: bus.frequency,
                load: 0, // Would be calculated from loads
                capacity: 1000, // Example capacity
                essential: bus.name.includes('ESS')
            });
        });

        // Update load shedding status
        const totalGeneration = this.electrical.getPowerStatus().totalGeneration;
        const totalConsumption = this.electrical.getPowerStatus().totalConsumption;
        
        if (totalConsumption > totalGeneration * 1.1) {
            this.integrationData.powerFlow.distribution.loadShedding.active = true;
            this.performAutomaticLoadShedding();
        } else if (totalGeneration > totalConsumption * 1.2) {
            this.integrationData.powerFlow.distribution.loadShedding.active = false;
            this.restoreSheddedLoads();
        }
    }

    private updateFluidFlow(): void {
        // Update hydraulic flow
        const hydraulicData = this.hydraulic.getDisplayData();
        hydraulicData.systems.forEach(system => {
            this.integrationData.fluidFlow.hydraulic.systems.set(system.name, {
                name: system.name,
                pressure: system.pressure,
                flow: system.flow,
                consumers: [],
                available: system.status === SystemStatus.ON
            });
        });

        // Update fuel flow
        const fuelData = this.fuel.getDisplayData();
        fuelData.tanks.forEach(tank => {
            this.integrationData.fluidFlow.fuel.tanks.set(tank.name, {
                name: tank.name,
                quantity: tank.quantity,
                flowOut: 0, // Would be calculated
                flowIn: 0,
                pumps: tank.pumps.map((active, index) => ({
                    name: `${tank.name}_PUMP_${index + 1}`,
                    active,
                    flow: active ? 50 : 0, // Example flow
                    pressure: active ? 25 : 0
                }))
            });
        });

        // Update air flow
        const envData = this.environmental.getDisplayData();
        envData.bleedAir.engines.forEach(engine => {
            this.integrationData.fluidFlow.air.bleed.sources.set(engine.name, {
                name: engine.name,
                available: engine.status === SystemStatus.ON,
                pressure: engine.pressure,
                temperature: engine.temperature,
                flow: 0 // Would be calculated
            });
        });
    }

    private updateDataFlow(): void {
        // Update avionics data buses
        const avionicsData = this.avionics.getNavigationDisplayData();
        
        // Example ARINC 429 bus
        this.integrationData.dataFlow.buses.set('ARINC_429_1', {
            name: 'ARINC_429_1',
            type: 'ARINC429',
            active: true,
            bandwidth: 0.1, // 100 kbps
            utilization: 75,
            nodes: [
                { name: 'FMS_1', system: 'AVIONICS', transmitting: true, receiving: true, address: '01' },
                { name: 'EFIS_1', system: 'AVIONICS', transmitting: false, receiving: true, address: '02' },
                { name: 'AUTOPILOT', system: 'AVIONICS', transmitting: true, receiving: true, address: '03' }
            ]
        });

        // Example Ethernet network
        this.integrationData.dataFlow.networks.set('AVIONICS_LAN', {
            name: 'AVIONICS_LAN',
            redundant: true,
            primary: true,
            nodes: 8,
            traffic: 1000
        });
    }

    private checkSystemConflicts(): void {
        this.integrationData.conflicts = [];

        // Check for power conflicts
        const totalPowerDemand = this.calculateTotalPowerDemand();
        const totalPowerGeneration = this.calculateTotalPowerGeneration();
        
        if (totalPowerDemand > totalPowerGeneration) {
            this.integrationData.conflicts.push({
                id: 'POWER_SHORTAGE',
                systems: ['ELECTRICAL'],
                type: 'RESOURCE',
                description: 'Insufficient electrical power generation',
                resolution: 'Load shedding or additional power source',
                priority: 2,
                active: true
            });
        }

        // Check for hydraulic pressure conflicts
        const hydraulicSystems = this.hydraulic.getSystemEfficiency();
        if (hydraulicSystems.overall < 0.7) {
            this.integrationData.conflicts.push({
                id: 'HYDRAULIC_DEGRADED',
                systems: ['HYDRAULIC'],
                type: 'OPERATIONAL',
                description: 'Degraded hydraulic system performance',
                resolution: 'Activate backup pumps or RAT',
                priority: 3,
                active: true
            });
        }

        // Check for fuel imbalance conflicts
        const fuelPlanning = this.fuel.getFuelPlanning();
        const centerTank = fuelPlanning.totalFuel; // Simplified
        if (centerTank > 1000) { // Example threshold
            this.integrationData.conflicts.push({
                id: 'FUEL_IMBALANCE',
                systems: ['FUEL'],
                type: 'OPERATIONAL',
                description: 'Fuel imbalance detected',
                resolution: 'Activate fuel transfer or crossfeed',
                priority: 4,
                active: true
            });
        }
    }

    private processEmergencyProcedures(): void {
        // Check conditions for each emergency procedure
        Object.values(this.emergencyProcedures).forEach(procedure => {
            this.checkEmergencyConditions(procedure);
            
            if (procedure.active && !procedure.completed) {
                this.processEmergencySteps(procedure);
            }
        });
    }

    private checkEmergencyConditions(procedure: EmergencyProcedure): void {
        let allConditionsMet = true;

        procedure.conditions.forEach(condition => {
            condition.met = this.evaluateCondition(condition);
            if (!condition.met) {
                allConditionsMet = false;
            }
        });

        // Activate procedure if conditions are met
        if (allConditionsMet && !procedure.active) {
            procedure.active = true;
            this.triggerEmergencyProcedure(procedure);
        } else if (!allConditionsMet && procedure.active && procedure.completed) {
            // Deactivate completed procedure if conditions no longer met
            procedure.active = false;
            procedure.completed = false;
        }
    }

    private evaluateCondition(condition: EmergencyCondition): boolean {
        let value: any;

        // Get parameter value based on condition parameter
        switch (condition.parameter) {
            case 'electrical.totalGeneration':
                value = this.electrical.getPowerStatus().totalGeneration;
                break;
            case 'hydraulic.systemsHealthy':
                value = this.hydraulic.isSystemHealthy();
                break;
            case 'environmental.cabinAltitude':
                const envData = this.environmental.getDisplayData();
                value = envData.pressurization.cabinAltitude;
                break;
            case 'engines.failed':
                value = this.getFailedEngineCount();
                break;
            case 'fire.detected':
                value = this.isFireDetected();
                break;
            default:
                return false;
        }

        // Evaluate condition
        switch (condition.operator) {
            case '>':
                return value > condition.value;
            case '<':
                return value < condition.value;
            case '=':
                return value === condition.value;
            case '!=':
                return value !== condition.value;
            default:
                return false;
        }
    }

    private processEmergencySteps(procedure: EmergencyProcedure): void {
        let allStepsCompleted = true;

        procedure.steps.forEach(step => {
            if (!step.completed) {
                if (step.automatic) {
                    // Automatic steps are completed by the system
                    step.completed = this.executeAutomaticStep(step);
                }
                
                if (!step.completed) {
                    allStepsCompleted = false;
                }
            }
        });

        procedure.completed = allStepsCompleted;
    }

    private executeAutomaticStep(step: EmergencyStep): boolean {
        // Execute automatic emergency steps
        switch (step.id) {
            case 'HYD_1': // Identify failed hydraulic system
                return true; // System identification is automatic
            
            case 'PRESS_3': // Deploy passenger oxygen masks
                const envData = this.environmental.getDisplayData();
                return envData.pressurization.cabinAltitude > 14000;
            
            default:
                return false;
        }
    }

    private triggerEmergencyProcedure(procedure: EmergencyProcedure): void {
        // Activate emergency mode
        this.emergencyMode = true;
        
        // Trigger master warning
        this.warnings.acknowledgeWarning(); // Clear to re-trigger
        
        // Add emergency alert
        this.alerts.push({
            id: procedure.id,
            level: AlertLevel.EMERGENCY,
            message: procedure.name.toUpperCase(),
            system: 'EMERGENCY',
            timestamp: Date.now(),
            acknowledged: false,
            inhibited: false,
            active: true,
            flashing: true
        });

        console.log(`Emergency procedure activated: ${procedure.name}`);
    }

    private consolidateAlerts(): void {
        // Collect alerts from all systems
        this.alerts = [];
        
        this.alerts.push(...this.electrical.getAlerts());
        this.alerts.push(...this.hydraulic.getAlerts());
        this.alerts.push(...this.fuel.getAlerts());
        this.alerts.push(...this.avionics.getAlerts());
        this.alerts.push(...this.environmental.getAlerts());
        this.alerts.push(...this.warnings.getAlerts());

        // Remove duplicates and sort by priority
        const uniqueAlerts = this.alerts.filter((alert, index, self) => 
            index === self.findIndex(a => a.id === alert.id));
        
        this.alerts = uniqueAlerts.sort((a, b) => {
            const priorityA = this.getAlertPriority(a.level);
            const priorityB = this.getAlertPriority(b.level);
            return priorityA - priorityB;
        });
    }

    private updateSystemHealth(): void {
        const systemHealthChecks = [
            this.electrical.isSystemHealthy(),
            this.hydraulic.isSystemHealthy(),
            this.fuel.isSystemHealthy(),
            this.avionics.getPrimaryFlightData() !== null, // Simplified avionics health
            this.environmental.isSystemHealthy(),
            this.warnings.isSystemHealthy()
        ];

        this.systemsHealthy = systemHealthChecks.every(healthy => healthy);
        
        const criticalFailures = this.alerts
            .filter(alert => alert.level === AlertLevel.EMERGENCY || alert.level === AlertLevel.WARNING)
            .map(alert => alert.system);

        // Update overall system state would be used by external systems
    }

    // Utility methods
    private performAutomaticLoadShedding(): void {
        const sequence = this.integrationData.powerFlow.distribution.loadShedding.sequence;
        const currentLevel = this.integrationData.powerFlow.distribution.loadShedding.currentLevel;
        
        if (currentLevel < sequence.length) {
            const loadToShed = sequence[currentLevel];
            console.log(`Shedding load: ${loadToShed}`);
            this.integrationData.powerFlow.distribution.loadShedding.currentLevel++;
        }
    }

    private restoreSheddedLoads(): void {
        const currentLevel = this.integrationData.powerFlow.distribution.loadShedding.currentLevel;
        
        if (currentLevel > 0) {
            const sequence = this.integrationData.powerFlow.distribution.loadShedding.sequence;
            const loadToRestore = sequence[currentLevel - 1];
            console.log(`Restoring load: ${loadToRestore}`);
            this.integrationData.powerFlow.distribution.loadShedding.currentLevel--;
        }
    }

    private triggerFuelStarvation(): void {
        console.log('Fuel starvation detected - engine flame-out imminent');
    }

    private triggerHydraulicEmergency(): void {
        console.log('Hydraulic emergency - deploying RAT');
        this.hydraulic.deployRAT();
    }

    private getEnginesRunning(): boolean {
        return this.aircraftState.engines?.some((engine: any) => engine.running) || false;
    }

    private getFailedEngineCount(): number {
        return this.aircraftState.engines?.filter((engine: any) => engine.failed).length || 0;
    }

    private isFireDetected(): boolean {
        // Would check fire detection systems
        return false; // Simplified
    }

    private calculateTotalPowerDemand(): number {
        return this.integrationData.powerFlow.loads.reduce((total, load) => total + load.consumption, 0);
    }

    private calculateTotalPowerGeneration(): number {
        return this.integrationData.powerFlow.sources
            .filter(source => source.available)
            .reduce((total, source) => total + source.capacity, 0);
    }

    private getAlertPriority(level: AlertLevel): number {
        switch (level) {
            case AlertLevel.EMERGENCY: return 1;
            case AlertLevel.WARNING: return 2;
            case AlertLevel.CAUTION: return 3;
            case AlertLevel.ADVISORY: return 4;
            default: return 5;
        }
    }

    /**
     * Control methods
     */
    public acknowledgeWarning(): void {
        this.warnings.acknowledgeWarning();
    }

    public acknowledgeCaution(): void {
        this.warnings.acknowledgeCaution();
    }

    public testSystems(): void {
        console.log('Testing all aircraft systems...');
        this.warnings.testWarningSystem();
        // Would test other systems
    }

    public resetEmergencyMode(): void {
        this.emergencyMode = false;
        Object.values(this.emergencyProcedures).forEach(procedure => {
            procedure.active = false;
            procedure.completed = false;
            procedure.steps.forEach(step => {
                step.completed = false;
            });
        });
    }

    public completeEmergencyStep(procedureId: string, stepId: string): void {
        const procedure = Object.values(this.emergencyProcedures)
            .find(p => p.id === procedureId);
        
        if (procedure) {
            const step = procedure.steps.find(s => s.id === stepId);
            if (step) {
                step.completed = true;
                console.log(`Emergency step completed: ${step.description}`);
            }
        }
    }

    /**
     * Get system data for displays
     */
    public getSystemsState(): SystemsState {
        return {
            electrical: this.electrical.getDisplayData(),
            hydraulic: this.hydraulic.getDisplayData(),
            fuel: this.fuel.getDisplayData(),
            avionics: this.avionics.getPrimaryFlightData(),
            environmental: this.environmental.getDisplayData(),
            warnings: this.warnings.getMasterWarningStatus(),
            overall: {
                healthy: this.systemsHealthy,
                criticalFailures: this.alerts
                    .filter(alert => alert.level === AlertLevel.EMERGENCY)
                    .map(alert => alert.system),
                systemsOnline: this.getSystemsOnlineCount(),
                totalSystems: 6,
                powerAvailable: this.electrical.getPowerStatus().totalGeneration > 0,
                emergencyPower: this.emergencyMode
            }
        };
    }

    public getEicasData(): EicasData {
        const electrical = this.electrical.getDisplayData();
        const fuel = this.fuel.getDisplayData();
        const hydraulics = this.hydraulic.getDisplayData();
        const environmental = this.environmental.getDisplayData();
        
        // Build engine data from aircraft state
        const engines = this.aircraftState.engines?.map((engine: any, index: number) => ({
            engineNumber: index + 1,
            status: engine.running ? SystemStatus.ON : SystemStatus.OFF,
            thrust: {
                current: engine.n1 || 0,
                target: engine.n1Target || 0,
                limit: 100,
                mode: 'CLIMB' as const
            },
            temperatures: {
                n1: engine.n1 || 0,
                n2: engine.n2 || 0,
                egt: engine.egt || 0,
                itt: engine.itt || 0,
                cht: engine.cht || 0,
                oil: engine.oilTemp || 0
            },
            pressures: {
                oil: engine.oilPressure || 0,
                fuel: engine.fuelPressure || 0,
                manifold: engine.manifoldPressure || 0
            },
            flow: {
                fuel: engine.fuelFlow || 0,
                oil: 0
            },
            vibration: {
                n1: 0,
                n2: 0
            },
            reverser: {
                deployed: false,
                position: 0
            },
            ignition: {
                left: false,
                right: false,
                continuous: false
            },
            starter: {
                engaged: false,
                airValve: false,
                cutoff: false
            }
        })) || [];

        return {
            engines,
            fuel,
            hydraulics,
            electrical,
            environmental,
            alerts: this.alerts,
            configuration: this.warnings.getConfigurationStatus()
        };
    }

    public getAllAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public getEmergencyProcedures(): EmergencyProcedures {
        return { ...this.emergencyProcedures };
    }

    public getIntegrationData(): SystemIntegrationData {
        return { ...this.integrationData };
    }

    private getSystemsOnlineCount(): number {
        let count = 0;
        if (this.electrical.isSystemHealthy()) count++;
        if (this.hydraulic.isSystemHealthy()) count++;
        if (this.fuel.isSystemHealthy()) count++;
        if (this.environmental.isSystemHealthy()) count++;
        if (this.warnings.isSystemHealthy()) count++;
        // Avionics health check would be more complex
        count++; // Assume avionics healthy for now
        return count;
    }

    public isEmergencyMode(): boolean {
        return this.emergencyMode;
    }

    public isSystemsHealthy(): boolean {
        return this.systemsHealthy;
    }
}