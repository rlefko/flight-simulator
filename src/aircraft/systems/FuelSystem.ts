import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    FuelSystemData,
    FuelTankData,
    FuelPumpData,
    FuelConfig,
    AlertData 
} from './InstrumentData';

/**
 * Comprehensive fuel system simulation
 * Models fuel tanks, pumps, transfer, consumption, and center of gravity effects
 */

export interface FuelTank {
    name: string;
    position: Vector3;          // CG position relative to aircraft datum
    capacity: number;           // maximum fuel capacity (lbs or gallons)
    quantity: number;           // current fuel quantity (lbs or gallons)
    usableQuantity: number;     // usable fuel (excludes unusable)
    unusableQuantity: number;   // unusable fuel
    temperature: number;        // fuel temperature (degrees C)
    density: number;            // fuel density (lbs/gal)
    viscosity: number;          // fuel viscosity (cSt)
    contamination: number;      // contamination level (0-1)
    icing: boolean;             // fuel icing condition
    venting: boolean;           // tank venting status
    pumps: string[];            // associated pump names
    valves: string[];           // associated valve names
    sensors: FuelSensor[];      // quantity sensors
    lowLevel: boolean;          // low fuel level
    fuelType: 'JET_A' | 'JET_A1' | 'AVGAS' | '100LL';
}

export interface FuelSensor {
    name: string;
    type: 'CAPACITANCE' | 'FLOAT' | 'ULTRASONIC';
    reading: number;            // raw sensor reading
    calibrated: number;         // calibrated fuel quantity
    accuracy: number;           // sensor accuracy (0-1)
    failed: boolean;            // sensor failure
    compensation: {
        temperature: boolean;   // temperature compensation
        density: boolean;       // density compensation
    };
}

export interface FuelPump {
    name: string;
    tank: string;               // source tank
    type: 'BOOST' | 'TRANSFER' | 'SCAVENGE' | 'EJECTOR';
    status: SystemStatus;
    enabled: boolean;
    pressure: number;           // discharge pressure (PSI)
    flow: number;               // current flow rate (GPH)
    ratedFlow: number;          // rated flow capacity (GPH)
    ratedPressure: number;      // rated discharge pressure (PSI)
    temperature: number;        // pump temperature (degrees C)
    efficiency: number;         // pump efficiency (0-1)
    powerConsumption: number;   // electrical power (watts)
    cavitation: boolean;        // cavitation condition
    priming: boolean;           // pump priming status
    overrideSwitch: boolean;    // manual override
    faults: string[];
}

export interface FuelValve {
    name: string;
    type: 'SHUTOFF' | 'TRANSFER' | 'CROSSFEED' | 'JETTISON' | 'CHECK';
    position: number;           // valve position (0-1, 0=closed, 1=open)
    targetPosition: number;     // commanded position
    flow: number;               // current flow through valve (GPH)
    pressure: {
        inlet: number;          // inlet pressure (PSI)
        outlet: number;         // outlet pressure (PSI)
    };
    leakage: number;            // internal leakage (GPH)
    responseTime: number;       // valve response time (seconds)
    automated: boolean;         // automatic operation
    failed: boolean;            // valve failure (stuck)
    failurePosition: number;    // position when failed
}

export interface FuelLine {
    name: string;
    from: string;               // source (tank or component)
    to: string;                 // destination (engine or tank)
    diameter: number;           // internal diameter (inches)
    length: number;             // line length (feet)
    flow: number;               // current flow (GPH)
    pressure: number;           // line pressure (PSI)
    temperature: number;        // fuel temperature (degrees C)
    restrictions: number;       // flow restrictions (0-1)
    filters: FuelFilter[];
}

export interface FuelFilter {
    name: string;
    type: 'PRIMARY' | 'SECONDARY' | 'BYPASS';
    differential: number;       // pressure differential (PSI)
    bypassActive: boolean;      // bypass valve active
    changeRequired: boolean;    // filter change required
    contamination: number;      // contamination captured (0-1)
}

export interface FuelManagementSystem {
    mode: 'MANUAL' | 'AUTO';
    sequence: string[];         // tank usage sequence
    balancing: boolean;         // automatic balancing
    crossfeed: boolean;         // crossfeed valve open
    jettison: boolean;          // jettison system active
    jettisonRate: number;       // jettison flow rate (GPH)
    fuelPlanning: {
        trip: number;           // trip fuel (lbs)
        reserve: number;        // reserve fuel (lbs)
        alternate: number;      // alternate fuel (lbs)
        taxi: number;           // taxi fuel (lbs)
        contingency: number;    // contingency fuel (lbs)
    };
}

