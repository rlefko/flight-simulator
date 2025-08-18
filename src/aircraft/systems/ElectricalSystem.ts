import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    ElectricalDisplayData, 
    GeneratorData, 
    BatteryData, 
    BusData, 
    InverterData,
    ElectricalConfig,
    AlertData 
} from './InstrumentData';

/**
 * Comprehensive electrical system simulation
 * Models generators, batteries, bus architecture, and load management
 */

export interface CircuitBreaker {
    name: string;
    rating: number;         // amps
    tripped: boolean;
    essential: boolean;
    load: number;           // current amps
}

export interface ElectricalLoad {
    name: string;
    bus: string;            // connected bus
    rating: number;         // amps
    priority: number;       // 1-10 (1=highest)
    essential: boolean;
    powered: boolean;
    actual: number;         // actual draw amps
}

export interface Generator {
    name: string;
    type: 'ENGINE' | 'APU' | 'RAT' | 'GROUND';
    engineNumber?: number;
    status: SystemStatus;
    online: boolean;
    voltage: number;        // volts
    current: number;        // amps
    frequency: number;      // Hz
    power: number;          // KW
    ratedPower: number;     // KW
    ratedVoltage: number;   // volts
    ratedFrequency: number; // Hz
    speed: number;          // RPM
    temperature: number;    // degrees C
    overloadTime: number;   // seconds in overload
    maxOverloadTime: number; // seconds before shutdown
    gcb: boolean;           // generator control breaker
    field: boolean;         // field excitation
    faults: string[];
}

export interface Battery {
    name: string;
    status: SystemStatus;
    voltage: number;        // volts
    current: number;        // amps (+ charging, - discharging)
    capacity: number;       // amp-hours
    remainingCapacity: number; // amp-hours
    temperature: number;    // degrees C
    switchPosition: 'OFF' | 'ON' | 'AUTO';
    contactor: boolean;     // main contactor closed
    chargeRate: number;     // amps
    dischargeRate: number;  // amps
    internal: {
        resistance: number;  // ohms
        esr: number;        // equivalent series resistance
        soc: number;        // state of charge (0-1)
    };
    thermal: {
        heatGeneration: number; // watts
        coolingRate: number;    // watts per degree
    };
}

export interface ElectricalBus {
    name: string;
    type: 'AC' | 'DC';
    voltage: number;        // volts
    frequency?: number;     // Hz for AC buses
    powered: boolean;
    source: string;         // current power source
    loads: ElectricalLoad[];
    totalLoad: number;      // amps
    availablePower: number; // amps
    priority: number;       // bus priority
    essential: boolean;
    automatic: boolean;     // automatic switching
    contactors: string[];   // connected contactors
    tieBreakers: string[];  // tie breakers
}

export interface Inverter {
    name: string;
    status: SystemStatus;
    online: boolean;
    input: {
        voltage: number;    // volts DC
        current: number;    // amps
        power: number;      // watts
    };
    output: {
        voltage: number;    // volts AC
        frequency: number;  // Hz
        current: number;    // amps
        power: number;      // watts
    };
    efficiency: number;     // 0-1
    temperature: number;    // degrees C
    ratedPower: number;     // watts
    overloadTime: number;   // seconds
}

export interface PowerDistribution {
    contactors: Map<string, boolean>;
    tieBreakers: Map<string, boolean>;
    relays: Map<string, boolean>;
    switches: Map<string, string>;
}

export class ElectricalSystem {
    private config: ElectricalConfig;
    private generators: Map<string, Generator> = new Map();
    private batteries: Map<string, Battery> = new Map();
    private buses: Map<string, ElectricalBus> = new Map();
    private inverters: Map<string, Inverter> = new Map();
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();
    private loads: Map<string, ElectricalLoad> = new Map();
    private powerDistribution: PowerDistribution;
    
    private alerts: AlertData[] = [];
    private engineRpm: number[] = [0, 0, 0, 0];
    private apuRpm: number = 0;
    private groundPowerAvailable: boolean = false;
    private ratDeployed: boolean = false;
    private airspeed: number = 0;

