import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    EnvironmentalDisplayData,
    PackData,
    MixValveData,
    BleedAirData,
    EnvironmentalConfig,
    AlertData 
} from './InstrumentData';

/**
 * Comprehensive environmental system simulation
 * Models pressurization, air conditioning, anti-ice, and oxygen systems
 */

export interface PressuralizationSystem {
    controller: {
        mode: 'AUTO' | 'MANUAL' | 'DUMP';
        channel: 'A' | 'B' | 'MANUAL';
        active: boolean;
    };
    cabin: {
        altitude: number;        // feet
        altitudeRate: number;    // feet per minute
        pressure: number;        // PSI
        targetAltitude: number;  // feet
        maxAltitude: number;     // feet (10,000 typically)
    };
    differential: {
        current: number;         // PSI
        target: number;          // PSI
        maximum: number;         // PSI
        relief: number;          // PSI relief valve setting
    };
    outflowValve: {
        position: number;        // 0-1 (0=closed, 1=full open)
        target: number;          // commanded position
        rate: number;            // position change rate
        manual: boolean;         // manual control mode
        stuck: boolean;          // valve stuck
    };
    safetyValve: {
        open: boolean;           // safety valve open
        pressure: number;        // relief pressure
        differential: number;    // differential relief pressure
    };
    negativeReliefValve: {
        open: boolean;           // negative pressure relief
        pressure: number;        // relief pressure
    };
    ditchingValve: {
        closed: boolean;         // ditching valve closed
        automatic: boolean;      // automatic closure
    };
}

export interface AirConditioningPack {
    name: string;                // 'PACK 1', 'PACK 2', etc.
    status: SystemStatus;
    valve: {
        position: number;        // 0-1 pack valve position
        commanded: boolean;      // pack switch ON
        bleedAvailable: boolean; // bleed air available
    };
    compressor: {
        inlet: {
            temperature: number; // degrees C
            pressure: number;    // PSI
        };
        outlet: {
            temperature: number; // degrees C
            pressure: number;    // PSI
        };
        stages: number;          // compressor stages
        efficiency: number;      // 0-1
    };
    heatExchanger: {
        primary: {
            inlet: number;       // degrees C
            outlet: number;      // degrees C
        };
        secondary: {
            inlet: number;       // degrees C
            outlet: number;      // degrees C
        };
        effectiveness: number;   // 0-1
    };
    turbine: {
        inlet: {
            temperature: number; // degrees C
            pressure: number;    // PSI
        };
        outlet: {
            temperature: number; // degrees C
            pressure: number;    // PSI
        };
        speed: number;           // RPM
        efficiency: number;      // 0-1
    };
    discharge: {
        temperature: number;     // degrees C
        flow: number;            // CFM
        dewPoint: number;        // degrees C
    };
    waterSeparator: {
        efficiency: number;      // water removal efficiency
        clogged: boolean;        // water separator clogged
    };
}

export interface MixManifold {
    zones: Map<string, TemperatureZone>;
    mixValves: Map<string, MixValve>;
    trimAir: {
        available: boolean;
        temperature: number;     // degrees C
        pressure: number;        // PSI
    };
}

export interface TemperatureZone {
    name: string;                // 'COCKPIT', 'CABIN_FWD', 'CABIN_AFT', 'CARGO'
    temperature: {
        current: number;         // degrees C
        target: number;          // degrees C
        selected: number;        // degrees C (passenger selected)
    };
    sensor: {
        reading: number;         // degrees C
        accuracy: number;        // sensor accuracy
        failed: boolean;         // sensor failure
    };
    ducting: {
        supply: number;          // CFM supply air
        return: number;          // CFM return air
        recirculation: number;   // CFM recirculated air
    };
    passengers: number;          // number of passengers (heat load)
    equipment: number;           // equipment heat load (watts)
}

export interface MixValve {
    name: string;
    zone: string;                // associated zone
    position: number;            // 0-1 (0=full cold, 1=full hot)
    target: number;              // commanded position
    hotAir: {
        temperature: number;     // degrees C
        flow: number;            // CFM
    };
    coldAir: {
        temperature: number;     // degrees C
        flow: number;            // CFM
    };
    mixed: {
        temperature: number;     // degrees C
        flow: number;            // CFM
    };
    response: number;            // valve response time
    failed: boolean;             // valve failure
}

export interface BleedAirSystem {
    engines: Map<string, EngineBleedAir>;
    apu: ApuBleedAir;
    ground: GroundBleedAir;
    crossbleed: {
        valve: {
            position: number;    // 0-1
            automatic: boolean;  // auto crossbleed
            isolated: boolean;   // crossbleed isolated
        };
        manifold: {
            pressure: number;    // PSI
            temperature: number; // degrees C
        };
    };
    leak: {
        detection: boolean;      // leak detection system
        zones: Map<string, LeakZone>;
    };
}

export interface EngineBleedAir {
    engineNumber: number;
    highStage: {
        valve: {
            position: number;    // 0-1
            commanded: boolean;  // valve switch ON
            automatic: boolean;  // automatic valve
        };
        pressure: number;        // PSI
        temperature: number;     // degrees C
        flow: number;            // lbs/min
    };
    lowStage: {
        valve: {
            position: number;    // 0-1
            automatic: boolean;  // automatic selection
        };
        pressure: number;        // PSI
        temperature: number;     // degrees C
    };
    precooler: {
        inlet: number;           // degrees C
        outlet: number;          // degrees C
        effectiveness: number;   // cooling effectiveness
    };
    regulator: {
        pressure: number;        // regulated pressure PSI
        target: number;          // target pressure PSI
        position: number;        // regulator position
    };
    checkValve: {
        open: boolean;           // check valve open
        pressure: number;        // cracking pressure
    };
}

export interface ApuBleedAir {
    available: boolean;          // APU running and bleed available
    valve: {
        position: number;        // 0-1
        commanded: boolean;      // APU bleed switch ON
    };
    pressure: number;            // PSI
    temperature: number;         // degrees C
    flow: number;                // lbs/min
    load: number;                // bleed load on APU (%)
}

export interface GroundBleedAir {
    connected: boolean;          // ground air cart connected
    valve: {
        position: number;        // 0-1
        commanded: boolean;      // ground air switch ON
    };
    pressure: number;            // PSI
    temperature: number;         // degrees C
    flow: number;                // lbs/min
    quality: number;             // air quality (0-1)
}

export interface LeakZone {
    name: string;
    sensors: LeakSensor[];
    leakDetected: boolean;
    isolated: boolean;           // zone isolated due to leak
}

export interface LeakSensor {
    name: string;
    type: 'THERMAL' | 'PRESSURE' | 'FLOW';
    reading: number;
    threshold: number;
    triggered: boolean;
    failed: boolean;
}

export interface AntiIceSystem {
    wings: {
        left: WingAntiIce;
        right: WingAntiIce;
    };
    engines: Map<string, EngineAntiIce>;
    pitotStatic: Map<string, PitotStaticHeat>;
    windshield: {
        left: WindshieldHeat;
        right: WindshieldHeat;
    };
    probes: {
        tav: ProbeHeat;          // Total air temperature
        aoa: ProbeHeat;          // Angle of attack
        ice: ProbeHeat;          // Ice detector
    };
    waste: {
        enabled: boolean;
        heated: boolean;
        temperature: number;     // degrees C
    };
    detection: IceDetection;
}

export interface WingAntiIce {
    enabled: boolean;
    valve: {
        position: number;        // 0-1
        target: number;
    };
    ducting: {
        temperature: number;     // degrees C
        pressure: number;        // PSI
        flow: number;            // lbs/min
    };
    heating: {
        leadingEdge: boolean;
        slats: boolean;
        effectiveness: number;   // 0-1
    };
}