export interface CenterOfGravity {
    current: Vector3;           // current CG position
    empty: Vector3;             // empty weight CG
    fuel: Vector3;              // fuel CG contribution
    payload: Vector3;           // payload CG contribution
    percentMAC: number;         // CG as % of mean aerodynamic chord
    forwardLimit: number;       // forward CG limit (% MAC)
    aftLimit: number;           // aft CG limit (% MAC)
    withinLimits: boolean;      // CG within limits
}

export class FuelSystem {
    private config: FuelConfig;
    private tanks: Map<string, FuelTank> = new Map();
    private pumps: Map<string, FuelPump> = new Map();
    private valves: Map<string, FuelValve> = new Map();
    private lines: Map<string, FuelLine> = new Map();
    private fms: FuelManagementSystem;
    private cg: CenterOfGravity;
    
    private alerts: AlertData[] = [];
    private engines: any[] = [];
    private electricalPower: boolean = false;
    private ambientTemperature: number = 20;
    private altitude: number = 0;
    
    // Fuel properties by type
    private readonly FUEL_PROPERTIES = {
        'JET_A': { density: 6.8, freezePoint: -40, flashPoint: 38, viscosity: 1.25 },
        'JET_A1': { density: 6.8, freezePoint: -47, flashPoint: 38, viscosity: 1.25 },
        'AVGAS': { density: 6.0, freezePoint: -58, flashPoint: -43, viscosity: 0.7 },
        '100LL': { density: 6.0, freezePoint: -58, flashPoint: -43, viscosity: 0.7 }
    };

    constructor(config: FuelConfig) {
        this.config = config;
        this.initializeSystem();
    }

    /**
     * Initialize fuel system components
     */
    private initializeSystem(): void {
        this.initializeTanks();
        this.initializePumps();
        this.initializeValves();
        this.initializeFuelLines();
        this.initializeFuelManagement();
        this.initializeCenterOfGravity();
    }

    private initializeTanks(): void {
        this.config.tanks.names.forEach((name, index) => {
            const capacity = this.config.tanks.capacities[index];
            const position = this.config.tanks.positions[index];
            
            const tank: FuelTank = {
                name,
                position,
                capacity,
                quantity: capacity * 0.8, // Start with 80% fuel
                usableQuantity: capacity * 0.95,
                unusableQuantity: capacity * 0.05,
                temperature: 20,
                density: 6.8, // JET-A density
                viscosity: 1.25,
                contamination: 0,
                icing: false,
                venting: true,
                pumps: [],
                valves: [],
                sensors: this.createFuelSensors(name),
                lowLevel: false,
                fuelType: 'JET_A'
            };
            
            this.tanks.set(name, tank);
        });
    }

    private createFuelSensors(tankName: string): FuelSensor[] {
        const sensors: FuelSensor[] = [];
        
        // Primary capacitance sensor
        sensors.push({
            name: `${tankName}_PRIM`,
            type: 'CAPACITANCE',
            reading: 0,
            calibrated: 0,
            accuracy: 0.95,
            failed: false,
            compensation: {
                temperature: true,
                density: true
            }
        });
        
        // Backup float sensor
        sensors.push({
            name: `${tankName}_SEC`,
            type: 'FLOAT',
            reading: 0,
            calibrated: 0,
            accuracy: 0.85,
            failed: false,
            compensation: {
                temperature: false,
                density: false
            }
        });
        
        return sensors;
    }

    private initializePumps(): void {
        const pumpConfigs = [
            // Main tank boost pumps
            { name: 'LEFT MAIN BOOST', tank: 'LEFT_MAIN', type: 'BOOST' as const, flow: 300 },
            { name: 'RIGHT MAIN BOOST', tank: 'RIGHT_MAIN', type: 'BOOST' as const, flow: 300 },
            
            // Center tank pumps
            { name: 'CENTER FWD BOOST', tank: 'CENTER', type: 'BOOST' as const, flow: 200 },
            { name: 'CENTER AFT BOOST', tank: 'CENTER', type: 'BOOST' as const, flow: 200 },
            
            // Transfer pumps
            { name: 'LEFT TRANSFER', tank: 'LEFT_MAIN', type: 'TRANSFER' as const, flow: 150 },
            { name: 'RIGHT TRANSFER', tank: 'RIGHT_MAIN', type: 'TRANSFER' as const, flow: 150 },
            
            // Scavenge pumps
            { name: 'LEFT SCAVENGE', tank: 'LEFT_MAIN', type: 'SCAVENGE' as const, flow: 50 },
            { name: 'RIGHT SCAVENGE', tank: 'RIGHT_MAIN', type: 'SCAVENGE' as const, flow: 50 }
        ];

        pumpConfigs.forEach(config => {
            if (this.tanks.has(config.tank)) {
                const pump: FuelPump = {
                    name: config.name,
                    tank: config.tank,
                    type: config.type,
                    status: SystemStatus.OFF,
                    enabled: false,
                    pressure: 0,
                    flow: 0,
                    ratedFlow: config.flow,
                    ratedPressure: config.type === 'BOOST' ? 25 : 15,
                    temperature: 20,
                    efficiency: 0.85,
                    powerConsumption: 0,
                    cavitation: false,
                    priming: false,
                    overrideSwitch: false,
                    faults: []
                };
                
                this.pumps.set(config.name, pump);
                
                // Associate pump with tank
                const tank = this.tanks.get(config.tank);
                if (tank) {
                    tank.pumps.push(config.name);
                }
            }
        });
    }