    constructor(config: ElectricalConfig) {
        this.config = config;
        this.powerDistribution = {
            contactors: new Map(),
            tieBreakers: new Map(),
            relays: new Map(),
            switches: new Map()
        };
        
        this.initializeSystem();
    }

    /**
     * Initialize electrical system components
     */
    private initializeSystem(): void {
        this.initializeGenerators();
        this.initializeBatteries();
        this.initializeBuses();
        this.initializeInverters();
        this.initializeCircuitBreakers();
        this.initializeLoads();
        this.initializePowerDistribution();
    }

    private initializeGenerators(): void {
        // Engine generators
        for (let i = 0; i < this.config.generators.count - 1; i++) {
            const gen: Generator = {
                name: `ENG ${i + 1} GEN`,
                type: 'ENGINE',
                engineNumber: i + 1,
                status: SystemStatus.OFF,
                online: false,
                voltage: 0,
                current: 0,
                frequency: 0,
                power: 0,
                ratedPower: this.config.generators.ratedPower,
                ratedVoltage: this.config.generators.voltage,
                ratedFrequency: this.config.generators.frequency,
                speed: 0,
                temperature: 20,
                overloadTime: 0,
                maxOverloadTime: 120,
                gcb: false,
                field: false,
                faults: []
            };
            this.generators.set(gen.name, gen);
        }

        // APU generator
        const apuGen: Generator = {
            name: 'APU GEN',
            type: 'APU',
            status: SystemStatus.OFF,
            online: false,
            voltage: 0,
            current: 0,
            frequency: 0,
            power: 0,
            ratedPower: this.config.generators.ratedPower * 0.8,
            ratedVoltage: this.config.generators.voltage,
            ratedFrequency: this.config.generators.frequency,
            speed: 0,
            temperature: 20,
            overloadTime: 0,
            maxOverloadTime: 60,
            gcb: false,
            field: false,
            faults: []
        };
        this.generators.set('APU GEN', apuGen);

        // Ground power
        const groundGen: Generator = {
            name: 'GROUND PWR',
            type: 'GROUND',
            status: SystemStatus.OFF,
            online: false,
            voltage: 0,
            current: 0,
            frequency: 0,
            power: 0,
            ratedPower: this.config.generators.ratedPower * 1.5,
            ratedVoltage: this.config.generators.voltage,
            ratedFrequency: this.config.generators.frequency,
            speed: 0,
            temperature: 20,
            overloadTime: 0,
            maxOverloadTime: Infinity,
            gcb: false,
            field: true,
            faults: []
        };
        this.generators.set('GROUND PWR', groundGen);

        // RAT generator (if equipped)
        if (this.config.generators.count > 2) {
            const ratGen: Generator = {
                name: 'RAT GEN',
                type: 'RAT',
                status: SystemStatus.OFF,
                online: false,
                voltage: 0,
                current: 0,
                frequency: 0,
                power: 0,
                ratedPower: this.config.generators.ratedPower * 0.1,
                ratedVoltage: this.config.generators.voltage,
                ratedFrequency: this.config.generators.frequency,
                speed: 0,
                temperature: 20,
                overloadTime: 0,
                maxOverloadTime: 300,
                gcb: false,
                field: false,
                faults: []
            };
            this.generators.set('RAT GEN', ratGen);
        }
    }

    private initializeBatteries(): void {
        for (let i = 0; i < this.config.batteries.count; i++) {
            const battery: Battery = {
                name: `BATT ${i + 1}`,
                status: SystemStatus.OFF,
                voltage: this.config.batteries.voltage,
                current: 0,
                capacity: this.config.batteries.capacity,
                remainingCapacity: this.config.batteries.capacity,
                temperature: 20,
                switchPosition: 'OFF',
                contactor: false,
                chargeRate: 0,
                dischargeRate: 0,
                internal: {
                    resistance: 0.01,
                    esr: 0.005,
                    soc: 1.0
                },
                thermal: {
                    heatGeneration: 0,
                    coolingRate: 10
                }
            };
            this.batteries.set(battery.name, battery);
        }
    }