export interface EngineAntiIce {
    engineNumber: number;
    enabled: boolean;
    inlet: {
        heated: boolean;
        temperature: number;     // degrees C
        effectiveness: number;   // heating effectiveness
    };
    spinner: {
        heated: boolean;
        temperature: number;     // degrees C
    };
    struts: {
        heated: boolean;
        temperature: number;     // degrees C
    };
    bleedDemand: number;         // bleed air demand (lbs/min)
}

export interface PitotStaticHeat {
    name: string;                // 'CAPT', 'F/O', 'STBY'
    pitot: {
        enabled: boolean;
        power: number;           // watts
        temperature: number;     // degrees C
        heaterFailed: boolean;
    };
    static: {
        enabled: boolean;
        power: number;           // watts
        temperature: number;     // degrees C
        heaterFailed: boolean;
    };
    tav: {
        enabled: boolean;
        power: number;           // watts
        temperature: number;     // degrees C
        heaterFailed: boolean;
    };
}

export interface WindshieldHeat {
    enabled: boolean;
    power: number;               // watts
    temperature: number;         // degrees C
    elements: HeatingElement[];
}

export interface HeatingElement {
    zone: string;
    resistance: number;          // ohms
    current: number;             // amps
    temperature: number;         // degrees C
    failed: boolean;
}

export interface ProbeHeat {
    enabled: boolean;
    power: number;               // watts
    temperature: number;         // degrees C
    heaterFailed: boolean;
}

export interface IceDetection {
    sensors: IceSensor[];
    icing: {
        detected: boolean;
        severity: 'TRACE' | 'LIGHT' | 'MODERATE' | 'SEVERE';
        location: string[];      // locations where ice detected
    };
    advisory: {
        enabled: boolean;
        message: string;
    };
}

export interface IceSensor {
    name: string;
    location: string;
    type: 'MAGNETOSTRICTIVE' | 'VIBRATING' | 'OPTICAL';
    icing: boolean;
    severity: number;            // 0-4 scale
    failed: boolean;
}

export interface OxygenSystem {
    passenger: {
        pressure: number;        // PSI
        quantity: number;        // percentage
        flow: number;            // SCFM
        generators: {
            activated: boolean;
            burning: boolean;
            temperature: number;  // degrees C
            duration: number;     // minutes remaining
        };
        masks: {
            deployed: boolean;
            compartments: MaskCompartment[];
        };
    };
    crew: {
        pressure: number;        // PSI
        quantity: number;        // percentage
        flow: {
            mode: 'NORM' | 'HIGH' | '100%';
            rate: number;         // SCFM
        };
        masks: {
            connected: boolean;
            microphone: boolean;
            diluter: 'NORM' | '100%';
        };
        portable: {
            available: number;    // number of portable bottles
            pressure: number[];   // PSI per bottle
        };
    };
    distribution: {
        shutoffValve: boolean;   // main shutoff valve
        regulator: {
            inlet: number;       // PSI
            outlet: number;      // PSI
            setting: number;     // target pressure
        };
    };
}

export interface MaskCompartment {
    location: string;
    masks: number;               // number of masks
    deployed: boolean;
    flow: number;                // SCFM per mask
}

export class EnvironmentalSystem {
    private config: EnvironmentalConfig;
    private pressurization: PressuralizationSystem;
    private airConditioning: {
        packs: Map<string, AirConditioningPack>;
        mixManifold: MixManifold;
    };
    private bleedAir: BleedAirSystem;
    private antiIce: AntiIceSystem;
    private oxygen: OxygenSystem;
    
    private alerts: AlertData[] = [];
    private aircraftState: any = {};
    private electricalPower: boolean = false;
    private engineData: any[] = [];
    private apuRunning: boolean = false;

    constructor(config: EnvironmentalConfig) {
        this.config = config;
        this.initializeSystem();
    }

    /**
     * Initialize environmental system components
     */
    private initializeSystem(): void {
        this.initializePressurization();
        this.initializeAirConditioning();
        this.initializeBleedAir();
        this.initializeAntiIce();
        this.initializeOxygen();
    }

    private initializePressurization(): void {
        this.pressurization = {
            controller: {
                mode: 'AUTO',
                channel: 'A',
                active: true
            },
            cabin: {
                altitude: 0,
                altitudeRate: 0,
                pressure: 14.7,
                targetAltitude: 8000,
                maxAltitude: this.config.pressurization.maxCabinAltitude
            },
            differential: {
                current: 0,
                target: 8.0,
                maximum: this.config.pressurization.maxDiffPressure,
                relief: this.config.pressurization.maxDiffPressure + 0.5
            },
            outflowValve: {
                position: 0.5,
                target: 0.5,
                rate: 0.1,
                manual: false,
                stuck: false
            },
            safetyValve: {
                open: false,
                pressure: this.config.pressurization.maxDiffPressure + 0.5,
                differential: this.config.pressurization.maxDiffPressure + 0.3
            },
            negativeReliefValve: {
                open: false,
                pressure: -0.5
            },
            ditchingValve: {
                closed: false,
                automatic: true
            }
        };
    }

    private initializeAirConditioning(): void {
        this.airConditioning = {
            packs: new Map(),
            mixManifold: {
                zones: new Map(),
                mixValves: new Map(),
                trimAir: {
                    available: true,
                    temperature: 200,
                    pressure: 45
                }
            }
        };

        // Initialize air conditioning packs
        for (let i = 1; i <= this.config.airConditioning.packs; i++) {
            const pack: AirConditioningPack = {
                name: `PACK ${i}`,
                status: SystemStatus.OFF,
                valve: {
                    position: 0,
                    commanded: false,
                    bleedAvailable: false
                },
                compressor: {
                    inlet: {
                        temperature: 200,
                        pressure: 45
                    },
                    outlet: {
                        temperature: 400,
                        pressure: 180
                    },
                    stages: 3,
                    efficiency: 0.85
                },
                heatExchanger: {
                    primary: {
                        inlet: 400,
                        outlet: 150
                    },
                    secondary: {
                        inlet: -40,
                        outlet: 100
                    },
                    effectiveness: 0.8
                },
                turbine: {
                    inlet: {
                        temperature: 150,
                        pressure: 180
                    },
                    outlet: {
                        temperature: 10,
                        pressure: 15
                    },
                    speed: 50000,
                    efficiency: 0.9
                },
                discharge: {
                    temperature: 10,
                    flow: this.config.airConditioning.maxFlow / this.config.airConditioning.packs,
                    dewPoint: -10
                },
                waterSeparator: {
                    efficiency: 0.95,
                    clogged: false
                }
            };
            this.airConditioning.packs.set(pack.name, pack);
        }

        // Initialize temperature zones
        const zones = ['COCKPIT', 'CABIN_FWD', 'CABIN_AFT', 'CARGO'];
        zones.forEach((zoneName, index) => {
            const zone: TemperatureZone = {
                name: zoneName,
                temperature: {
                    current: 22,
                    target: 22,
                    selected: 22
                },
                sensor: {
                    reading: 22,
                    accuracy: 0.5,
                    failed: false
                },
                ducting: {
                    supply: this.config.airConditioning.maxFlow / zones.length,
                    return: this.config.airConditioning.maxFlow / zones.length * 0.8,
                    recirculation: this.config.airConditioning.maxFlow / zones.length * 0.5
                },
                passengers: zoneName.includes('CABIN') ? 50 : 2,
                equipment: zoneName === 'COCKPIT' ? 2000 : 500
            };
            this.airConditioning.mixManifold.zones.set(zoneName, zone);

            // Initialize mix valve for each zone
            const mixValve: MixValve = {
                name: `${zoneName} MIX VALVE`,
                zone: zoneName,
                position: 0.5,
                target: 0.5,
                hotAir: {
                    temperature: 200,
                    flow: 0
                },
                coldAir: {
                    temperature: 10,
                    flow: 0
                },
                mixed: {
                    temperature: 22,
                    flow: zone.ducting.supply
                },
                response: 2.0,
                failed: false
            };
            this.airConditioning.mixManifold.mixValves.set(zoneName, mixValve);
        });
    }