    private initializeValves(): void {
        const valveConfigs = [
            // Engine feed valves
            { name: 'ENG 1 FEED', type: 'SHUTOFF' as const },
            { name: 'ENG 2 FEED', type: 'SHUTOFF' as const },
            { name: 'ENG 3 FEED', type: 'SHUTOFF' as const },
            { name: 'ENG 4 FEED', type: 'SHUTOFF' as const },
            
            // Crossfeed valves
            { name: 'CROSSFEED', type: 'CROSSFEED' as const },
            
            // Tank isolation valves
            { name: 'LEFT MAIN ISOL', type: 'SHUTOFF' as const },
            { name: 'RIGHT MAIN ISOL', type: 'SHUTOFF' as const },
            { name: 'CENTER ISOL', type: 'SHUTOFF' as const },
            
            // Transfer valves
            { name: 'LEFT TRANSFER', type: 'TRANSFER' as const },
            { name: 'RIGHT TRANSFER', type: 'TRANSFER' as const },
            
            // Jettison valves
            { name: 'JETTISON LEFT', type: 'JETTISON' as const },
            { name: 'JETTISON RIGHT', type: 'JETTISON' as const }
        ];

        valveConfigs.forEach(config => {
            const valve: FuelValve = {
                name: config.name,
                type: config.type,
                position: config.type === 'SHUTOFF' ? 1 : 0, // Shutoff valves start open
                targetPosition: config.type === 'SHUTOFF' ? 1 : 0,
                flow: 0,
                pressure: { inlet: 0, outlet: 0 },
                leakage: 0.1, // Small internal leakage
                responseTime: config.type === 'SHUTOFF' ? 3 : 5,
                automated: config.name.includes('TRANSFER'),
                failed: false,
                failurePosition: config.type === 'SHUTOFF' ? 1 : 0
            };
            
            this.valves.set(config.name, valve);
        });
    }

    private initializeFuelLines(): void {
        const lineConfigs = [
            { name: 'LEFT_MAIN_TO_ENG1', from: 'LEFT_MAIN', to: 'ENGINE_1', diameter: 2, length: 15 },
            { name: 'RIGHT_MAIN_TO_ENG2', from: 'RIGHT_MAIN', to: 'ENGINE_2', diameter: 2, length: 15 },
            { name: 'CENTER_TO_LEFT', from: 'CENTER', to: 'LEFT_MAIN', diameter: 1.5, length: 8 },
            { name: 'CENTER_TO_RIGHT', from: 'CENTER', to: 'RIGHT_MAIN', diameter: 1.5, length: 8 },
            { name: 'CROSSFEED_LINE', from: 'LEFT_MAIN', to: 'RIGHT_MAIN', diameter: 1.5, length: 12 }
        ];

        lineConfigs.forEach(config => {
            const line: FuelLine = {
                name: config.name,
                from: config.from,
                to: config.to,
                diameter: config.diameter,
                length: config.length,
                flow: 0,
                pressure: 0,
                temperature: 20,
                restrictions: 0,
                filters: [
                    {
                        name: `${config.name}_FILTER`,
                        type: 'PRIMARY',
                        differential: 0,
                        bypassActive: false,
                        changeRequired: false,
                        contamination: 0
                    }
                ]
            };
            
            this.lines.set(config.name, line);
        });
    }

    private initializeFuelManagement(): void {
        this.fms = {
            mode: 'AUTO',
            sequence: ['CENTER', 'LEFT_MAIN', 'RIGHT_MAIN'],
            balancing: true,
            crossfeed: false,
            jettison: false,
            jettisonRate: 0,
            fuelPlanning: {
                trip: 15000,
                reserve: 3000,
                alternate: 2000,
                taxi: 800,
                contingency: 500
            }
        };
    }