    private initializeBuses(): void {
        // Main AC buses
        this.config.buses.main.forEach((busName, index) => {
            const bus: ElectricalBus = {
                name: busName,
                type: 'AC',
                voltage: 0,
                frequency: 0,
                powered: false,
                source: 'NONE',
                loads: [],
                totalLoad: 0,
                availablePower: 0,
                priority: 1,
                essential: false,
                automatic: true,
                contactors: [`${busName}_CTR`],
                tieBreakers: [`${busName}_TIE`]
            };
            this.buses.set(busName, bus);
        });

        // Essential AC bus
        this.config.buses.essential.forEach(busName => {
            const bus: ElectricalBus = {
                name: busName,
                type: 'AC',
                voltage: 0,
                frequency: 0,
                powered: false,
                source: 'NONE',
                loads: [],
                totalLoad: 0,
                availablePower: 0,
                priority: 10,
                essential: true,
                automatic: true,
                contactors: [`${busName}_CTR`],
                tieBreakers: []
            };
            this.buses.set(busName, bus);
        });

        // DC buses
        const dcBuses = ['MAIN DC', 'ESS DC', 'BATT DC', 'HOT BATT'];
        dcBuses.forEach(busName => {
            const bus: ElectricalBus = {
                name: busName,
                type: 'DC',
                voltage: 0,
                powered: false,
                source: 'NONE',
                loads: [],
                totalLoad: 0,
                availablePower: 0,
                priority: busName === 'HOT BATT' ? 10 : busName.includes('ESS') ? 9 : 5,
                essential: busName.includes('ESS') || busName.includes('HOT'),
                automatic: true,
                contactors: [`${busName}_CTR`],
                tieBreakers: busName === 'MAIN DC' ? ['DC_TIE'] : []
            };
            this.buses.set(busName, bus);
        });
    }

    private initializeInverters(): void {
        for (let i = 1; i <= 2; i++) {
            const inverter: Inverter = {
                name: `INV ${i}`,
                status: SystemStatus.OFF,
                online: false,
                input: {
                    voltage: 0,
                    current: 0,
                    power: 0
                },
                output: {
                    voltage: 0,
                    frequency: 0,
                    current: 0,
                    power: 0
                },
                efficiency: 0.92,
                temperature: 20,
                ratedPower: 1500,
                overloadTime: 0
            };
            this.inverters.set(inverter.name, inverter);
        }
    }

    private initializeCircuitBreakers(): void {
        // Essential circuit breakers
        const essentialBreakers = [
            'BATT 1', 'BATT 2', 'GEN 1', 'GEN 2', 'APU GEN',
            'ESS AC', 'ESS DC', 'INV 1', 'INV 2'
        ];

        essentialBreakers.forEach(name => {
            const cb: CircuitBreaker = {
                name,
                rating: 200,
                tripped: false,
                essential: true,
                load: 0
            };
            this.circuitBreakers.set(name, cb);
        });

        // Non-essential circuit breakers
        const nonEssentialBreakers = [
            'GALLEY', 'CABIN LTG', 'NAV LTG', 'STROBE',
            'PITOT HEAT 1', 'PITOT HEAT 2', 'WINDOW HEAT'
        ];

        nonEssentialBreakers.forEach(name => {
            const cb: CircuitBreaker = {
                name,
                rating: 50,
                tripped: false,
                essential: false,
                load: 0
            };
            this.circuitBreakers.set(name, cb);
        });
    }