    private initializeBleedAir(): void {
        this.bleedAir = {
            engines: new Map(),
            apu: {
                available: false,
                valve: {
                    position: 0,
                    commanded: false
                },
                pressure: 0,
                temperature: 0,
                flow: 0,
                load: 0
            },
            ground: {
                connected: false,
                valve: {
                    position: 0,
                    commanded: false
                },
                pressure: 0,
                temperature: 0,
                flow: 0,
                quality: 0
            },
            crossbleed: {
                valve: {
                    position: 0,
                    automatic: true,
                    isolated: false
                },
                manifold: {
                    pressure: 0,
                    temperature: 0
                }
            },
            leak: {
                detection: true,
                zones: new Map()
            }
        };

        // Initialize engine bleed air (typically 2-4 engines)
        for (let i = 1; i <= 4; i++) {
            const engineBleed: EngineBleedAir = {
                engineNumber: i,
                highStage: {
                    valve: {
                        position: 0,
                        commanded: true,
                        automatic: true
                    },
                    pressure: 0,
                    temperature: 0,
                    flow: 0
                },
                lowStage: {
                    valve: {
                        position: 0,
                        automatic: true
                    },
                    pressure: 0,
                    temperature: 0
                },
                precooler: {
                    inlet: 0,
                    outlet: 0,
                    effectiveness: 0.6
                },
                regulator: {
                    pressure: 45,
                    target: 45,
                    position: 0.5
                },
                checkValve: {
                    open: false,
                    pressure: 5
                }
            };
            this.bleedAir.engines.set(`ENGINE_${i}`, engineBleed);
        }
    }

    private initializeAntiIce(): void {
        this.antiIce = {
            wings: {
                left: {
                    enabled: false,
                    valve: { position: 0, target: 0 },
                    ducting: { temperature: 0, pressure: 0, flow: 0 },
                    heating: { leadingEdge: false, slats: false, effectiveness: 0 }
                },
                right: {
                    enabled: false,
                    valve: { position: 0, target: 0 },
                    ducting: { temperature: 0, pressure: 0, flow: 0 },
                    heating: { leadingEdge: false, slats: false, effectiveness: 0 }
                }
            },
            engines: new Map(),
            pitotStatic: new Map(),
            windshield: {
                left: {
                    enabled: false,
                    power: 0,
                    temperature: 0,
                    elements: [
                        { zone: 'UPPER', resistance: 10, current: 0, temperature: 0, failed: false },
                        { zone: 'LOWER', resistance: 10, current: 0, temperature: 0, failed: false }
                    ]
                },
                right: {
                    enabled: false,
                    power: 0,
                    temperature: 0,
                    elements: [
                        { zone: 'UPPER', resistance: 10, current: 0, temperature: 0, failed: false },
                        { zone: 'LOWER', resistance: 10, current: 0, temperature: 0, failed: false }
                    ]
                }
            },
            probes: {
                tav: { enabled: false, power: 0, temperature: 0, heaterFailed: false },
                aoa: { enabled: false, power: 0, temperature: 0, heaterFailed: false },
                ice: { enabled: false, power: 0, temperature: 0, heaterFailed: false }
            },
            waste: {
                enabled: false,
                heated: false,
                temperature: 0
            },
            detection: {
                sensors: [
                    {
                        name: 'ICE_DETECTOR_1',
                        location: 'FUSELAGE',
                        type: 'MAGNETOSTRICTIVE',
                        icing: false,
                        severity: 0,
                        failed: false
                    }
                ],
                icing: {
                    detected: false,
                    severity: 'TRACE',
                    location: []
                },
                advisory: {
                    enabled: true,
                    message: ''
                }
            }
        };

        // Initialize engine anti-ice
        for (let i = 1; i <= 4; i++) {
            const engineAntiIce: EngineAntiIce = {
                engineNumber: i,
                enabled: false,
                inlet: { heated: false, temperature: 0, effectiveness: 0.8 },
                spinner: { heated: false, temperature: 0 },
                struts: { heated: false, temperature: 0 },
                bleedDemand: 0
            };
            this.antiIce.engines.set(`ENGINE_${i}`, engineAntiIce);
        }

        // Initialize pitot-static heating
        const pitotSystems = ['CAPT', 'F/O', 'STBY'];
        pitotSystems.forEach(system => {
            const pitotHeat: PitotStaticHeat = {
                name: system,
                pitot: { enabled: false, power: 0, temperature: 0, heaterFailed: false },
                static: { enabled: false, power: 0, temperature: 0, heaterFailed: false },
                tav: { enabled: false, power: 0, temperature: 0, heaterFailed: false }
            };
            this.antiIce.pitotStatic.set(system, pitotHeat);
        });
    }

    private initializeOxygen(): void {
        this.oxygen = {
            passenger: {
                pressure: 1800,
                quantity: 100,
                flow: 0,
                generators: {
                    activated: false,
                    burning: false,
                    temperature: 20,
                    duration: 0
                },
                masks: {
                    deployed: false,
                    compartments: [
                        { location: 'COCKPIT', masks: 4, deployed: false, flow: 0 },
                        { location: 'CABIN_FWD', masks: 50, deployed: false, flow: 0 },
                        { location: 'CABIN_AFT', masks: 50, deployed: false, flow: 0 }
                    ]
                }
            },
            crew: {
                pressure: 1800,
                quantity: 100,
                flow: {
                    mode: 'NORM',
                    rate: 0
                },
                masks: {
                    connected: false,
                    microphone: false,
                    diluter: 'NORM'
                },
                portable: {
                    available: 4,
                    pressure: [1800, 1800, 1800, 1800]
                }
            },
            distribution: {
                shutoffValve: true,
                regulator: {
                    inlet: 1800,
                    outlet: 75,
                    setting: 75
                }
            }
        };
    }

    /**
     * Update environmental system
     */
    public update(deltaTime: number, aircraftState: any, electricalStatus: any): void {
        this.updateInputs(aircraftState, electricalStatus);
        this.updatePressurization(deltaTime);
        this.updateAirConditioning(deltaTime);
        this.updateBleedAir(deltaTime);
        this.updateAntiIce(deltaTime);
        this.updateOxygen(deltaTime);
        this.checkAlerts();
    }

    private updateInputs(aircraftState: any, electricalStatus: any): void {
        this.aircraftState = aircraftState;
        this.electricalPower = electricalStatus.buses?.some((bus: any) => 
            bus.name.includes('ESS') && bus.powered) || false;
        this.engineData = aircraftState.engines || [];
        this.apuRunning = aircraftState.apu?.running || false;
    }