    private initializeCenterOfGravity(): void {
        this.cg = {
            current: new Vector3(0, 0, 0),
            empty: new Vector3(0, 0, 0),
            fuel: new Vector3(0, 0, 0),
            payload: new Vector3(0, 0, 0),
            percentMAC: 25,
            forwardLimit: 15,
            aftLimit: 35,
            withinLimits: true
        };
    }

    /**
     * Update fuel system
     */
    public update(deltaTime: number, aircraftState: any, electricalStatus: any): void {
        this.updateInputs(aircraftState, electricalStatus);
        this.updateFuelConsumption(deltaTime);
        this.updatePumps(deltaTime);
        this.updateValves(deltaTime);
        this.updateFuelTransfer(deltaTime);
        this.updateTankConditions(deltaTime);
        this.updateFuelSensors();
        this.updateFuelManagement(deltaTime);
        this.updateCenterOfGravity();
        this.checkAlerts();
    }

    private updateInputs(aircraftState: any, electricalStatus: any): void {
        this.engines = aircraftState.engines || [];
        this.electricalPower = electricalStatus.buses?.some((bus: any) => 
            bus.name.includes('MAIN') && bus.powered) || false;
        this.ambientTemperature = aircraftState.atmosphere?.temperature || 20;
        this.altitude = aircraftState.position?.altitude || 0;
    }

    private updateFuelConsumption(deltaTime: number): void {
        this.engines.forEach((engine, index) => {
            const engineNumber = index + 1;
            const feedValve = this.valves.get(`ENG ${engineNumber} FEED`);
            
            if (engine.running && feedValve && feedValve.position > 0.5) {
                const fuelFlow = engine.fuelFlow || 0; // GPH
                const deltaFuel = fuelFlow * deltaTime / 3600000; // Convert to gallons per millisecond
                
                // Determine fuel source tank
                const sourceTank = this.getEngineFuelSource(engineNumber);
                if (sourceTank) {
                    sourceTank.quantity = Math.max(0, sourceTank.quantity - deltaFuel);
                }
            }
        });
    }

    private getEngineFuelSource(engineNumber: number): FuelTank | null {
        // Simple logic: engines 1&3 feed from left, 2&4 from right, center tank feeds both
        if (this.fms.crossfeed) {
            // With crossfeed, find tank with most fuel
            let bestTank: FuelTank | null = null;
            let maxFuel = 0;
            
            this.tanks.forEach(tank => {
                if (tank.quantity > maxFuel && this.isTankAvailable(tank.name)) {
                    maxFuel = tank.quantity;
                    bestTank = tank;
                }
            });
            
            return bestTank;
        } else {
            // Normal feeding logic
            if (engineNumber === 1 || engineNumber === 3) {
                return this.tanks.get('LEFT_MAIN') || null;
            } else {
                return this.tanks.get('RIGHT_MAIN') || null;
            }
        }
    }

    private isTankAvailable(tankName: string): boolean {
        const tank = this.tanks.get(tankName);
        if (!tank) return false;
        
        // Check if tank has usable fuel and pumps are working
        const hasUsableFuel = tank.quantity > tank.unusableQuantity;
        const hasPressure = tank.pumps.some(pumpName => {
            const pump = this.pumps.get(pumpName);
            return pump && pump.status === SystemStatus.ON && pump.pressure > 5;
        });
        
        return hasUsableFuel && hasPressure;
    }

    private updatePumps(deltaTime: number): void {
        this.pumps.forEach(pump => {
            this.updatePump(pump, deltaTime);
        });
    }