    private initializeLoads(): void {
        // Define electrical loads with priorities
        const loadDefinitions = [
            { name: 'EFIS 1', bus: 'ESS AC', rating: 5, priority: 1, essential: true },
            { name: 'EFIS 2', bus: 'MAIN AC 2', rating: 5, priority: 2, essential: false },
            { name: 'FMS 1', bus: 'ESS AC', rating: 3, priority: 1, essential: true },
            { name: 'FMS 2', bus: 'MAIN AC 2', rating: 3, priority: 2, essential: false },
            { name: 'AUTOPILOT', bus: 'ESS AC', rating: 2, priority: 1, essential: true },
            { name: 'RADIOS', bus: 'ESS AC', rating: 8, priority: 1, essential: true },
            { name: 'TRANSPONDER', bus: 'ESS AC', rating: 2, priority: 1, essential: true },
            { name: 'PITOT HEAT 1', bus: 'ESS AC', rating: 15, priority: 3, essential: true },
            { name: 'PITOT HEAT 2', bus: 'MAIN AC 2', rating: 15, priority: 4, essential: false },
            { name: 'WINDOW HEAT', bus: 'MAIN AC 1', rating: 25, priority: 5, essential: false },
            { name: 'FUEL PUMPS', bus: 'MAIN AC 1', rating: 10, priority: 2, essential: false },
            { name: 'HYDRAULIC PUMPS', bus: 'MAIN AC 1', rating: 20, priority: 2, essential: false },
            { name: 'CABIN LIGHTS', bus: 'MAIN AC 2', rating: 8, priority: 8, essential: false },
            { name: 'GALLEY', bus: 'MAIN AC 2', rating: 40, priority: 9, essential: false },
            { name: 'ENTERTAINMENT', bus: 'MAIN AC 2', rating: 15, priority: 10, essential: false }
        ];

        loadDefinitions.forEach(def => {
            const load: ElectricalLoad = {
                name: def.name,
                bus: def.bus,
                rating: def.rating,
                priority: def.priority,
                essential: def.essential,
                powered: false,
                actual: 0
            };
            this.loads.set(def.name, load);
            
            // Add load to its bus
            const bus = this.buses.get(def.bus);
            if (bus) {
                bus.loads.push(load);
            }
        });
    }

    private initializePowerDistribution(): void {
        // Initialize contactors (normally open)
        const contactors = [
            'GEN1_CTR', 'GEN2_CTR', 'APU_CTR', 'GROUND_CTR',
            'BATT1_CTR', 'BATT2_CTR', 'ESS_CTR', 'INV1_CTR', 'INV2_CTR'
        ];
        
        contactors.forEach(name => {
            this.powerDistribution.contactors.set(name, false);
        });

        // Initialize tie breakers (normally open)
        const tieBreakers = ['AC_TIE', 'DC_TIE'];
        tieBreakers.forEach(name => {
            this.powerDistribution.tieBreakers.set(name, false);
        });

        // Initialize switches
        this.powerDistribution.switches.set('BATT1_SW', 'OFF');
        this.powerDistribution.switches.set('BATT2_SW', 'OFF');
        this.powerDistribution.switches.set('GEN1_SW', 'ON');
        this.powerDistribution.switches.set('GEN2_SW', 'ON');
        this.powerDistribution.switches.set('APU_GEN_SW', 'ON');
    }

    /**
     * Update electrical system
     */
    public update(deltaTime: number, aircraftState: any): void {
        this.updateInputs(aircraftState);
        this.updateGenerators(deltaTime);
        this.updateBatteries(deltaTime);
        this.updateInverters(deltaTime);
        this.updatePowerDistribution();
        this.updateBuses();
        this.updateLoads();
        this.checkAlerts();
    }

    private updateInputs(aircraftState: any): void {
        if (aircraftState.engines) {
            this.engineRpm = aircraftState.engines.map((engine: any) => engine.n2 || 0);
        }
        this.apuRpm = aircraftState.apu?.rpm || 0;
        this.airspeed = aircraftState.airspeed?.true || 0;
    }

    private updateGenerators(deltaTime: number): void {
        this.generators.forEach(gen => {
            this.updateGenerator(gen, deltaTime);
        });
    }