    private updatePressurization(deltaTime: number): void {
        const altitude = this.aircraftState.altitude || 0;
        const verticalSpeed = this.aircraftState.verticalSpeed || 0;
        
        // Calculate ambient pressure at current altitude
        const ambientPressure = 14.696 * Math.pow((1 - altitude * 0.0000068756), 5.2561);
        
        // Calculate target cabin altitude based on flight profile
        let targetCabinAltitude: number;
        if (altitude < 8000) {
            targetCabinAltitude = altitude;
        } else if (altitude < 20000) {
            targetCabinAltitude = 8000 + (altitude - 8000) * 0.25;
        } else {
            targetCabinAltitude = Math.min(8000, altitude * 0.4);
        }
        
        this.pressurization.cabin.targetAltitude = targetCabinAltitude;
        
        // Calculate cabin pressure based on cabin altitude
        const cabinPressure = 14.696 * Math.pow((1 - this.pressurization.cabin.altitude * 0.0000068756), 5.2561);
        this.pressurization.cabin.pressure = cabinPressure;
        
        // Calculate differential pressure
        this.pressurization.differential.current = cabinPressure - ambientPressure;
        
        // Pressurization controller logic
        if (this.pressurization.controller.active && this.pressurization.controller.mode === 'AUTO') {
            const altitudeError = this.pressurization.cabin.targetAltitude - this.pressurization.cabin.altitude;
            const maxRate = this.config.pressurization.normalVS;
            
            // Calculate required cabin rate
            let requiredRate = Math.sign(altitudeError) * Math.min(Math.abs(altitudeError) * 0.1, maxRate);
            
            // Limit rate based on differential pressure
            if (this.pressurization.differential.current > this.pressurization.differential.maximum * 0.9) {
                requiredRate = Math.min(requiredRate, -200); // Force descent
            }
            
            this.pressurization.cabin.altitudeRate = requiredRate;
            
            // Update outflow valve position
            const valveGain = 0.001;
            const valveChange = -requiredRate * valveGain * deltaTime / 1000;
            this.pressurization.outflowValve.target = Math.max(0, Math.min(1, 
                this.pressurization.outflowValve.target + valveChange));
        }
        
        // Outflow valve actuator
        if (!this.pressurization.outflowValve.stuck) {
            const positionError = this.pressurization.outflowValve.target - this.pressurization.outflowValve.position;
            const deltaPosition = Math.sign(positionError) * 
                Math.min(Math.abs(positionError), this.pressurization.outflowValve.rate * deltaTime / 1000);
            this.pressurization.outflowValve.position += deltaPosition;
        }
        
        // Update cabin altitude
        const outflowArea = this.pressurization.outflowValve.position * 2; // square feet
        const massFlow = outflowArea * Math.sqrt(2 * cabinPressure * 144); // mass flow out
        const cabinVolume = 10000; // cubic feet
        const altitudeChange = (massFlow / cabinVolume) * deltaTime / 1000 * 100; // simplified
        
        this.pressurization.cabin.altitude += altitudeChange;
        this.pressurization.cabin.altitude = Math.max(altitude, this.pressurization.cabin.altitude);
        
        // Safety valve operation
        if (this.pressurization.differential.current > this.pressurization.safetyValve.pressure) {
            this.pressurization.safetyValve.open = true;
        } else if (this.pressurization.differential.current < this.pressurization.safetyValve.pressure - 0.2) {
            this.pressurization.safetyValve.open = false;
        }
        
        // Negative relief valve operation
        if (this.pressurization.differential.current < this.pressurization.negativeReliefValve.pressure) {
            this.pressurization.negativeReliefValve.open = true;
        } else if (this.pressurization.differential.current > this.pressurization.negativeReliefValve.pressure + 0.1) {
            this.pressurization.negativeReliefValve.open = false;
        }
    }

    private updateAirConditioning(deltaTime: number): void {
        // Update each air conditioning pack
        this.airConditioning.packs.forEach(pack => {
            this.updateAirConditioningPack(pack, deltaTime);
        });
        
        // Update temperature zones
        this.airConditioning.mixManifold.zones.forEach(zone => {
            this.updateTemperatureZone(zone, deltaTime);
        });
        
        // Update mix valves
        this.airConditioning.mixManifold.mixValves.forEach(mixValve => {
            this.updateMixValve(mixValve, deltaTime);
        });
    }

    private updateAirConditioningPack(pack: AirConditioningPack, deltaTime: number): void {
        // Check bleed air availability
        pack.valve.bleedAvailable = this.getBleedAirPressure() > 30;
        
        // Pack operation
        if (pack.valve.commanded && pack.valve.bleedAvailable && this.electricalPower) {
            pack.status = SystemStatus.ON;
            pack.valve.position = Math.min(1, pack.valve.position + deltaTime / 3000);
        } else {
            pack.status = SystemStatus.OFF;
            pack.valve.position = Math.max(0, pack.valve.position - deltaTime / 3000);
        }
        
        if (pack.status === SystemStatus.ON && pack.valve.position > 0.5) {
            // Air cycle machine operation
            const bleedTemp = this.getBleedAirTemperature();
            const bleedPressure = this.getBleedAirPressure();
            
            // Compressor
            pack.compressor.inlet.temperature = bleedTemp;
            pack.compressor.inlet.pressure = bleedPressure;
            pack.compressor.outlet.temperature = pack.compressor.inlet.temperature + 200;
            pack.compressor.outlet.pressure = pack.compressor.inlet.pressure * 4;
            
            // Primary heat exchanger
            const ambientTemp = this.aircraftState.temperature || -40;
            pack.heatExchanger.primary.inlet = pack.compressor.outlet.temperature;
            pack.heatExchanger.primary.outlet = pack.heatExchanger.primary.inlet - 
                (pack.heatExchanger.primary.inlet - ambientTemp) * pack.heatExchanger.effectiveness;
            
            // Turbine
            pack.turbine.inlet.temperature = pack.heatExchanger.primary.outlet;
            pack.turbine.inlet.pressure = pack.compressor.outlet.pressure;
            pack.turbine.outlet.temperature = pack.turbine.inlet.temperature - 140;
            pack.turbine.outlet.pressure = 15;
            
            // Final discharge conditions
            pack.discharge.temperature = pack.turbine.outlet.temperature;
            pack.discharge.flow = this.config.airConditioning.maxFlow / this.config.airConditioning.packs;
            
            // Water separation
            const dewPoint = this.calculateDewPoint(pack.discharge.temperature, pack.turbine.outlet.pressure);
            pack.discharge.dewPoint = dewPoint;
            
            if (!pack.waterSeparator.clogged) {
                pack.discharge.temperature = Math.max(pack.discharge.temperature, dewPoint + 2);
            }
        } else {
            pack.discharge.flow = 0;
            pack.discharge.temperature = ambientTemp;
        }
    }

    private updateTemperatureZone(zone: TemperatureZone, deltaTime: number): void {
        // Heat load calculation
        const passengerHeat = zone.passengers * 100; // watts per person
        const equipmentHeat = zone.equipment;
        const totalHeatLoad = passengerHeat + equipmentHeat;
        
        // Supply air temperature from mix valve
        const mixValve = this.airConditioning.mixManifold.mixValves.get(zone.name);
        const supplyTemp = mixValve ? mixValve.mixed.temperature : 22;
        const supplyFlow = zone.ducting.supply; // CFM
        
        // Zone temperature calculation (simplified)
        const airMass = zone.ducting.supply * 0.075; // lbs of air (approx)
        const heatCapacity = 0.24; // BTU/lb-F for air
        
        const coolingFromSupply = supplyFlow * (zone.temperature.current - supplyTemp) * 1.08; // BTU/hr
        const heatFromLoad = totalHeatLoad * 3.412; // Convert watts to BTU/hr
        
        const netHeat = heatFromLoad - coolingFromSupply;
        const tempChange = netHeat / (airMass * heatCapacity * 60) * deltaTime / 1000; // F per update
        
        zone.temperature.current += tempChange * 0.556; // Convert F to C
        zone.temperature.current = Math.max(-10, Math.min(50, zone.temperature.current));
        
        // Update sensor reading
        if (!zone.sensor.failed) {
            const error = (Math.random() - 0.5) * zone.sensor.accuracy * 2;
            zone.sensor.reading = zone.temperature.current + error;
        }
    }