    private updatePump(pump: FuelPump, deltaTime: number): void {
        const tank = this.tanks.get(pump.tank);
        if (!tank) return;

        // Determine if pump should be running
        const shouldRun = pump.enabled && this.electricalPower && 
                         tank.quantity > tank.unusableQuantity;

        if (shouldRun && pump.faults.length === 0) {
            pump.status = SystemStatus.ON;
            
            // Calculate pump performance
            const fuelLevel = tank.quantity / tank.capacity;
            const suction = Math.max(0, fuelLevel - 0.1); // Reduced suction at low levels
            const efficiency = pump.efficiency * suction;
            
            pump.flow = pump.ratedFlow * efficiency;
            pump.pressure = pump.ratedPressure * efficiency;
            
            // Power consumption
            pump.powerConsumption = (pump.flow / pump.ratedFlow) * 500; // Watts
            
            // Check for cavitation
            const npsh = tank.pressure + (tank.quantity / tank.capacity) * 14.7; // Net positive suction head
            pump.cavitation = npsh < 2;
            
            if (pump.cavitation) {
                pump.flow *= 0.5;
                pump.pressure *= 0.3;
            }
            
        } else {
            pump.status = SystemStatus.OFF;
            pump.flow = 0;
            pump.pressure = 0;
            pump.powerConsumption = 0;
            pump.cavitation = false;
        }

        // Update pump temperature
        const heatGeneration = pump.powerConsumption * (1 - pump.efficiency);
        const cooling = (pump.temperature - tank.temperature) * 0.1;
        pump.temperature += (heatGeneration - cooling) * deltaTime / 1000;

        // Check pump priming
        if (pump.status === SystemStatus.ON && pump.flow < pump.ratedFlow * 0.1) {
            pump.priming = true;
        } else {
            pump.priming = false;
        }
    }

    private updateValves(deltaTime: number): void {
        this.valves.forEach(valve => {
            this.updateValve(valve, deltaTime);
        });
    }

    private updateValve(valve: FuelValve, deltaTime: number): void {
        if (!valve.failed) {
            // Move valve toward target position
            const positionError = valve.targetPosition - valve.position;
            const maxRate = 1 / valve.responseTime; // Position change per second
            const deltaPosition = Math.sign(positionError) * 
                                 Math.min(Math.abs(positionError), maxRate * deltaTime / 1000);
            
            valve.position = Math.max(0, Math.min(1, valve.position + deltaPosition));
        }

        // Calculate flow through valve
        if (valve.position > 0) {
            const pressureDrop = Math.max(0, valve.pressure.inlet - valve.pressure.outlet);
            const flowCoeff = valve.position * 10; // Cv coefficient
            valve.flow = flowCoeff * Math.sqrt(pressureDrop) + valve.leakage;
        } else {
            valve.flow = valve.leakage;
        }

        // Automatic valve operations
        if (valve.automated) {
            this.handleAutomaticValve(valve);
        }
    }

    private handleAutomaticValve(valve: FuelValve): void {
        switch (valve.type) {
            case 'TRANSFER':
                // Transfer valves open based on fuel management system
                if (this.fms.mode === 'AUTO') {
                    const shouldOpen = this.shouldTransferFuel();
                    valve.targetPosition = shouldOpen ? 1 : 0;
                }
                break;
                
            case 'CROSSFEED':
                valve.targetPosition = this.fms.crossfeed ? 1 : 0;
                break;
        }
    }

    private shouldTransferFuel(): boolean {
        // Transfer fuel from center tank to maintain balance
        const centerTank = this.tanks.get('CENTER');
        const leftMain = this.tanks.get('LEFT_MAIN');
        const rightMain = this.tanks.get('RIGHT_MAIN');
        
        if (!centerTank || !leftMain || !rightMain) return false;
        
        const hasCenter = centerTank.quantity > centerTank.unusableQuantity;
        const imbalance = Math.abs(leftMain.quantity - rightMain.quantity);
        
        return hasCenter || imbalance > 1000; // 1000 lbs imbalance threshold
    }

    private updateFuelTransfer(deltaTime: number): void {
        if (this.fms.mode !== 'AUTO') return;

        // Center tank transfer
        const centerTank = this.tanks.get('CENTER');
        if (centerTank && centerTank.quantity > centerTank.unusableQuantity) {
            const transferRate = 200; // GPH
            const deltaFuel = transferRate * deltaTime / 3600000;
            
            const leftMain = this.tanks.get('LEFT_MAIN');
            const rightMain = this.tanks.get('RIGHT_MAIN');
            
            if (leftMain && rightMain) {
                // Transfer to maintain balance
                const leftSpace = leftMain.capacity - leftMain.quantity;
                const rightSpace = rightMain.capacity - rightMain.quantity;
                const totalSpace = leftSpace + rightSpace;
                
                if (totalSpace > 0) {
                    const leftRatio = leftSpace / totalSpace;
                    const rightRatio = rightSpace / totalSpace;
                    
                    const leftTransfer = deltaFuel * leftRatio;
                    const rightTransfer = deltaFuel * rightRatio;
                    
                    centerTank.quantity -= (leftTransfer + rightTransfer);
                    leftMain.quantity += leftTransfer;
                    rightMain.quantity += rightTransfer;
                    
                    // Ensure tank limits
                    leftMain.quantity = Math.min(leftMain.capacity, leftMain.quantity);
                    rightMain.quantity = Math.min(rightMain.capacity, rightMain.quantity);
                }
            }
        }

        // Balance main tanks
        if (this.fms.balancing) {
            this.balanceMainTanks(deltaTime);
        }
    }