    private updateGenerator(gen: Generator, deltaTime: number): void {
        // Update generator speed based on source
        switch (gen.type) {
            case 'ENGINE':
                if (gen.engineNumber && gen.engineNumber <= this.engineRpm.length) {
                    gen.speed = this.engineRpm[gen.engineNumber - 1];
                }
                break;
            case 'APU':
                gen.speed = this.apuRpm;
                break;
            case 'GROUND':
                gen.speed = this.groundPowerAvailable ? 1800 : 0;
                break;
            case 'RAT':
                gen.speed = this.ratDeployed && this.airspeed > 100 ? 
                    Math.min(6000, this.airspeed * 50) : 0;
                break;
        }

        // Update generator status
        const switchPos = this.powerDistribution.switches.get(`${gen.name.replace(' ', '_')}_SW`);
        const minSpeed = gen.type === 'GROUND' ? 0 : 1000;
        
        if (gen.speed > minSpeed && switchPos === 'ON' && gen.faults.length === 0) {
            gen.status = SystemStatus.ON;
            gen.field = true;
        } else {
            gen.status = SystemStatus.OFF;
            gen.field = false;
            gen.online = false;
        }

        // Calculate electrical output
        if (gen.status === SystemStatus.ON && gen.field) {
            const speedRatio = Math.min(1, gen.speed / 1800);
            gen.voltage = gen.ratedVoltage * speedRatio;
            gen.frequency = gen.ratedFrequency * speedRatio;
            
            // Generator can come online when parameters are stable
            if (gen.voltage > gen.ratedVoltage * 0.95 && 
                gen.frequency > gen.ratedFrequency * 0.98) {
                gen.online = gen.gcb;
            }
        } else {
            gen.voltage = 0;
            gen.frequency = 0;
            gen.current = 0;
            gen.power = 0;
            gen.online = false;
        }

        // Update temperature
        const heatGeneration = gen.power * 0.05; // 5% inefficiency
        const cooling = (gen.temperature - 20) * 0.1;
        gen.temperature += (heatGeneration - cooling) * deltaTime / 1000;

        // Check for overload
        if (gen.power > gen.ratedPower) {
            gen.overloadTime += deltaTime / 1000;
            if (gen.overloadTime > gen.maxOverloadTime) {
                gen.faults.push('OVERLOAD');
                gen.status = SystemStatus.FAILED;
            }
        } else {
            gen.overloadTime = Math.max(0, gen.overloadTime - deltaTime / 1000);
        }
    }

    private updateBatteries(deltaTime: number): void {
        this.batteries.forEach(battery => {
            this.updateBattery(battery, deltaTime);
        });
    }

    private updateBattery(battery: Battery, deltaTime: number): void {
        const switchOn = battery.switchPosition !== 'OFF';
        const contactorClosed = this.powerDistribution.contactors.get(`${battery.name}_CTR`) || false;
        
        battery.contactor = switchOn && contactorClosed;
        battery.status = battery.contactor ? SystemStatus.ON : SystemStatus.OFF;

        if (battery.contactor) {
            // Calculate voltage based on state of charge and load
            const baseVoltage = this.config.batteries.voltage;
            const socFactor = 0.9 + (battery.internal.soc * 0.1);
            const loadFactor = battery.current * battery.internal.resistance;
            battery.voltage = baseVoltage * socFactor - loadFactor;
        } else {
            battery.voltage = 0;
            battery.current = 0;
        }

        // Update state of charge
        if (battery.current !== 0) {
            const deltaAh = (battery.current * deltaTime) / 3600000; // mAs to Ah
            battery.remainingCapacity = Math.max(0, 
                Math.min(battery.capacity, battery.remainingCapacity - deltaAh));
            battery.internal.soc = battery.remainingCapacity / battery.capacity;
        }

        // Thermal model
        battery.thermal.heatGeneration = Math.abs(battery.current) * battery.voltage * 0.02;
        const cooling = (battery.temperature - 20) * battery.thermal.coolingRate;
        battery.temperature += (battery.thermal.heatGeneration - cooling) * deltaTime / 1000;
    }

    private updateInverters(deltaTime: number): void {
        this.inverters.forEach(inverter => {
            this.updateInverter(inverter, deltaTime);
        });
    }