    private updateMixValve(mixValve: MixValve, deltaTime: number): void {
        if (mixValve.failed) return;
        
        const zone = this.airConditioning.mixManifold.zones.get(mixValve.zone);
        if (!zone) return;
        
        // Temperature control logic
        const tempError = zone.temperature.target - zone.temperature.current;
        const proportionalGain = 0.1;
        const targetChange = tempError * proportionalGain;
        
        // Update target position
        mixValve.target = Math.max(0, Math.min(1, mixValve.target + targetChange * deltaTime / 1000));
        
        // Valve actuator
        const positionError = mixValve.target - mixValve.position;
        const maxRate = 1 / mixValve.response; // position per second
        const deltaPosition = Math.sign(positionError) * 
            Math.min(Math.abs(positionError), maxRate * deltaTime / 1000);
        
        mixValve.position += deltaPosition;
        
        // Calculate mixed air properties
        const coldFlow = zone.ducting.supply * (1 - mixValve.position);
        const hotFlow = zone.ducting.supply * mixValve.position;
        
        mixValve.coldAir.flow = coldFlow;
        mixValve.coldAir.temperature = this.getColdAirTemp();
        
        mixValve.hotAir.flow = hotFlow;
        mixValve.hotAir.temperature = this.airConditioning.mixManifold.trimAir.temperature;
        
        // Mixed temperature calculation
        if (zone.ducting.supply > 0) {
            mixValve.mixed.temperature = 
                (mixValve.coldAir.temperature * coldFlow + mixValve.hotAir.temperature * hotFlow) / zone.ducting.supply;
            mixValve.mixed.flow = zone.ducting.supply;
        }
    }

    private updateBleedAir(deltaTime: number): void {
        // Update engine bleed air
        this.bleedAir.engines.forEach((engineBleed, engineKey) => {
            this.updateEngineBleedAir(engineBleed, deltaTime);
        });
        
        // Update APU bleed air
        this.updateApuBleedAir(deltaTime);
        
        // Update ground bleed air
        this.updateGroundBleedAir(deltaTime);
        
        // Update crossbleed system
        this.updateCrossbleed(deltaTime);
    }

    private updateEngineBleedAir(engineBleed: EngineBleedAir, deltaTime: number): void {
        const engineIndex = engineBleed.engineNumber - 1;
        const engine = this.engineData[engineIndex];
        
        if (!engine) return;
        
        const n2 = engine.n2 || 0;
        const engineRunning = n2 > 1000;
        
        if (engineRunning && engineBleed.highStage.valve.commanded) {
            // Calculate bleed air conditions based on engine state
            const compressionRatio = Math.min(4, n2 / 5000);
            const bleedPressure = 14.7 * compressionRatio;
            const bleedTemp = (engine.egt || 500) * 0.6; // degrees C
            
            engineBleed.highStage.pressure = bleedPressure;
            engineBleed.highStage.temperature = bleedTemp;
            engineBleed.highStage.flow = Math.min(30, bleedPressure * 0.5); // lbs/min
            
            // Precooler operation
            if (this.aircraftState.airspeed > 200) {
                const coolingEffectiveness = engineBleed.precooler.effectiveness;
                const ambientTemp = this.aircraftState.temperature || -40;
                
                engineBleed.precooler.inlet = bleedTemp;
                engineBleed.precooler.outlet = bleedTemp - (bleedTemp - ambientTemp) * coolingEffectiveness;
            } else {
                engineBleed.precooler.outlet = engineBleed.precooler.inlet;
            }
            
            // Pressure regulator
            engineBleed.regulator.pressure = Math.min(engineBleed.regulator.target, bleedPressure);
            
            // Check valve
            engineBleed.checkValve.open = engineBleed.regulator.pressure > engineBleed.checkValve.pressure;
            
            // Update valve positions
            if (engineBleed.highStage.valve.automatic) {
                engineBleed.highStage.valve.position = engineBleed.checkValve.open ? 1 : 0;
            }
        } else {
            engineBleed.highStage.pressure = 0;
            engineBleed.highStage.temperature = 0;
            engineBleed.highStage.flow = 0;
            engineBleed.highStage.valve.position = 0;
            engineBleed.checkValve.open = false;
        }
    }

    private updateApuBleedAir(deltaTime: number): void {
        if (this.apuRunning && this.bleedAir.apu.valve.commanded) {
            this.bleedAir.apu.available = true;
            this.bleedAir.apu.valve.position = 1;
            this.bleedAir.apu.pressure = 45;
            this.bleedAir.apu.temperature = 200;
            this.bleedAir.apu.flow = 25; // lbs/min
            this.bleedAir.apu.load = 50; // % load on APU
        } else {
            this.bleedAir.apu.available = false;
            this.bleedAir.apu.valve.position = 0;
            this.bleedAir.apu.pressure = 0;
            this.bleedAir.apu.temperature = 0;
            this.bleedAir.apu.flow = 0;
            this.bleedAir.apu.load = 0;
        }
    }

    private updateGroundBleedAir(deltaTime: number): void {
        if (this.bleedAir.ground.connected && this.bleedAir.ground.valve.commanded) {
            this.bleedAir.ground.valve.position = 1;
            this.bleedAir.ground.pressure = 50;
            this.bleedAir.ground.temperature = 150;
            this.bleedAir.ground.flow = 35; // lbs/min
            this.bleedAir.ground.quality = 0.9;
        } else {
            this.bleedAir.ground.valve.position = 0;
            this.bleedAir.ground.pressure = 0;
            this.bleedAir.ground.temperature = 0;
            this.bleedAir.ground.flow = 0;
        }
    }

    private updateCrossbleed(deltaTime: number): void {
        // Calculate crossbleed manifold conditions
        let totalFlow = 0;
        let weightedTemp = 0;
        let maxPressure = 0;
        
        // Collect from engine bleeds
        this.bleedAir.engines.forEach(engineBleed => {
            if (engineBleed.checkValve.open) {
                totalFlow += engineBleed.highStage.flow;
                weightedTemp += engineBleed.precooler.outlet * engineBleed.highStage.flow;
                maxPressure = Math.max(maxPressure, engineBleed.regulator.pressure);
            }
        });
        
        // Add APU contribution
        if (this.bleedAir.apu.available && this.bleedAir.apu.valve.position > 0) {
            totalFlow += this.bleedAir.apu.flow;
            weightedTemp += this.bleedAir.apu.temperature * this.bleedAir.apu.flow;
            maxPressure = Math.max(maxPressure, this.bleedAir.apu.pressure);
        }
        
        // Add ground air contribution
        if (this.bleedAir.ground.valve.position > 0) {
            totalFlow += this.bleedAir.ground.flow;
            weightedTemp += this.bleedAir.ground.temperature * this.bleedAir.ground.flow;
            maxPressure = Math.max(maxPressure, this.bleedAir.ground.pressure);
        }
        
        // Update manifold conditions
        this.bleedAir.crossbleed.manifold.pressure = maxPressure;
        this.bleedAir.crossbleed.manifold.temperature = totalFlow > 0 ? weightedTemp / totalFlow : 0;
        
        // Crossbleed valve logic
        if (this.bleedAir.crossbleed.valve.automatic && !this.bleedAir.crossbleed.valve.isolated) {
            // Open crossbleed if pressure imbalance exists
            const enginePressures = Array.from(this.bleedAir.engines.values())
                .map(e => e.regulator.pressure);
            const maxPress = Math.max(...enginePressures);
            const minPress = Math.min(...enginePressures);
            
            if (maxPress - minPress > 10) {
                this.bleedAir.crossbleed.valve.position = 1;
            } else {
                this.bleedAir.crossbleed.valve.position = 0;
            }
        }
    }