    private balanceMainTanks(deltaTime: number): void {
        const leftMain = this.tanks.get('LEFT_MAIN');
        const rightMain = this.tanks.get('RIGHT_MAIN');
        
        if (!leftMain || !rightMain) return;
        
        const imbalance = leftMain.quantity - rightMain.quantity;
        const threshold = 500; // 500 lbs threshold
        
        if (Math.abs(imbalance) > threshold) {
            const transferRate = 100; // GPH
            const deltaFuel = transferRate * deltaTime / 3600000;
            const transfer = Math.min(deltaFuel, Math.abs(imbalance) / 2);
            
            if (imbalance > 0) {
                // Transfer from left to right
                leftMain.quantity -= transfer;
                rightMain.quantity += transfer;
            } else {
                // Transfer from right to left
                rightMain.quantity -= transfer;
                leftMain.quantity += transfer;
            }
        }
    }

    private updateTankConditions(deltaTime: number): void {
        this.tanks.forEach(tank => {
            this.updateTankCondition(tank, deltaTime);
        });
    }

    private updateTankCondition(tank: FuelTank, deltaTime: number): void {
        // Update fuel temperature
        const tempDelta = (this.ambientTemperature - tank.temperature) * 0.01;
        tank.temperature += tempDelta * deltaTime / 1000;
        
        // Update fuel density based on temperature
        const fuelProps = this.FUEL_PROPERTIES[tank.fuelType];
        const tempEffect = (tank.temperature - 15) * 0.0007; // Thermal expansion
        tank.density = fuelProps.density * (1 - tempEffect);
        
        // Check for fuel icing
        if (tank.temperature < fuelProps.freezePoint + 5) {
            tank.icing = true;
        } else if (tank.temperature > fuelProps.freezePoint + 10) {
            tank.icing = false;
        }
        
        // Update contamination (simplified model)
        if (tank.contamination < 0.1) {
            tank.contamination += 0.0001 * deltaTime / 1000; // Gradual contamination
        }
        
        // Update low level status
        tank.lowLevel = tank.quantity < (tank.capacity * 0.1);
        
        // Update fuel viscosity based on temperature
        const viscosityTempFactor = Math.exp((40 - tank.temperature) / 30);
        tank.viscosity = fuelProps.viscosity * viscosityTempFactor;
    }

    private updateFuelSensors(): void {
        this.tanks.forEach(tank => {
            tank.sensors.forEach(sensor => {
                this.updateFuelSensor(sensor, tank);
            });
        });
    }

    private updateFuelSensor(sensor: FuelSensor, tank: FuelTank): void {
        if (sensor.failed) return;
        
        // Base reading
        let reading = tank.quantity / tank.capacity;
        
        // Add sensor inaccuracies
        const noise = (Math.random() - 0.5) * 0.02; // ±1% noise
        reading += noise;
        
        // Temperature compensation
        if (sensor.compensation.temperature) {
            const tempFactor = 1 + (tank.temperature - 15) * 0.001;
            reading *= tempFactor;
        }
        
        // Density compensation
        if (sensor.compensation.density) {
            const densityFactor = tank.density / this.FUEL_PROPERTIES[tank.fuelType].density;
            reading *= densityFactor;
        }
        
        // Apply sensor accuracy
        const error = (Math.random() - 0.5) * 2 * (1 - sensor.accuracy);
        reading += error;
        
        sensor.reading = Math.max(0, Math.min(1, reading));
        sensor.calibrated = sensor.reading * tank.capacity;
        
        // Random sensor failures
        if (Math.random() < 0.00001) { // Very low probability per update
            sensor.failed = true;
        }
    }

    private updateFuelManagement(deltaTime: number): void {
        if (this.fms.mode === 'AUTO') {
            this.autoFuelManagement();
        }
        
        // Update jettison system
        if (this.fms.jettison) {
            this.performFuelJettison(deltaTime);
        }
    }

    private autoFuelManagement(): void {
        // Sequence through tanks according to FMS sequence
        let activeTank: FuelTank | null = null;
        
        for (const tankName of this.fms.sequence) {
            const tank = this.tanks.get(tankName);
            if (tank && tank.quantity > tank.unusableQuantity) {
                activeTank = tank;
                break;
            }
        }
        
        // Enable pumps for active tank
        this.pumps.forEach(pump => {
            if (activeTank && pump.tank === activeTank.name && pump.type === 'BOOST') {
                pump.enabled = true;
            } else if (pump.type === 'BOOST') {
                pump.enabled = false;
            }
        });
    }