    private updateInverter(inverter: Inverter, deltaTime: number): void {
        const dcBus = this.buses.get('MAIN DC');
        const switchOn = this.powerDistribution.switches.get(`${inverter.name}_SW`) === 'ON';
        
        if (switchOn && dcBus?.powered && dcBus.voltage > 20) {
            inverter.status = SystemStatus.ON;
            inverter.online = true;
            
            inverter.input.voltage = dcBus.voltage;
            inverter.output.voltage = this.config.generators.voltage;
            inverter.output.frequency = this.config.generators.frequency;
            
            // Calculate power conversion
            const outputPower = Math.min(inverter.ratedPower, inverter.input.power * inverter.efficiency);
            inverter.output.power = outputPower;
            inverter.output.current = outputPower / inverter.output.voltage;
            inverter.input.current = outputPower / (inverter.input.voltage * inverter.efficiency);
            inverter.input.power = outputPower / inverter.efficiency;
        } else {
            inverter.status = SystemStatus.OFF;
            inverter.online = false;
            inverter.input.voltage = 0;
            inverter.input.current = 0;
            inverter.input.power = 0;
            inverter.output.voltage = 0;
            inverter.output.current = 0;
            inverter.output.power = 0;
            inverter.output.frequency = 0;
        }

        // Update temperature
        const heatGeneration = inverter.input.power * (1 - inverter.efficiency);
        const cooling = (inverter.temperature - 20) * 0.2;
        inverter.temperature += (heatGeneration - cooling) * deltaTime / 1000;
    }

    private updatePowerDistribution(): void {
        // Auto-close generator contactors when online
        this.generators.forEach(gen => {
            const contactorName = `${gen.name.replace(' ', '_')}_CTR`;
            if (gen.online && !this.powerDistribution.contactors.get(contactorName)) {
                this.powerDistribution.contactors.set(contactorName, true);
                gen.gcb = true;
            } else if (!gen.online) {
                gen.gcb = false;
            }
        });

        // Auto-close battery contactors when switch is on
        this.batteries.forEach(battery => {
            const contactorName = `${battery.name}_CTR`;
            const switchOn = battery.switchPosition !== 'OFF';
            this.powerDistribution.contactors.set(contactorName, switchOn);
        });
    }

    private updateBuses(): void {
        this.buses.forEach(bus => {
            this.updateBus(bus);
        });
    }

    private updateBus(bus: ElectricalBus): void {
        // Find available power sources
        const availableSources: { name: string; voltage: number; frequency?: number; power: number }[] = [];
        
        // Check generators
        this.generators.forEach(gen => {
            const contactorClosed = this.powerDistribution.contactors.get(`${gen.name.replace(' ', '_')}_CTR`);
            if (gen.online && contactorClosed && bus.type === 'AC') {
                availableSources.push({
                    name: gen.name,
                    voltage: gen.voltage,
                    frequency: gen.frequency,
                    power: gen.ratedPower * 1000 / gen.ratedVoltage // Convert to amps
                });
            }
        });

        // Check batteries (for DC buses)
        if (bus.type === 'DC') {
            this.batteries.forEach(battery => {
                const contactorClosed = this.powerDistribution.contactors.get(`${battery.name}_CTR`);
                if (battery.contactor && contactorClosed && battery.voltage > 20) {
                    availableSources.push({
                        name: battery.name,
                        voltage: battery.voltage,
                        power: battery.capacity * 10 // Rough current capability
                    });
                }
            });
        }

        // Check inverters (for AC buses from DC)
        if (bus.type === 'AC') {
            this.inverters.forEach(inverter => {
                const contactorClosed = this.powerDistribution.contactors.get(`${inverter.name}_CTR`);
                if (inverter.online && contactorClosed) {
                    availableSources.push({
                        name: inverter.name,
                        voltage: inverter.output.voltage,
                        frequency: inverter.output.frequency,
                        power: inverter.output.current
                    });
                }
            });
        }

        // Select best power source
        if (availableSources.length > 0) {
            // Priority: Generator > Battery > Inverter
            const source = availableSources.reduce((best, current) => {
                const currentPriority = this.getSourcePriority(current.name);
                const bestPriority = this.getSourcePriority(best.name);
                return currentPriority < bestPriority ? current : best;
            });

            bus.powered = true;
            bus.source = source.name;
            bus.voltage = source.voltage;
            bus.frequency = source.frequency || 0;
            bus.availablePower = source.power;
        } else {
            bus.powered = false;
            bus.source = 'NONE';
            bus.voltage = 0;
            bus.frequency = 0;
            bus.availablePower = 0;
        }
    }