    private updateAntiIce(deltaTime: number): void {
        this.updateWingAntiIce(deltaTime);
        this.updateEngineAntiIce(deltaTime);
        this.updatePitotStaticHeat(deltaTime);
        this.updateWindshieldHeat(deltaTime);
        this.updateProbeHeat(deltaTime);
        this.updateIceDetection(deltaTime);
    }

    private updateWingAntiIce(deltaTime: number): void {
        // Left wing
        if (this.antiIce.wings.left.enabled) {
            this.antiIce.wings.left.valve.target = 1;
            this.antiIce.wings.left.ducting.pressure = this.getBleedAirPressure() * 0.6;
            this.antiIce.wings.left.ducting.temperature = this.getBleedAirTemperature() * 0.8;
            this.antiIce.wings.left.ducting.flow = 8; // lbs/min
            this.antiIce.wings.left.heating.leadingEdge = true;
            this.antiIce.wings.left.heating.slats = true;
            this.antiIce.wings.left.heating.effectiveness = 0.85;
        } else {
            this.antiIce.wings.left.valve.target = 0;
            this.antiIce.wings.left.ducting.flow = 0;
            this.antiIce.wings.left.heating.leadingEdge = false;
            this.antiIce.wings.left.heating.slats = false;
            this.antiIce.wings.left.heating.effectiveness = 0;
        }
        
        // Right wing (similar logic)
        if (this.antiIce.wings.right.enabled) {
            this.antiIce.wings.right.valve.target = 1;
            this.antiIce.wings.right.ducting.pressure = this.getBleedAirPressure() * 0.6;
            this.antiIce.wings.right.ducting.temperature = this.getBleedAirTemperature() * 0.8;
            this.antiIce.wings.right.ducting.flow = 8; // lbs/min
            this.antiIce.wings.right.heating.leadingEdge = true;
            this.antiIce.wings.right.heating.slats = true;
            this.antiIce.wings.right.heating.effectiveness = 0.85;
        } else {
            this.antiIce.wings.right.valve.target = 0;
            this.antiIce.wings.right.ducting.flow = 0;
            this.antiIce.wings.right.heating.leadingEdge = false;
            this.antiIce.wings.right.heating.slats = false;
            this.antiIce.wings.right.heating.effectiveness = 0;
        }
        
        // Update valve positions
        ['left', 'right'].forEach(wing => {
            const wingAntiIce = this.antiIce.wings[wing as keyof typeof this.antiIce.wings];
            const positionError = wingAntiIce.valve.target - wingAntiIce.valve.position;
            const deltaPosition = Math.sign(positionError) * Math.min(0.1, Math.abs(positionError)) * deltaTime / 1000;
            wingAntiIce.valve.position += deltaPosition;
        });
    }

    private updateEngineAntiIce(deltaTime: number): void {
        this.antiIce.engines.forEach(engineAntiIce => {
            const engineIndex = engineAntiIce.engineNumber - 1;
            const engine = this.engineData[engineIndex];
            
            if (engineAntiIce.enabled && engine && engine.n2 > 1000) {
                engineAntiIce.inlet.heated = true;
                engineAntiIce.spinner.heated = true;
                engineAntiIce.struts.heated = true;
                
                // Calculate heating temperatures
                const bleedTemp = this.getBleedAirTemperature();
                const ambientTemp = this.aircraftState.temperature || -40;
                
                engineAntiIce.inlet.temperature = ambientTemp + 
                    (bleedTemp - ambientTemp) * engineAntiIce.inlet.effectiveness;
                engineAntiIce.spinner.temperature = engineAntiIce.inlet.temperature * 0.8;
                engineAntiIce.struts.temperature = engineAntiIce.inlet.temperature * 0.7;
                
                engineAntiIce.bleedDemand = 12; // lbs/min
            } else {
                engineAntiIce.inlet.heated = false;
                engineAntiIce.spinner.heated = false;
                engineAntiIce.struts.heated = false;
                engineAntiIce.inlet.temperature = this.aircraftState.temperature || -40;
                engineAntiIce.spinner.temperature = this.aircraftState.temperature || -40;
                engineAntiIce.struts.temperature = this.aircraftState.temperature || -40;
                engineAntiIce.bleedDemand = 0;
            }
        });
    }

    private updatePitotStaticHeat(deltaTime: number): void {
        this.antiIce.pitotStatic.forEach(pitotHeat => {
            // Pitot heat
            if (pitotHeat.pitot.enabled && !pitotHeat.pitot.heaterFailed && this.electricalPower) {
                pitotHeat.pitot.power = 100; // watts
                const ambientTemp = this.aircraftState.temperature || -40;
                pitotHeat.pitot.temperature = Math.max(ambientTemp + 50, 5);
            } else {
                pitotHeat.pitot.power = 0;
                pitotHeat.pitot.temperature = this.aircraftState.temperature || -40;
            }
            
            // Static port heat
            if (pitotHeat.static.enabled && !pitotHeat.static.heaterFailed && this.electricalPower) {
                pitotHeat.static.power = 50; // watts
                const ambientTemp = this.aircraftState.temperature || -40;
                pitotHeat.static.temperature = Math.max(ambientTemp + 30, 5);
            } else {
                pitotHeat.static.power = 0;
                pitotHeat.static.temperature = this.aircraftState.temperature || -40;
            }
            
            // TAT probe heat
            if (pitotHeat.tav.enabled && !pitotHeat.tav.heaterFailed && this.electricalPower) {
                pitotHeat.tav.power = 75; // watts
                const ambientTemp = this.aircraftState.temperature || -40;
                pitotHeat.tav.temperature = Math.max(ambientTemp + 40, 5);
            } else {
                pitotHeat.tav.power = 0;
                pitotHeat.tav.temperature = this.aircraftState.temperature || -40;
            }
        });
    }

    private updateWindshieldHeat(deltaTime: number): void {
        ['left', 'right'].forEach(side => {
            const windshield = this.antiIce.windshield[side as keyof typeof this.antiIce.windshield];
            
            if (windshield.enabled && this.electricalPower) {
                windshield.power = 1500; // watts total
                
                windshield.elements.forEach(element => {
                    if (!element.failed) {
                        element.current = windshield.power / windshield.elements.length / 28; // amps
                        const powerPerElement = element.current * 28; // watts
                        const ambientTemp = this.aircraftState.temperature || -40;
                        element.temperature = ambientTemp + powerPerElement / 10;
                    } else {
                        element.current = 0;
                        element.temperature = this.aircraftState.temperature || -40;
                    }
                });
                
                // Average temperature
                const totalTemp = windshield.elements.reduce((sum, elem) => sum + elem.temperature, 0);
                windshield.temperature = totalTemp / windshield.elements.length;
            } else {
                windshield.power = 0;
                windshield.temperature = this.aircraftState.temperature || -40;
                windshield.elements.forEach(element => {
                    element.current = 0;
                    element.temperature = this.aircraftState.temperature || -40;
                });
            }
        });
    }

    private updateProbeHeat(deltaTime: number): void {
        Object.values(this.antiIce.probes).forEach(probe => {
            if (probe.enabled && !probe.heaterFailed && this.electricalPower) {
                probe.power = 50; // watts
                const ambientTemp = this.aircraftState.temperature || -40;
                probe.temperature = Math.max(ambientTemp + 30, 5);
            } else {
                probe.power = 0;
                probe.temperature = this.aircraftState.temperature || -40;
            }
        });
        
        // Waste heat
        if (this.antiIce.waste.enabled && this.electricalPower) {
            this.antiIce.waste.heated = true;
            this.antiIce.waste.temperature = Math.max(this.aircraftState.temperature + 20, 10);
        } else {
            this.antiIce.waste.heated = false;
            this.antiIce.waste.temperature = this.aircraftState.temperature || -40;
        }
    }