    private performFuelJettison(deltaTime: number): void {
        const jettisonRate = this.fms.jettisonRate; // GPH
        const deltaFuel = jettisonRate * deltaTime / 3600000;
        
        // Jettison from specified tanks (typically wing tanks)
        const jettisonTanks = ['LEFT_MAIN', 'RIGHT_MAIN'];
        jettisonTanks.forEach(tankName => {
            const tank = this.tanks.get(tankName);
            const valve = this.valves.get(`JETTISON ${tankName.split('_')[0]}`);
            
            if (tank && valve && valve.position > 0.5) {
                const jettisoned = Math.min(deltaFuel / 2, tank.quantity - tank.unusableQuantity);
                tank.quantity -= jettisoned;
            }
        });
    }

    private updateCenterOfGravity(): void {
        let totalMass = 0;
        let totalMoment = new Vector3(0, 0, 0);
        
        // Add fuel contribution
        this.tanks.forEach(tank => {
            const fuelMass = tank.quantity * tank.density;
            totalMass += fuelMass;
            
            const moment = tank.position.clone().multiplyScalar(fuelMass);
            totalMoment.add(moment);
        });
        
        // Add empty weight (simplified)
        const emptyWeight = 100000; // lbs
        totalMass += emptyWeight;
        totalMoment.add(this.cg.empty.clone().multiplyScalar(emptyWeight));
        
        // Calculate current CG
        if (totalMass > 0) {
            this.cg.current = totalMoment.clone().divideScalar(totalMass);
        }
        
        // Calculate fuel CG contribution
        let fuelMass = 0;
        let fuelMoment = new Vector3(0, 0, 0);
        
        this.tanks.forEach(tank => {
            const mass = tank.quantity * tank.density;
            fuelMass += mass;
            fuelMoment.add(tank.position.clone().multiplyScalar(mass));
        });
        
        if (fuelMass > 0) {
            this.cg.fuel = fuelMoment.clone().divideScalar(fuelMass);
        }
        
        // Convert to % MAC (simplified - assumes MAC is 12 feet starting at station 500)
        const macStart = 500; // inches
        const macLength = 144; // inches (12 feet)
        this.cg.percentMAC = ((this.cg.current.x - macStart) / macLength) * 100;
        
        // Check limits
        this.cg.withinLimits = this.cg.percentMAC >= this.cg.forwardLimit && 
                              this.cg.percentMAC <= this.cg.aftLimit;
    }