    private getSourcePriority(sourceName: string): number {
        if (sourceName.includes('GEN') && !sourceName.includes('APU')) return 1;
        if (sourceName.includes('APU')) return 2;
        if (sourceName.includes('BATT')) return 3;
        if (sourceName.includes('INV')) return 4;
        if (sourceName.includes('GROUND')) return 5;
        return 10;
    }

    private updateLoads(): void {
        // Reset load calculations
        this.buses.forEach(bus => {
            bus.totalLoad = 0;
        });

        // Update each load
        this.loads.forEach(load => {
            const bus = this.buses.get(load.bus);
            const cb = this.circuitBreakers.get(load.name);
            
            if (bus?.powered && (!cb || !cb.tripped)) {
                load.powered = true;
                load.actual = load.rating;
                bus.totalLoad += load.actual;
                
                if (cb) {
                    cb.load = load.actual;
                    // Check for circuit breaker trip
                    if (cb.load > cb.rating * 1.1) {
                        cb.tripped = true;
                        load.powered = false;
                        load.actual = 0;
                        bus.totalLoad -= load.rating;
                    }
                }
            } else {
                load.powered = false;
                load.actual = 0;
                if (cb) cb.load = 0;
            }
        });

        // Load shedding if necessary
        this.buses.forEach(bus => {
            if (bus.totalLoad > bus.availablePower) {
                this.performLoadShedding(bus);
            }
        });
    }

    private performLoadShedding(bus: ElectricalBus): void {
        // Sort loads by priority (higher number = lower priority)
        const sheddableLoads = bus.loads
            .filter(load => load.powered && !load.essential)
            .sort((a, b) => b.priority - a.priority);

        let excessLoad = bus.totalLoad - bus.availablePower;
        
        for (const load of sheddableLoads) {
            if (excessLoad <= 0) break;
            
            load.powered = false;
            load.actual = 0;
            bus.totalLoad -= load.rating;
            excessLoad -= load.rating;
        }
    }