    private updateIceDetection(deltaTime: number): void {
        const ambientTemp = this.aircraftState.temperature || -40;
        const altitude = this.aircraftState.altitude || 0;
        const airspeed = this.aircraftState.indicatedAirspeed || 0;
        
        // Ice detection logic (simplified)
        const icingConditions = ambientTemp < 5 && ambientTemp > -20 && altitude > 0 && airspeed > 50;
        
        this.antiIce.detection.sensors.forEach(sensor => {
            if (!sensor.failed) {
                if (icingConditions && Math.random() > 0.98) { // Random ice encounter
                    sensor.icing = true;
                    sensor.severity = Math.floor(Math.random() * 4) + 1;
                } else if (!icingConditions || Math.random() > 0.95) {
                    sensor.icing = false;
                    sensor.severity = 0;
                }
            }
        });
        
        // Overall ice detection
        const activeSensors = this.antiIce.detection.sensors.filter(s => !s.failed);
        const icingSensors = activeSensors.filter(s => s.icing);
        
        this.antiIce.detection.icing.detected = icingSensors.length > 0;
        
        if (this.antiIce.detection.icing.detected) {
            const maxSeverity = Math.max(...icingSensors.map(s => s.severity));
            const severityLevels = ['TRACE', 'LIGHT', 'MODERATE', 'SEVERE'];
            this.antiIce.detection.icing.severity = severityLevels[Math.min(maxSeverity - 1, 3)] as any;
            
            this.antiIce.detection.icing.location = icingSensors.map(s => s.location);
            this.antiIce.detection.advisory.message = `ICE DETECTED - ${this.antiIce.detection.icing.severity}`;
        } else {
            this.antiIce.detection.icing.severity = 'TRACE';
            this.antiIce.detection.icing.location = [];
            this.antiIce.detection.advisory.message = '';
        }
    }

    private updateOxygen(deltaTime: number): void {
        const cabinAltitude = this.pressurization.cabin.altitude;
        
        // Automatic passenger mask deployment
        if (cabinAltitude > 14000 && !this.oxygen.passenger.masks.deployed) {
            this.deployPassengerMasks();
        }
        
        // Oxygen generator operation
        if (this.oxygen.passenger.generators.activated) {
            this.oxygen.passenger.generators.burning = true;
            this.oxygen.passenger.generators.temperature = 200; // Chemical generators get hot
            this.oxygen.passenger.generators.duration = Math.max(0, 
                this.oxygen.passenger.generators.duration - deltaTime / 60000); // minutes
            
            if (this.oxygen.passenger.generators.duration <= 0) {
                this.oxygen.passenger.generators.burning = false;
                this.oxygen.passenger.generators.temperature = 20;
            }
        }
        
        // Crew oxygen consumption
        if (this.oxygen.crew.masks.connected) {
            let flowRate = 0;
            switch (this.oxygen.crew.flow.mode) {
                case 'NORM':
                    flowRate = cabinAltitude > 10000 ? 0.5 : 0.2;
                    break;
                case 'HIGH':
                    flowRate = 1.0;
                    break;
                case '100%':
                    flowRate = 2.0;
                    break;
            }
            
            this.oxygen.crew.flow.rate = flowRate;
            
            // Update crew oxygen quantity
            const consumption = flowRate * deltaTime / 60000; // SCFM to cubic feet per update
            const bottleVolume = 115; // cubic feet at 1800 PSI
            const quantityReduction = (consumption / bottleVolume) * 100; // percentage
            
            this.oxygen.crew.quantity = Math.max(0, this.oxygen.crew.quantity - quantityReduction);
            this.oxygen.crew.pressure = this.oxygen.crew.quantity * 18; // PSI (1800 at 100%)
        }
        
        // Passenger oxygen flow
        if (this.oxygen.passenger.masks.deployed) {
            let totalFlow = 0;
            this.oxygen.passenger.masks.compartments.forEach(compartment => {
                if (compartment.deployed) {
                    compartment.flow = compartment.masks * 0.25; // SCFM per mask
                    totalFlow += compartment.flow;
                }
            });
            this.oxygen.passenger.flow = totalFlow;
        }
    }

    // Utility methods
    private getBleedAirPressure(): number {
        let maxPressure = 0;
        
        this.bleedAir.engines.forEach(engineBleed => {
            if (engineBleed.checkValve.open) {
                maxPressure = Math.max(maxPressure, engineBleed.regulator.pressure);
            }
        });
        
        if (this.bleedAir.apu.available) {
            maxPressure = Math.max(maxPressure, this.bleedAir.apu.pressure);
        }
        
        if (this.bleedAir.ground.valve.position > 0) {
            maxPressure = Math.max(maxPressure, this.bleedAir.ground.pressure);
        }
        
        return maxPressure;
    }

    private getBleedAirTemperature(): number {
        let totalFlow = 0;
        let weightedTemp = 0;
        
        this.bleedAir.engines.forEach(engineBleed => {
            if (engineBleed.checkValve.open) {
                totalFlow += engineBleed.highStage.flow;
                weightedTemp += engineBleed.precooler.outlet * engineBleed.highStage.flow;
            }
        });
        
        if (this.bleedAir.apu.available) {
            totalFlow += this.bleedAir.apu.flow;
            weightedTemp += this.bleedAir.apu.temperature * this.bleedAir.apu.flow;
        }
        
        if (this.bleedAir.ground.valve.position > 0) {
            totalFlow += this.bleedAir.ground.flow;
            weightedTemp += this.bleedAir.ground.temperature * this.bleedAir.ground.flow;
        }
        
        return totalFlow > 0 ? weightedTemp / totalFlow : 0;
    }

    private getColdAirTemp(): number {
        let totalFlow = 0;
        let weightedTemp = 0;
        
        this.airConditioning.packs.forEach(pack => {
            if (pack.status === SystemStatus.ON) {
                totalFlow += pack.discharge.flow;
                weightedTemp += pack.discharge.temperature * pack.discharge.flow;
            }
        });
        
        return totalFlow > 0 ? weightedTemp / totalFlow : 10;
    }

    private calculateDewPoint(temperature: number, pressure: number): number {
        // Simplified dew point calculation
        const saturationPressure = 6.112 * Math.exp((17.67 * temperature) / (temperature + 243.5));
        const actualPressure = Math.min(saturationPressure, pressure * 0.01); // Convert PSI to mb
        return (243.5 * Math.log(actualPressure / 6.112)) / (17.67 - Math.log(actualPressure / 6.112));
    }

    private deployPassengerMasks(): void {
        this.oxygen.passenger.masks.deployed = true;
        this.oxygen.passenger.generators.activated = true;
        this.oxygen.passenger.generators.duration = 15; // 15 minutes
        
        this.oxygen.passenger.masks.compartments.forEach(compartment => {
            compartment.deployed = true;
        });
    }