    private checkAlerts(): void {
        this.alerts = [];
        
        // Tank quantity alerts
        this.tanks.forEach(tank => {
            if (tank.lowLevel) {
                this.alerts.push({
                    id: `FUEL_${tank.name}_LOW`,
                    level: AlertLevel.CAUTION,
                    message: `${tank.name} FUEL LOW`,
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
            
            if (tank.quantity < tank.unusableQuantity * 2) {
                this.alerts.push({
                    id: `FUEL_${tank.name}_EMPTY`,
                    level: AlertLevel.WARNING,
                    message: `${tank.name} FUEL EMPTY`,
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
            
            if (tank.icing) {
                this.alerts.push({
                    id: `FUEL_${tank.name}_ICE`,
                    level: AlertLevel.WARNING,
                    message: `${tank.name} FUEL ICE`,
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
        });
        
        // Pump alerts
        this.pumps.forEach(pump => {
            if (pump.faults.length > 0) {
                this.alerts.push({
                    id: `FUEL_${pump.name}_FAIL`,
                    level: AlertLevel.WARNING,
                    message: `${pump.name} FAIL`,
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: true
                });
            }
            
            if (pump.cavitation) {
                this.alerts.push({
                    id: `FUEL_${pump.name}_CAVITATION`,
                    level: AlertLevel.CAUTION,
                    message: `${pump.name} CAVITATION`,
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
        });
        
        // Fuel imbalance alert
        const leftMain = this.tanks.get('LEFT_MAIN');
        const rightMain = this.tanks.get('RIGHT_MAIN');
        if (leftMain && rightMain) {
            const imbalance = Math.abs(leftMain.quantity - rightMain.quantity);
            if (imbalance > 1500) { // 1500 lbs imbalance
                this.alerts.push({
                    id: 'FUEL_IMBALANCE',
                    level: AlertLevel.CAUTION,
                    message: 'FUEL IMBALANCE',
                    system: 'FUEL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
        }
        
        // CG out of limits
        if (!this.cg.withinLimits) {
            this.alerts.push({
                id: 'FUEL_CG_LIMIT',
                level: AlertLevel.WARNING,
                message: 'FUEL CG OUT OF LIMITS',
                system: 'FUEL',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: true
            });
        }
    }

    /**
     * Control methods
     */
    public setPump(pumpName: string, enabled: boolean): void {
        const pump = this.pumps.get(pumpName);
        if (pump) {
            pump.enabled = enabled;
        }
    }

    public setValve(valveName: string, position: number): void {
        const valve = this.valves.get(valveName);
        if (valve && !valve.failed) {
            valve.targetPosition = Math.max(0, Math.min(1, position));
        }
    }

    public setCrossfeed(enabled: boolean): void {
        this.fms.crossfeed = enabled;
        const crossfeedValve = this.valves.get('CROSSFEED');
        if (crossfeedValve) {
            crossfeedValve.targetPosition = enabled ? 1 : 0;
        }
    }

    public setFuelManagementMode(mode: 'MANUAL' | 'AUTO'): void {
        this.fms.mode = mode;
    }

    public startJettison(rate: number): void {
        this.fms.jettison = true;
        this.fms.jettisonRate = rate;
        
        // Open jettison valves
        this.valves.forEach(valve => {
            if (valve.type === 'JETTISON') {
                valve.targetPosition = 1;
            }
        });
    }

    public stopJettison(): void {
        this.fms.jettison = false;
        this.fms.jettisonRate = 0;
        
        // Close jettison valves
        this.valves.forEach(valve => {
            if (valve.type === 'JETTISON') {
                valve.targetPosition = 0;
            }
        });
    }

    /**
     * Get display data for instruments
     */
    public getDisplayData(): FuelSystemData {
        const tanksData: FuelTankData[] = Array.from(this.tanks.values()).map(tank => ({
            name: tank.name,
            quantity: tank.quantity,
            capacity: tank.capacity,
            temperature: tank.temperature,
            density: tank.density,
            pumps: tank.pumps.map(pumpName => {
                const pump = this.pumps.get(pumpName);
                return pump ? pump.status === SystemStatus.ON : false;
            }),
            valves: tank.valves.map(valveName => {
                const valve = this.valves.get(valveName);
                return valve ? valve.position > 0.5 : false;
            })
        }));

        const pumpsData: FuelPumpData[] = Array.from(this.pumps.values()).map(pump => ({
            name: pump.name,
            status: pump.status,
            pressure: pump.pressure,
            flow: pump.flow
        }));

        const totalFuel = Array.from(this.tanks.values())
            .reduce((sum, tank) => sum + tank.quantity, 0);
        
        const totalUsable = Array.from(this.tanks.values())
            .reduce((sum, tank) => sum + (tank.quantity - tank.unusableQuantity), 0);

        const totalFlow = this.engines.reduce((sum: number, engine: any) => 
            sum + (engine.fuelFlow || 0), 0);

        const engineFlows = this.engines.map((engine: any) => engine.fuelFlow || 0);

        return {
            tanks: tanksData,
            totalFuel,
            totalUsable,
            centerOfGravity: this.cg.percentMAC,
            fuelFlow: {
                total: totalFlow,
                engines: engineFlows
            },
            crossfeed: {
                valve: this.fms.crossfeed,
                auto: this.fms.mode === 'AUTO'
            },
            pumps: pumpsData
        };
    }

    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public getCenterOfGravity(): CenterOfGravity {
        return { ...this.cg };
    }

    /**
     * System status and planning
     */
    public getFuelPlanning(): any {
        const totalFuel = Array.from(this.tanks.values())
            .reduce((sum, tank) => sum + tank.quantity, 0);
            
        const totalFlow = this.engines.reduce((sum: number, engine: any) => 
            sum + (engine.fuelFlow || 0), 0);

        const endurance = totalFlow > 0 ? (totalFuel / totalFlow) * 60 : Infinity; // minutes
        const range = totalFlow > 0 ? endurance * 8 : 0; // nautical miles (assuming 480 kts)

        return {
            totalFuel,
            usableFuel: Array.from(this.tanks.values())
                .reduce((sum, tank) => sum + Math.max(0, tank.quantity - tank.unusableQuantity), 0),
            fuelFlow: totalFlow,
            endurance,
            range,
            planning: this.fms.fuelPlanning
        };
    }

    public isSystemHealthy(): boolean {
        return this.alerts.filter(alert => 
            alert.level === AlertLevel.WARNING || alert.level === AlertLevel.EMERGENCY
        ).length === 0;
    }
}