    private checkAlerts(): void {
        this.alerts = [];

        // Generator alerts
        this.generators.forEach(gen => {
            if (gen.status === SystemStatus.FAILED) {
                this.alerts.push({
                    id: `${gen.name}_FAIL`,
                    level: AlertLevel.WARNING,
                    message: `${gen.name} FAULT`,
                    system: 'ELECTRICAL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
            
            if (gen.overloadTime > 60) {
                this.alerts.push({
                    id: `${gen.name}_OVERLOAD`,
                    level: AlertLevel.CAUTION,
                    message: `${gen.name} OVERLOAD`,
                    system: 'ELECTRICAL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
        });

        // Battery alerts
        this.batteries.forEach(battery => {
            if (battery.internal.soc < 0.2) {
                this.alerts.push({
                    id: `${battery.name}_LOW`,
                    level: AlertLevel.CAUTION,
                    message: `${battery.name} LOW`,
                    system: 'ELECTRICAL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
            
            if (battery.temperature > 60) {
                this.alerts.push({
                    id: `${battery.name}_HOT`,
                    level: AlertLevel.WARNING,
                    message: `${battery.name} HOT`,
                    system: 'ELECTRICAL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
        });

        // Bus alerts
        this.buses.forEach(bus => {
            if (bus.essential && !bus.powered) {
                this.alerts.push({
                    id: `${bus.name}_UNPOWERED`,
                    level: AlertLevel.WARNING,
                    message: `${bus.name} UNPOWERED`,
                    system: 'ELECTRICAL',
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
    public setBatterySwitch(battery: string, position: 'OFF' | 'ON' | 'AUTO'): void {
        const batt = this.batteries.get(battery);
        if (batt) {
            batt.switchPosition = position;
        }
    }

    public setGeneratorSwitch(generator: string, position: 'OFF' | 'ON'): void {
        this.powerDistribution.switches.set(`${generator.replace(' ', '_')}_SW`, position);
    }

    public resetCircuitBreaker(breakerName: string): void {
        const cb = this.circuitBreakers.get(breakerName);
        if (cb) {
            cb.tripped = false;
        }
    }

    public setGroundPowerAvailable(available: boolean): void {
        this.groundPowerAvailable = available;
    }

    public deployRAT(): void {
        this.ratDeployed = true;
    }

    /**
     * Get display data for instruments
     */
    public getDisplayData(): ElectricalDisplayData {
        const generators: GeneratorData[] = Array.from(this.generators.values()).map(gen => ({
            name: gen.name,
            status: gen.status,
            voltage: gen.voltage,
            current: gen.current,
            frequency: gen.frequency,
            power: gen.power,
            online: gen.online
        }));

        const batteries: BatteryData[] = Array.from(this.batteries.values()).map(batt => ({
            name: batt.name,
            status: batt.status,
            voltage: batt.voltage,
            current: batt.current,
            capacity: batt.remainingCapacity,
            temperature: batt.temperature,
            switchPosition: batt.switchPosition
        }));

        const buses: BusData[] = Array.from(this.buses.values()).map(bus => ({
            name: bus.name,
            status: bus.powered ? SystemStatus.ON : SystemStatus.OFF,
            voltage: bus.voltage,
            frequency: bus.frequency || 0,
            powered: bus.powered,
            source: bus.source
        }));

        const inverters: InverterData[] = Array.from(this.inverters.values()).map(inv => ({
            name: inv.name,
            status: inv.status,
            input: {
                voltage: inv.input.voltage,
                current: inv.input.current
            },
            output: {
                voltage: inv.output.voltage,
                frequency: inv.output.frequency,
                current: inv.output.current
            }
        }));

        return {
            generators,
            batteries,
            buses,
            inverters,
            load: {
                total: Array.from(this.loads.values()).reduce((sum, load) => sum + load.actual, 0),
                essential: Array.from(this.loads.values())
                    .filter(load => load.essential)
                    .reduce((sum, load) => sum + load.actual, 0),
                nonEssential: Array.from(this.loads.values())
                    .filter(load => !load.essential)
                    .reduce((sum, load) => sum + load.actual, 0)
            }
        };
    }

    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    /**
     * System status methods
     */
    public isSystemHealthy(): boolean {
        return this.alerts.filter(alert => 
            alert.level === AlertLevel.WARNING || alert.level === AlertLevel.EMERGENCY
        ).length === 0;
    }

    public getPowerStatus(): { totalGeneration: number; totalConsumption: number; batteryTime: number } {
        const totalGeneration = Array.from(this.generators.values())
            .filter(gen => gen.online)
            .reduce((sum, gen) => sum + gen.power, 0);
            
        const totalConsumption = Array.from(this.loads.values())
            .reduce((sum, load) => sum + load.actual * (load.bus.includes('AC') ? 115 : 28) / 1000, 0);
        
        const batteryPower = Array.from(this.batteries.values())
            .reduce((sum, batt) => sum + (batt.current < 0 ? Math.abs(batt.current * batt.voltage / 1000) : 0), 0);
        
        const batteryTime = batteryPower > 0 ? 
            Array.from(this.batteries.values())
                .reduce((sum, batt) => sum + batt.remainingCapacity, 0) / batteryPower * 3600 : Infinity;

        return {
            totalGeneration,
            totalConsumption,
            batteryTime
        };
    }
}