    private checkAlerts(): void {
        this.alerts = [];
        
        // Pressurization alerts
        if (this.pressurization.cabin.altitude > 10000) {
            this.alerts.push({
                id: 'CABIN_ALT_HIGH',
                level: AlertLevel.WARNING,
                message: 'CABIN ALTITUDE',
                system: 'ENVIRONMENTAL',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: true
            });
        }
        
        if (this.pressurization.differential.current > this.pressurization.differential.maximum) {
            this.alerts.push({
                id: 'CABIN_DIFF_HIGH',
                level: AlertLevel.CAUTION,
                message: 'CABIN DIFF PRESS HIGH',
                system: 'ENVIRONMENTAL',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: false
            });
        }
        
        // Pack alerts
        this.airConditioning.packs.forEach(pack => {
            if (pack.valve.commanded && pack.status === SystemStatus.OFF) {
                this.alerts.push({
                    id: `${pack.name}_FAIL`,
                    level: AlertLevel.CAUTION,
                    message: `${pack.name} FAIL`,
                    system: 'ENVIRONMENTAL',
                    timestamp: Date.now(),
                    acknowledged: false,
                    inhibited: false,
                    active: true,
                    flashing: false
                });
            }
        });
        
        // Ice detection alerts
        if (this.antiIce.detection.icing.detected) {
            this.alerts.push({
                id: 'ICE_DETECTED',
                level: AlertLevel.CAUTION,
                message: 'ICE DETECTED',
                system: 'ENVIRONMENTAL',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: false
            });
        }
        
        // Oxygen alerts
        if (this.oxygen.crew.quantity < 25) {
            this.alerts.push({
                id: 'CREW_OXYGEN_LOW',
                level: AlertLevel.CAUTION,
                message: 'CREW OXYGEN LOW',
                system: 'ENVIRONMENTAL',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: false
            });
        }
        
        if (this.oxygen.passenger.masks.deployed) {
            this.alerts.push({
                id: 'PASSENGER_MASKS_DEPLOYED',
                level: AlertLevel.WARNING,
                message: 'PASS MASKS DEPLOYED',
                system: 'ENVIRONMENTAL',
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
    public setPressurization(mode: 'AUTO' | 'MANUAL' | 'DUMP'): void {
        this.pressurization.controller.mode = mode;
    }

    public setOutflowValve(position: number): void {
        if (this.pressurization.controller.mode === 'MANUAL') {
            this.pressurization.outflowValve.manual = true;
            this.pressurization.outflowValve.target = Math.max(0, Math.min(1, position));
        }
    }

    public setPack(packName: string, enabled: boolean): void {
        const pack = this.airConditioning.packs.get(packName);
        if (pack) {
            pack.valve.commanded = enabled;
        }
    }

    public setZoneTemperature(zoneName: string, temperature: number): void {
        const zone = this.airConditioning.mixManifold.zones.get(zoneName);
        if (zone) {
            zone.temperature.target = Math.max(10, Math.min(30, temperature));
        }
    }

    public setWingAntiIce(enabled: boolean): void {
        this.antiIce.wings.left.enabled = enabled;
        this.antiIce.wings.right.enabled = enabled;
    }

    public setEngineAntiIce(engineNumber: number, enabled: boolean): void {
        const engineAntiIce = this.antiIce.engines.get(`ENGINE_${engineNumber}`);
        if (engineAntiIce) {
            engineAntiIce.enabled = enabled;
        }
    }

    public setPitotHeat(system: string, enabled: boolean): void {
        const pitotHeat = this.antiIce.pitotStatic.get(system);
        if (pitotHeat) {
            pitotHeat.pitot.enabled = enabled;
            pitotHeat.static.enabled = enabled;
            pitotHeat.tav.enabled = enabled;
        }
    }

    public setWindshieldHeat(side: 'left' | 'right', enabled: boolean): void {
        this.antiIce.windshield[side].enabled = enabled;
    }

    public setCrewOxygenFlow(mode: 'NORM' | 'HIGH' | '100%'): void {
        this.oxygen.crew.flow.mode = mode;
    }

    public connectCrewMask(connected: boolean): void {
        this.oxygen.crew.masks.connected = connected;
    }

    /**
     * Get display data for instruments
     */
    public getDisplayData(): EnvironmentalDisplayData {
        const packs: PackData[] = Array.from(this.airConditioning.packs.values()).map(pack => ({
            name: pack.name,
            status: pack.status,
            temperature: {
                supply: pack.discharge.temperature,
                discharge: pack.discharge.temperature
            },
            flow: pack.discharge.flow,
            valve: pack.valve.position > 0.5
        }));

        const mixValves: MixValveData[] = Array.from(this.airConditioning.mixManifold.mixValves.values()).map(valve => ({
            zone: valve.zone,
            position: valve.position * 100,
            temperature: {
                hot: valve.hotAir.temperature,
                cold: valve.coldAir.temperature,
                mixed: valve.mixed.temperature
            }
        }));

        const engines: BleedAirData[] = Array.from(this.bleedAir.engines.values()).map(engine => ({
            name: `ENGINE ${engine.engineNumber}`,
            status: engine.checkValve.open ? SystemStatus.ON : SystemStatus.OFF,
            pressure: engine.regulator.pressure,
            temperature: engine.precooler.outlet,
            valve: engine.highStage.valve.position > 0.5,
            regulator: engine.regulator.position > 0.5
        }));

        return {
            pressurization: {
                cabinAltitude: this.pressurization.cabin.altitude,
                cabinVS: this.pressurization.cabin.altitudeRate,
                diffPressure: this.pressurization.differential.current,
                outflowValve: this.pressurization.outflowValve.position * 100,
                safetyValve: this.pressurization.safetyValve.open,
                mode: this.pressurization.controller.mode,
                controller: this.pressurization.controller.channel
            },
            airConditioning: {
                packs,
                mixValves,
                temperature: {
                    cockpit: this.airConditioning.mixManifold.zones.get('COCKPIT')?.temperature.current || 22,
                    cabin: this.airConditioning.mixManifold.zones.get('CABIN_FWD')?.temperature.current || 22,
                    aft: this.airConditioning.mixManifold.zones.get('CABIN_AFT')?.temperature.current || 22,
                    cargo: this.airConditioning.mixManifold.zones.get('CARGO')?.temperature.current || 22
                },
                flow: {
                    high: false, // Simplified
                    normal: true,
                    low: false
                }
            },
            bleedAir: {
                engines,
                apu: {
                    name: 'APU',
                    status: this.bleedAir.apu.available ? SystemStatus.ON : SystemStatus.OFF,
                    pressure: this.bleedAir.apu.pressure,
                    temperature: this.bleedAir.apu.temperature,
                    valve: this.bleedAir.apu.valve.position > 0.5,
                    regulator: true
                },
                ground: {
                    name: 'GROUND',
                    status: this.bleedAir.ground.connected ? SystemStatus.ON : SystemStatus.OFF,
                    pressure: this.bleedAir.ground.pressure,
                    temperature: this.bleedAir.ground.temperature,
                    valve: this.bleedAir.ground.valve.position > 0.5,
                    regulator: true
                },
                crossbleed: {
                    valve: this.bleedAir.crossbleed.valve.position > 0.5,
                    auto: this.bleedAir.crossbleed.valve.automatic
                }
            },
            antiIce: {
                engine: Array.from(this.antiIce.engines.values()).map(e => e.enabled),
                wing: this.antiIce.wings.left.enabled,
                pitot: Array.from(this.antiIce.pitotStatic.values()).map(p => p.pitot.enabled),
                windshield: this.antiIce.windshield.left.enabled,
                probe: this.antiIce.probes.tav.enabled,
                waste: this.antiIce.waste.enabled
            },
            oxygen: {
                passenger: {
                    pressure: this.oxygen.passenger.pressure,
                    quantity: this.oxygen.passenger.quantity,
                    generators: this.oxygen.passenger.generators.activated
                },
                crew: {
                    pressure: this.oxygen.crew.pressure,
                    quantity: this.oxygen.crew.quantity,
                    flow: this.oxygen.crew.flow.mode
                }
            }
        };
    }

    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public isSystemHealthy(): boolean {
        return this.alerts.filter(alert => 
            alert.level === AlertLevel.WARNING || alert.level === AlertLevel.EMERGENCY
        ).length === 0;
    }
}