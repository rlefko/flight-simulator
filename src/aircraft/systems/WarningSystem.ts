import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    AlertData,
    ConfigurationData 
} from './InstrumentData';

/**
 * Comprehensive warning and alerting system
 * Models master caution/warning, GPWS/EGPWS, TCAS, stall warning, and configuration alerts
 */

export interface MasterWarningSystem {
    masterWarning: {
        active: boolean;
        latched: boolean;
        acknowledged: boolean;
        test: boolean;
        inhibited: boolean;
        flashRate: number;        // flashes per second
    };
    masterCaution: {
        active: boolean;
        latched: boolean;
        acknowledged: boolean;
        test: boolean;
        inhibited: boolean;
        steadyOn: boolean;
    };
    annunciators: Map<string, Annunciator>;
    recall: {
        active: boolean;
        messages: AlertData[];
        scrolling: boolean;
        currentIndex: number;
    };
}

export interface Annunciator {
    id: string;
    system: string;
    message: string;
    level: AlertLevel;
    active: boolean;
    latched: boolean;
    acknowledged: boolean;
    inhibited: boolean;
    flashing: boolean;
    priority: number;           // 1 = highest priority
    conditions: AlertCondition[];
    inhibitConditions: InhibitCondition[];
    dependencies: string[];     // required systems/conditions
}

export interface AlertCondition {
    parameter: string;          // parameter to monitor
    operator: '>' | '<' | '=' | '!=' | 'AND' | 'OR';
    value: number | boolean | string;
    duration?: number;          // minimum duration in ms before triggering
    hysteresis?: number;        // hysteresis value for numeric comparisons
}

export interface InhibitCondition {
    parameter: string;
    operator: '>' | '<' | '=' | '!=' | 'AND' | 'OR';
    value: number | boolean | string;
    description: string;
}

export interface GroundProximityWarningSystem {
    status: SystemStatus;
    mode: 'GPWS' | 'EGPWS';
    version: string;
    inhibits: {
        gearOverride: boolean;   // gear override switch
        flapOverride: boolean;   // flap override switch
        terrain: boolean;        // terrain inhibit
        altitude: number;        // inhibit below this altitude AGL
        takeoffLanding: boolean; // T/O and landing inhibit
    };
    modes: {
        mode1: Mode1Warning;     // Excessive descent rate
        mode2: Mode2Warning;     // Excessive terrain closure rate
        mode3: Mode3Warning;     // Altitude loss after takeoff
        mode4: Mode4Warning;     // Unsafe terrain clearance
        mode5: Mode5Warning;     // Excessive deviation below glide path
        mode6: Mode6Warning;     // Callouts and alerts
        windshear: WindshearWarning;
        terrain: TerrainWarning; // EGPWS terrain awareness
    };
    radioAltimeter: {
        altitude: number;        // feet AGL
        valid: boolean;
        antenna1: number;
        antenna2: number;
        failed: boolean;
    };
    callouts: {
        enabled: boolean;
        altitudes: number[];     // callout altitudes
        minimums: boolean;       // decision height callout
        retard: boolean;         // retard flare callout
    };
}

export interface Mode1Warning {
    enabled: boolean;
    triggered: boolean;
    sinkRate: number;           // feet per minute
    altitude: number;           // radio altitude
    thresholds: {
        caution: { altitude: number; sinkRate: number }[];
        warning: { altitude: number; sinkRate: number }[];
    };
}

export interface Mode2Warning {
    enabled: boolean;
    triggered: boolean;
    closureRate: number;        // feet per minute
    altitude: number;           // radio altitude
    thresholds: {
        caution: { altitude: number; closureRate: number }[];
        warning: { altitude: number; closureRate: number }[];
    };
}

export interface Mode3Warning {
    enabled: boolean;
    triggered: boolean;
    altitudeLoss: number;       // feet lost after takeoff
    maxAltitude: number;        // maximum altitude reached
    thresholds: {
        caution: number;        // feet of altitude loss
        warning: number;        // feet of altitude loss
    };
}

export interface Mode4Warning {
    enabled: boolean;
    triggered: boolean;
    terrainClearance: number;   // feet above terrain
    airspeed: number;           // knots
    configuration: 'CLEAN' | 'GEAR' | 'FLAPS' | 'LANDING';
    thresholds: {
        clean: { speed: number; clearance: number }[];
        gear: { speed: number; clearance: number }[];
        flaps: { speed: number; clearance: number }[];
        landing: { speed: number; clearance: number }[];
    };
}

export interface Mode5Warning {
    enabled: boolean;
    triggered: boolean;
    glideslopeDeviation: number; // dots below glideslope
    altitude: number;           // radio altitude
    thresholds: {
        caution: { altitude: number; deviation: number }[];
        warning: { altitude: number; deviation: number }[];
    };
}

export interface Mode6Warning {
    enabled: boolean;
    callouts: {
        altitude: {
            values: number[];    // callout altitudes
            last: number;        // last callout made
        };
        bank: {
            threshold: number;   // degrees bank angle
            altitude: number;    // minimum altitude for callout
        };
        minimums: boolean;
        retard: boolean;
    };
}

export interface WindshearWarning {
    enabled: boolean;
    detected: boolean;
    severity: 'CAUTION' | 'WARNING';
    type: 'REACTIVE' | 'PREDICTIVE';
    parameters: {
        windspeedChange: number; // knots per second
        verticalWindspeed: number; // feet per minute
        altitudeChange: number;  // feet
        f: number;               // f-factor
    };
    guidance: {
        pitch: number;           // degrees
        power: string;           // power setting guidance
        message: string;
    };
}

export interface TerrainWarning {
    enabled: boolean;
    database: {
        loaded: boolean;
        version: string;
        coverage: string;
    };
    display: {
        range: number;           // nautical miles
        alerts: TerrainAlert[];
        colors: {
            red: TerrainCell[];  // immediate danger
            yellow: TerrainCell[]; // caution
            green: TerrainCell[]; // normal
        };
    };
    alerts: {
        pullUp: boolean;
        terrain: boolean;
        obstacle: boolean;
    };
}

export interface TerrainAlert {
    type: 'TERRAIN' | 'OBSTACLE';
    bearing: number;            // degrees relative
    distance: number;           // nautical miles
    elevation: number;          // feet MSL
    clearance: number;          // feet above terrain
    severity: 'RED' | 'YELLOW';
}

export interface TerrainCell {
    latitude: number;
    longitude: number;
    elevation: number;          // feet MSL
    color: 'RED' | 'YELLOW' | 'GREEN';
}

export interface StallWarningSystem {
    enabled: boolean;
    stickShaker: {
        active: boolean;
        intensity: number;       // 0-1 intensity
        frequency: number;       // Hz
        threshold: {
            clean: number;       // angle of attack
            flaps: number[];     // AOA per flap setting
            icing: number;       // AOA reduction in icing
        };
    };
    alphaVane: {
        left: {
            angle: number;       // degrees
            valid: boolean;
            heater: boolean;
        };
        right: {
            angle: number;       // degrees
            valid: boolean;
            heater: boolean;
        };
    };
    stickPusher: {
        active: boolean;
        force: number;           // pounds
        threshold: number;       // AOA for activation
        enabled: boolean;
        test: boolean;
    };
    speedTape: {
        redBand: {
            top: number;         // knots
            bottom: number;      // knots
        };
        amberBand: {
            top: number;         // knots
            bottom: number;      // knots
        };
    };
}

export interface ConfigurationWarningSystem {
    enabled: boolean;
    phases: {
        takeoff: TakeoffConfiguration;
        approach: ApproachConfiguration;
        landing: LandingConfiguration;
    };
    inhibits: {
        ground: boolean;         // on ground inhibit
        altitude: number;        // inhibit above this altitude
        airspeed: number;        // inhibit above this airspeed
    };
}

export interface TakeoffConfiguration {
    checks: {
        flaps: {
            required: number[];  // acceptable flap settings
            current: number;
            valid: boolean;
        };
        spoilers: {
            required: 'RETRACTED';
            current: number;     // position 0-1
            valid: boolean;
        };
        trim: {
            elevator: {
                min: number;     // degrees
                max: number;     // degrees
                current: number;
                valid: boolean;
            };
            aileron: {
                max: number;     // degrees absolute
                current: number;
                valid: boolean;
            };
            rudder: {
                max: number;     // degrees absolute
                current: number;
                valid: boolean;
            };
        };
        parkingBrake: {
            required: 'OFF';
            current: boolean;
            valid: boolean;
        };
    };
    warnings: {
        flapsSpoilers: boolean;
        trimNotSet: boolean;
        parkingBrakeSet: boolean;
    };
}

export interface ApproachConfiguration {
    checks: {
        gear: {
            required: 'DOWN';
            nose: 'UP' | 'DOWN' | 'TRANSIT';
            left: 'UP' | 'DOWN' | 'TRANSIT';
            right: 'UP' | 'DOWN' | 'TRANSIT';
            valid: boolean;
        };
        flaps: {
            minimum: number;     // minimum flap setting
            current: number;
            valid: boolean;
        };
        speedbrake: {
            required: 'RETRACTED';
            current: number;
            valid: boolean;
        };
    };
    warnings: {
        gearNotDown: boolean;
        flapsNotSet: boolean;
        speedbrakeExtended: boolean;
    };
}

export interface LandingConfiguration {
    checks: {
        gear: {
            required: 'DOWN_AND_LOCKED';
            positions: {
                nose: 'UP' | 'DOWN' | 'TRANSIT';
                left: 'UP' | 'DOWN' | 'TRANSIT';
                right: 'UP' | 'DOWN' | 'TRANSIT';
            };
            doors: boolean[];    // gear door status
            valid: boolean;
        };
        flaps: {
            required: number[];  // acceptable landing flap settings
            current: number;
            valid: boolean;
        };
        spoilers: {
            armed: boolean;      // spoilers armed for landing
            current: number;     // current position
        };
    };
    warnings: {
        gearNotDownLocked: boolean;
        flapsNotLanding: boolean;
        spoilersNotArmed: boolean;
    };
}

export interface CabinPressureWarning {
    enabled: boolean;
    altitude: {
        current: number;         // cabin altitude feet
        warning: number;         // warning threshold
        maximum: number;         // maximum allowable
    };
    differential: {
        current: number;         // PSI
        warning: number;         // warning threshold
        maximum: number;         // maximum allowable
    };
    rate: {
        current: number;         // feet per minute
        warning: number;         // warning threshold
    };
    warnings: {
        altitudeHigh: boolean;
        differentialHigh: boolean;
        rateHigh: boolean;
        takeoffLanding: boolean; // special T/O and landing warnings
    };
}

export interface FireWarningSystem {
    enabled: boolean;
    zones: Map<string, FireZone>;
    extinguishers: Map<string, FireExtinguisher>;
    testSystem: {
        active: boolean;
        sequence: string[];
        currentTest: string;
    };
}

export interface FireZone {
    name: string;                // 'ENG_1', 'ENG_2', 'APU', 'CARGO', etc.
    loops: FireDetectionLoop[];
    fire: boolean;
    overheat: boolean;
    fault: boolean;
    test: boolean;
    armed: boolean;              // ready for extinguisher discharge
}

export interface FireDetectionLoop {
    name: string;                // 'LOOP_A', 'LOOP_B'
    resistance: number;          // ohms
    temperature: number;         // degrees C
    triggered: boolean;
    failed: boolean;
    integrity: number;           // 0-1, loop integrity
}

export interface FireExtinguisher {
    name: string;                // 'BOTTLE_1', 'BOTTLE_2'
    zone: string;                // associated fire zone
    pressure: number;            // PSI
    discharged: boolean;
    armed: boolean;
    weight: number;              // agent weight
    type: 'HALON' | 'CO2' | 'WATER' | 'DRY_CHEMICAL';
}

export class WarningSystem {
    private masterWarning: MasterWarningSystem;
    private gpws: GroundProximityWarningSystem;
    private stallWarning: StallWarningSystem;
    private configWarning: ConfigurationWarningSystem;
    private pressureWarning: CabinPressureWarning;
    private fireWarning: FireWarningSystem;
    
    private aircraftState: any = {};
    private systemStates: Map<string, any> = new Map();
    private alerts: AlertData[] = [];
    
    private updateCounters = {
        master: 0,
        gpws: 0,
        stall: 0,
        config: 0,
        fire: 0
    };
    
    // Update rates (Hz)
    private readonly MASTER_UPDATE_RATE = 20;
    private readonly GPWS_UPDATE_RATE = 10;
    private readonly STALL_UPDATE_RATE = 50;
    private readonly CONFIG_UPDATE_RATE = 5;
    private readonly FIRE_UPDATE_RATE = 20;

    constructor() {
        this.initializeSystem();
    }

    /**
     * Initialize warning system components
     */
    private initializeSystem(): void {
        this.initializeMasterWarning();
        this.initializeGPWS();
        this.initializeStallWarning();
        this.initializeConfigurationWarning();
        this.initializePressureWarning();
        this.initializeFireWarning();
    }

    private initializeMasterWarning(): void {
        this.masterWarning = {
            masterWarning: {
                active: false,
                latched: false,
                acknowledged: false,
                test: false,
                inhibited: false,
                flashRate: 2
            },
            masterCaution: {
                active: false,
                latched: false,
                acknowledged: false,
                test: false,
                inhibited: false,
                steadyOn: false
            },
            annunciators: new Map(),
            recall: {
                active: false,
                messages: [],
                scrolling: false,
                currentIndex: 0
            }
        };

        this.initializeAnnunciators();
    }

    private initializeAnnunciators(): void {
        const annunciatorDefs = [
            // Engine warnings
            { id: 'ENG_1_FIRE', system: 'ENGINE', message: 'ENG 1 FIRE', level: AlertLevel.WARNING, priority: 1 },
            { id: 'ENG_2_FIRE', system: 'ENGINE', message: 'ENG 2 FIRE', level: AlertLevel.WARNING, priority: 1 },
            { id: 'ENG_1_FAIL', system: 'ENGINE', message: 'ENG 1 FAIL', level: AlertLevel.WARNING, priority: 2 },
            { id: 'ENG_2_FAIL', system: 'ENGINE', message: 'ENG 2 FAIL', level: AlertLevel.WARNING, priority: 2 },
            
            // Hydraulic warnings
            { id: 'HYD_A_LOW', system: 'HYDRAULIC', message: 'HYD A LOW', level: AlertLevel.CAUTION, priority: 5 },
            { id: 'HYD_B_LOW', system: 'HYDRAULIC', message: 'HYD B LOW', level: AlertLevel.CAUTION, priority: 5 },
            
            // Electrical warnings
            { id: 'GEN_1_FAIL', system: 'ELECTRICAL', message: 'GEN 1 FAIL', level: AlertLevel.CAUTION, priority: 4 },
            { id: 'GEN_2_FAIL', system: 'ELECTRICAL', message: 'GEN 2 FAIL', level: AlertLevel.CAUTION, priority: 4 },
            { id: 'BATTERY_HOT', system: 'ELECTRICAL', message: 'BATTERY HOT', level: AlertLevel.WARNING, priority: 3 },
            
            // Fuel warnings
            { id: 'FUEL_LOW', system: 'FUEL', message: 'FUEL LOW', level: AlertLevel.CAUTION, priority: 6 },
            { id: 'FUEL_IMBALANCE', system: 'FUEL', message: 'FUEL IMBAL', level: AlertLevel.CAUTION, priority: 7 },
            
            // Environmental warnings
            { id: 'CABIN_ALT', system: 'ENVIRONMENTAL', message: 'CABIN ALT', level: AlertLevel.WARNING, priority: 2 },
            { id: 'PACK_1_FAIL', system: 'ENVIRONMENTAL', message: 'PACK 1 FAIL', level: AlertLevel.CAUTION, priority: 8 },
            { id: 'PACK_2_FAIL', system: 'ENVIRONMENTAL', message: 'PACK 2 FAIL', level: AlertLevel.CAUTION, priority: 8 },
            
            // Configuration warnings
            { id: 'CONFIG_FLAPS', system: 'CONFIGURATION', message: 'CONFIG FLAPS', level: AlertLevel.CAUTION, priority: 9 },
            { id: 'CONFIG_GEAR', system: 'CONFIGURATION', message: 'CONFIG GEAR', level: AlertLevel.WARNING, priority: 3 },
            { id: 'CONFIG_SPOILERS', system: 'CONFIGURATION', message: 'CONFIG SPOILERS', level: AlertLevel.CAUTION, priority: 9 },
            
            // Flight warnings
            { id: 'STALL', system: 'FLIGHT', message: 'STALL', level: AlertLevel.WARNING, priority: 1 },
            { id: 'OVERSPEED', system: 'FLIGHT', message: 'OVERSPEED', level: AlertLevel.WARNING, priority: 2 },
            { id: 'WINDSHEAR', system: 'FLIGHT', message: 'WINDSHEAR', level: AlertLevel.WARNING, priority: 1 }
        ];

        annunciatorDefs.forEach(def => {
            const annunciator: Annunciator = {
                id: def.id,
                system: def.system,
                message: def.message,
                level: def.level,
                active: false,
                latched: false,
                acknowledged: false,
                inhibited: false,
                flashing: def.level === AlertLevel.WARNING,
                priority: def.priority,
                conditions: [],
                inhibitConditions: [],
                dependencies: []
            };
            
            this.masterWarning.annunciators.set(def.id, annunciator);
        });
    }

    private initializeGPWS(): void {
        this.gpws = {
            status: SystemStatus.ON,
            mode: 'EGPWS',
            version: '7.1',
            inhibits: {
                gearOverride: false,
                flapOverride: false,
                terrain: false,
                altitude: 50,
                takeoffLanding: false
            },
            modes: {
                mode1: {
                    enabled: true,
                    triggered: false,
                    sinkRate: 0,
                    altitude: 0,
                    thresholds: {
                        caution: [
                            { altitude: 2450, sinkRate: 2000 },
                            { altitude: 1000, sinkRate: 1500 },
                            { altitude: 500, sinkRate: 1000 }
                        ],
                        warning: [
                            { altitude: 2450, sinkRate: 2500 },
                            { altitude: 1000, sinkRate: 2000 },
                            { altitude: 500, sinkRate: 1500 }
                        ]
                    }
                },
                mode2: {
                    enabled: true,
                    triggered: false,
                    closureRate: 0,
                    altitude: 0,
                    thresholds: {
                        caution: [
                            { altitude: 2450, closureRate: 2000 },
                            { altitude: 1000, closureRate: 1500 }
                        ],
                        warning: [
                            { altitude: 2450, closureRate: 2500 },
                            { altitude: 1000, closureRate: 2000 }
                        ]
                    }
                },
                mode3: {
                    enabled: true,
                    triggered: false,
                    altitudeLoss: 0,
                    maxAltitude: 0,
                    thresholds: {
                        caution: 10,
                        warning: 15
                    }
                },
                mode4: {
                    enabled: true,
                    triggered: false,
                    terrainClearance: 0,
                    airspeed: 0,
                    configuration: 'CLEAN',
                    thresholds: {
                        clean: [
                            { speed: 190, clearance: 500 },
                            { speed: 150, clearance: 300 }
                        ],
                        gear: [
                            { speed: 190, clearance: 500 },
                            { speed: 150, clearance: 300 }
                        ],
                        flaps: [
                            { speed: 159, clearance: 245 },
                            { speed: 145, clearance: 200 }
                        ],
                        landing: [
                            { speed: 159, clearance: 245 },
                            { speed: 145, clearance: 200 }
                        ]
                    }
                },
                mode5: {
                    enabled: true,
                    triggered: false,
                    glideslopeDeviation: 0,
                    altitude: 0,
                    thresholds: {
                        caution: [
                            { altitude: 300, deviation: 1.3 },
                            { altitude: 150, deviation: 2.0 }
                        ],
                        warning: [
                            { altitude: 300, deviation: 2.0 },
                            { altitude: 150, deviation: 2.5 }
                        ]
                    }
                },
                mode6: {
                    enabled: true,
                    callouts: {
                        altitude: {
                            values: [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10],
                            last: 0
                        },
                        bank: {
                            threshold: 35,
                            altitude: 150
                        },
                        minimums: true,
                        retard: true
                    }
                },
                windshear: {
                    enabled: true,
                    detected: false,
                    severity: 'CAUTION',
                    type: 'REACTIVE',
                    parameters: {
                        windspeedChange: 0,
                        verticalWindspeed: 0,
                        altitudeChange: 0,
                        f: 0
                    },
                    guidance: {
                        pitch: 0,
                        power: '',
                        message: ''
                    }
                },
                terrain: {
                    enabled: true,
                    database: {
                        loaded: true,
                        version: '2025-01',
                        coverage: 'GLOBAL'
                    },
                    display: {
                        range: 20,
                        alerts: [],
                        colors: {
                            red: [],
                            yellow: [],
                            green: []
                        }
                    },
                    alerts: {
                        pullUp: false,
                        terrain: false,
                        obstacle: false
                    }
                }
            },
            radioAltimeter: {
                altitude: 0,
                valid: false,
                antenna1: 0,
                antenna2: 0,
                failed: false
            },
            callouts: {
                enabled: true,
                altitudes: [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10],
                minimums: true,
                retard: true
            }
        };
    }

    private initializeStallWarning(): void {
        this.stallWarning = {
            enabled: true,
            stickShaker: {
                active: false,
                intensity: 0,
                frequency: 25,
                threshold: {
                    clean: 16,
                    flaps: [14, 13, 12, 11, 10],
                    icing: -2
                }
            },
            alphaVane: {
                left: {
                    angle: 0,
                    valid: true,
                    heater: false
                },
                right: {
                    angle: 0,
                    valid: true,
                    heater: false
                }
            },
            stickPusher: {
                active: false,
                force: 0,
                threshold: 20,
                enabled: true,
                test: false
            },
            speedTape: {
                redBand: {
                    top: 0,
                    bottom: 0
                },
                amberBand: {
                    top: 0,
                    bottom: 0
                }
            }
        };
    }

    private initializeConfigurationWarning(): void {
        this.configWarning = {
            enabled: true,
            phases: {
                takeoff: {
                    checks: {
                        flaps: {
                            required: [5, 10, 15],
                            current: 0,
                            valid: false
                        },
                        spoilers: {
                            required: 'RETRACTED',
                            current: 0,
                            valid: false
                        },
                        trim: {
                            elevator: {
                                min: -2,
                                max: 8,
                                current: 0,
                                valid: false
                            },
                            aileron: {
                                max: 5,
                                current: 0,
                                valid: false
                            },
                            rudder: {
                                max: 5,
                                current: 0,
                                valid: false
                            }
                        },
                        parkingBrake: {
                            required: 'OFF',
                            current: false,
                            valid: false
                        }
                    },
                    warnings: {
                        flapsSpoilers: false,
                        trimNotSet: false,
                        parkingBrakeSet: false
                    }
                },
                approach: {
                    checks: {
                        gear: {
                            required: 'DOWN',
                            nose: 'UP',
                            left: 'UP',
                            right: 'UP',
                            valid: false
                        },
                        flaps: {
                            minimum: 15,
                            current: 0,
                            valid: false
                        },
                        speedbrake: {
                            required: 'RETRACTED',
                            current: 0,
                            valid: false
                        }
                    },
                    warnings: {
                        gearNotDown: false,
                        flapsNotSet: false,
                        speedbrakeExtended: false
                    }
                },
                landing: {
                    checks: {
                        gear: {
                            required: 'DOWN_AND_LOCKED',
                            positions: {
                                nose: 'UP',
                                left: 'UP',
                                right: 'UP'
                            },
                            doors: [false, false, false],
                            valid: false
                        },
                        flaps: {
                            required: [30, 40],
                            current: 0,
                            valid: false
                        },
                        spoilers: {
                            armed: false,
                            current: 0
                        }
                    },
                    warnings: {
                        gearNotDownLocked: false,
                        flapsNotLanding: false,
                        spoilersNotArmed: false
                    }
                }
            },
            inhibits: {
                ground: true,
                altitude: 700,
                airspeed: 100
            }
        };
    }

    private initializePressureWarning(): void {
        this.pressureWarning = {
            enabled: true,
            altitude: {
                current: 0,
                warning: 10000,
                maximum: 14000
            },
            differential: {
                current: 0,
                warning: 9.0,
                maximum: 9.5
            },
            rate: {
                current: 0,
                warning: 2000
            },
            warnings: {
                altitudeHigh: false,
                differentialHigh: false,
                rateHigh: false,
                takeoffLanding: false
            }
        };
    }

    private initializeFireWarning(): void {
        this.fireWarning = {
            enabled: true,
            zones: new Map(),
            extinguishers: new Map(),
            testSystem: {
                active: false,
                sequence: [],
                currentTest: ''
            }
        };

        // Initialize fire zones
        const zones = ['ENG_1', 'ENG_2', 'APU', 'CARGO_FWD', 'CARGO_AFT'];
        zones.forEach(zoneName => {
            const zone: FireZone = {
                name: zoneName,
                loops: [
                    {
                        name: 'LOOP_A',
                        resistance: 4.0,
                        temperature: 20,
                        triggered: false,
                        failed: false,
                        integrity: 1.0
                    },
                    {
                        name: 'LOOP_B',
                        resistance: 4.0,
                        temperature: 20,
                        triggered: false,
                        failed: false,
                        integrity: 1.0
                    }
                ],
                fire: false,
                overheat: false,
                fault: false,
                test: false,
                armed: false
            };
            this.fireWarning.zones.set(zoneName, zone);
        });

        // Initialize fire extinguishers
        for (let i = 1; i <= 4; i++) {
            const extinguisher: FireExtinguisher = {
                name: `BOTTLE_${i}`,
                zone: i <= 2 ? `ENG_${i}` : i === 3 ? 'APU' : 'CARGO_FWD',
                pressure: 600,
                discharged: false,
                armed: false,
                weight: 22.5,
                type: 'HALON'
            };
            this.fireWarning.extinguishers.set(extinguisher.name, extinguisher);
        }
    }

    /**
     * Update warning system
     */
    public update(deltaTime: number, aircraftState: any, systemStates: Map<string, any>): void {
        this.aircraftState = aircraftState;
        this.systemStates = systemStates;
        
        // Update systems at their respective rates
        this.updateCounters.master += deltaTime;
        if (this.updateCounters.master >= 1000 / this.MASTER_UPDATE_RATE) {
            this.updateMasterWarning(this.updateCounters.master);
            this.updateCounters.master = 0;
        }

        this.updateCounters.gpws += deltaTime;
        if (this.updateCounters.gpws >= 1000 / this.GPWS_UPDATE_RATE) {
            this.updateGPWS(this.updateCounters.gpws);
            this.updateCounters.gpws = 0;
        }

        this.updateCounters.stall += deltaTime;
        if (this.updateCounters.stall >= 1000 / this.STALL_UPDATE_RATE) {
            this.updateStallWarning(this.updateCounters.stall);
            this.updateCounters.stall = 0;
        }

        this.updateCounters.config += deltaTime;
        if (this.updateCounters.config >= 1000 / this.CONFIG_UPDATE_RATE) {
            this.updateConfigurationWarning(this.updateCounters.config);
            this.updateCounters.config = 0;
        }

        this.updateCounters.fire += deltaTime;
        if (this.updateCounters.fire >= 1000 / this.FIRE_UPDATE_RATE) {
            this.updateFireWarning(this.updateCounters.fire);
            this.updateCounters.fire = 0;
        }

        this.updatePressureWarning(deltaTime);
        this.processAlerts();
    }

    private updateMasterWarning(deltaTime: number): void {
        // Process annunciators
        let hasWarning = false;
        let hasCaution = false;

        this.masterWarning.annunciators.forEach(annunciator => {
            this.updateAnnunciator(annunciator);
            
            if (annunciator.active && !annunciator.acknowledged) {
                if (annunciator.level === AlertLevel.WARNING || annunciator.level === AlertLevel.EMERGENCY) {
                    hasWarning = true;
                } else if (annunciator.level === AlertLevel.CAUTION) {
                    hasCaution = true;
                }
            }
        });

        // Update master warning
        if (hasWarning && !this.masterWarning.masterWarning.inhibited) {
            this.masterWarning.masterWarning.active = true;
            this.masterWarning.masterWarning.latched = true;
        }

        // Update master caution
        if (hasCaution && !this.masterWarning.masterCaution.inhibited) {
            this.masterWarning.masterCaution.active = true;
            this.masterWarning.masterCaution.latched = true;
            this.masterWarning.masterCaution.steadyOn = true;
        }

        // Handle acknowledgments
        if (this.masterWarning.masterWarning.acknowledged) {
            this.masterWarning.masterWarning.active = false;
            this.masterWarning.masterWarning.acknowledged = false;
            
            // Acknowledge all warning level annunciators
            this.masterWarning.annunciators.forEach(annunciator => {
                if (annunciator.level === AlertLevel.WARNING || annunciator.level === AlertLevel.EMERGENCY) {
                    annunciator.acknowledged = true;
                    annunciator.flashing = false;
                }
            });
        }

        if (this.masterWarning.masterCaution.acknowledged) {
            this.masterWarning.masterCaution.active = false;
            this.masterWarning.masterCaution.acknowledged = false;
            this.masterWarning.masterCaution.steadyOn = false;
            
            // Acknowledge all caution level annunciators
            this.masterWarning.annunciators.forEach(annunciator => {
                if (annunciator.level === AlertLevel.CAUTION) {
                    annunciator.acknowledged = true;
                }
            });
        }
    }

    private updateAnnunciator(annunciator: Annunciator): void {
        // Check system-specific conditions based on annunciator ID
        let shouldActivate = false;

        switch (annunciator.id) {
            case 'ENG_1_FIRE':
            case 'ENG_2_FIRE':
                const engineNum = annunciator.id.includes('1') ? 1 : 2;
                const fireZone = this.fireWarning.zones.get(`ENG_${engineNum}`);
                shouldActivate = fireZone ? fireZone.fire : false;
                break;

            case 'CABIN_ALT':
                const envSystem = this.systemStates.get('environmental');
                if (envSystem) {
                    shouldActivate = envSystem.pressurization?.cabinAltitude > 10000;
                }
                break;

            case 'HYD_A_LOW':
            case 'HYD_B_LOW':
                const hydSystem = this.systemStates.get('hydraulic');
                if (hydSystem) {
                    const systemLetter = annunciator.id.includes('A') ? 'A' : 'B';
                    const system = hydSystem.systems?.find((s: any) => s.name === systemLetter);
                    shouldActivate = system ? system.pressure < 2000 : false;
                }
                break;

            case 'FUEL_LOW':
                const fuelSystem = this.systemStates.get('fuel');
                if (fuelSystem) {
                    shouldActivate = fuelSystem.totalFuel < 2000; // 2000 lbs threshold
                }
                break;

            case 'STALL':
                shouldActivate = this.stallWarning.stickShaker.active;
                break;

            case 'OVERSPEED':
                const maxSpeed = this.aircraftState.maxSpeed || 300;
                shouldActivate = (this.aircraftState.indicatedAirspeed || 0) > maxSpeed;
                break;

            case 'CONFIG_GEAR':
                shouldActivate = this.configWarning.phases.approach.warnings.gearNotDown ||
                               this.configWarning.phases.landing.warnings.gearNotDownLocked;
                break;

            case 'CONFIG_FLAPS':
                shouldActivate = this.configWarning.phases.takeoff.warnings.flapsSpoilers ||
                               this.configWarning.phases.approach.warnings.flapsNotSet ||
                               this.configWarning.phases.landing.warnings.flapsNotLanding;
                break;
        }

        // Update annunciator state
        if (shouldActivate && !annunciator.inhibited) {
            annunciator.active = true;
            annunciator.latched = true;
        } else if (!shouldActivate) {
            annunciator.active = false;
            if (annunciator.acknowledged) {
                annunciator.latched = false;
                annunciator.acknowledged = false;
            }
        }
    }

    private updateGPWS(deltaTime: number): void {
        if (this.gpws.status !== SystemStatus.ON) return;

        const altitude = this.aircraftState.altitudeAGL || 0;
        const verticalSpeed = this.aircraftState.verticalSpeed || 0;
        const airspeed = this.aircraftState.indicatedAirspeed || 0;

        this.gpws.radioAltimeter.altitude = altitude;
        this.gpws.radioAltimeter.valid = altitude > 0 && altitude < 2500;

        // Mode 1: Excessive descent rate
        if (this.gpws.modes.mode1.enabled && !this.gpws.inhibits.takeoffLanding) {
            this.updateMode1Warning(altitude, -verticalSpeed);
        }

        // Mode 2: Excessive terrain closure rate
        if (this.gpws.modes.mode2.enabled && !this.gpws.inhibits.takeoffLanding) {
            this.updateMode2Warning(altitude, -verticalSpeed);
        }

        // Mode 3: Altitude loss after takeoff
        if (this.gpws.modes.mode3.enabled) {
            this.updateMode3Warning(altitude);
        }

        // Mode 4: Unsafe terrain clearance
        if (this.gpws.modes.mode4.enabled) {
            this.updateMode4Warning(altitude, airspeed);
        }

        // Mode 5: Excessive deviation below glideslope
        if (this.gpws.modes.mode5.enabled) {
            this.updateMode5Warning(altitude);
        }

        // Mode 6: Callouts
        if (this.gpws.modes.mode6.enabled) {
            this.updateMode6Callouts(altitude);
        }

        // Windshear detection
        if (this.gpws.modes.windshear.enabled) {
            this.updateWindshearDetection(deltaTime);
        }
    }

    private updateMode1Warning(altitude: number, sinkRate: number): void {
        this.gpws.modes.mode1.sinkRate = sinkRate;
        this.gpws.modes.mode1.altitude = altitude;
        
        let triggered = false;
        
        // Check warning thresholds
        for (const threshold of this.gpws.modes.mode1.thresholds.warning) {
            if (altitude <= threshold.altitude && sinkRate >= threshold.sinkRate) {
                triggered = true;
                break;
            }
        }
        
        this.gpws.modes.mode1.triggered = triggered;
        
        if (triggered) {
            this.triggerGPWSAlert('PULL_UP', AlertLevel.WARNING);
        }
    }

    private updateMode2Warning(altitude: number, closureRate: number): void {
        // Simplified terrain closure rate calculation
        const terrainClosureRate = Math.max(0, closureRate - 500); // Assume 500 fpm terrain rise
        
        this.gpws.modes.mode2.closureRate = terrainClosureRate;
        this.gpws.modes.mode2.altitude = altitude;
        
        let triggered = false;
        
        for (const threshold of this.gpws.modes.mode2.thresholds.warning) {
            if (altitude <= threshold.altitude && terrainClosureRate >= threshold.closureRate) {
                triggered = true;
                break;
            }
        }
        
        this.gpws.modes.mode2.triggered = triggered;
        
        if (triggered) {
            this.triggerGPWSAlert('TERRAIN', AlertLevel.WARNING);
        }
    }

    private updateMode3Warning(altitude: number): void {
        // Track maximum altitude after takeoff
        const onGround = this.aircraftState.onGround || false;
        
        if (onGround) {
            this.gpws.modes.mode3.maxAltitude = 0;
            this.gpws.modes.mode3.altitudeLoss = 0;
        } else {
            if (altitude > this.gpws.modes.mode3.maxAltitude) {
                this.gpws.modes.mode3.maxAltitude = altitude;
            }
            
            this.gpws.modes.mode3.altitudeLoss = this.gpws.modes.mode3.maxAltitude - altitude;
            
            const triggered = this.gpws.modes.mode3.altitudeLoss > this.gpws.modes.mode3.thresholds.warning &&
                            this.gpws.modes.mode3.maxAltitude < 700; // Only below 700 ft
            
            this.gpws.modes.mode3.triggered = triggered;
            
            if (triggered) {
                this.triggerGPWSAlert('DONT_SINK', AlertLevel.WARNING);
            }
        }
    }

    private updateMode4Warning(altitude: number, airspeed: number): void {
        // Determine aircraft configuration
        let config: 'CLEAN' | 'GEAR' | 'FLAPS' | 'LANDING' = 'CLEAN';
        
        const gearDown = this.getGearPosition() !== 'UP';
        const flapsExtended = this.getFlapsPosition() > 0;
        const landingFlaps = this.getFlapsPosition() >= 30;
        
        if (gearDown && landingFlaps) {
            config = 'LANDING';
        } else if (flapsExtended) {
            config = 'FLAPS';
        } else if (gearDown) {
            config = 'GEAR';
        }
        
        this.gpws.modes.mode4.configuration = config;
        this.gpws.modes.mode4.airspeed = airspeed;
        this.gpws.modes.mode4.terrainClearance = altitude;
        
        let triggered = false;
        const thresholds = this.gpws.modes.mode4.thresholds[config];
        
        for (const threshold of thresholds) {
            if (airspeed >= threshold.speed && altitude <= threshold.clearance) {
                triggered = true;
                break;
            }
        }
        
        this.gpws.modes.mode4.triggered = triggered;
        
        if (triggered) {
            this.triggerGPWSAlert('TOO_LOW_TERRAIN', AlertLevel.WARNING);
        }
    }

    private updateMode5Warning(altitude: number): void {
        // Get glideslope deviation from avionics system
        const avionics = this.systemStates.get('avionics');
        const glideslopeDeviation = avionics?.radio?.ils?.glideslope?.deviation || 0;
        
        this.gpws.modes.mode5.glideslopeDeviation = Math.abs(glideslopeDeviation);
        this.gpws.modes.mode5.altitude = altitude;
        
        let triggered = false;
        
        // Only active on approach with valid glideslope
        const glideslopeValid = avionics?.radio?.ils?.glideslope?.flag === false;
        
        if (glideslopeValid && glideslopeDeviation < 0) { // Below glideslope
            for (const threshold of this.gpws.modes.mode5.thresholds.warning) {
                if (altitude <= threshold.altitude && Math.abs(glideslopeDeviation) >= threshold.deviation) {
                    triggered = true;
                    break;
                }
            }
        }
        
        this.gpws.modes.mode5.triggered = triggered;
        
        if (triggered) {
            this.triggerGPWSAlert('GLIDESLOPE', AlertLevel.CAUTION);
        }
    }

    private updateMode6Callouts(altitude: number): void {
        if (!this.gpws.callouts.enabled) return;
        
        // Altitude callouts
        for (const calloutAlt of this.gpws.modes.mode6.callouts.altitude.values) {
            if (altitude <= calloutAlt && this.gpws.modes.mode6.callouts.altitude.last > calloutAlt) {
                this.triggerCallout(calloutAlt.toString());
                this.gpws.modes.mode6.callouts.altitude.last = calloutAlt;
                break;
            }
        }
        
        // Bank angle callout
        const bankAngle = Math.abs((this.aircraftState.roll || 0) * 180 / Math.PI);
        if (bankAngle > this.gpws.modes.mode6.callouts.bank.threshold && 
            altitude < this.gpws.modes.mode6.callouts.bank.altitude) {
            this.triggerCallout('BANK_ANGLE');
        }
        
        // Decision height callout
        const decisionHeight = 200; // Example decision height
        if (this.gpws.modes.mode6.callouts.minimums && altitude <= decisionHeight) {
            this.triggerCallout('MINIMUMS');
        }
    }

    private updateWindshearDetection(deltaTime: number): void {
        // Simplified windshear detection
        const airspeed = this.aircraftState.indicatedAirspeed || 0;
        const previousAirspeed = this.aircraftState.previousAirspeed || airspeed;
        const verticalSpeed = this.aircraftState.verticalSpeed || 0;
        
        const airspeedChange = Math.abs(airspeed - previousAirspeed) / (deltaTime / 1000);
        const fFactor = airspeedChange / 9.81; // Simplified f-factor
        
        this.gpws.modes.windshear.parameters.windspeedChange = airspeedChange;
        this.gpws.modes.windshear.parameters.verticalWindspeed = Math.abs(verticalSpeed);
        this.gpws.modes.windshear.parameters.f = fFactor;
        
        const windshearDetected = fFactor > 0.15 || airspeedChange > 15;
        
        if (windshearDetected) {
            this.gpws.modes.windshear.detected = true;
            this.gpws.modes.windshear.severity = fFactor > 0.25 ? 'WARNING' : 'CAUTION';
            this.gpws.modes.windshear.guidance.message = 'WINDSHEAR ESCAPE';
            this.gpws.modes.windshear.guidance.pitch = 15;
            this.gpws.modes.windshear.guidance.power = 'MAXIMUM';
            
            this.triggerGPWSAlert('WINDSHEAR', AlertLevel.WARNING);
        } else {
            this.gpws.modes.windshear.detected = false;
        }
    }

    private updateStallWarning(deltaTime: number): void {
        if (!this.stallWarning.enabled) return;

        const angleOfAttack = this.aircraftState.angleOfAttack * 180 / Math.PI || 0;
        const flaps = this.getFlapsPosition();
        const icingDetected = this.systemStates.get('environmental')?.antiIce?.detection?.icing?.detected || false;

        // Update alpha vanes
        this.stallWarning.alphaVane.left.angle = angleOfAttack + (Math.random() - 0.5) * 0.5;
        this.stallWarning.alphaVane.right.angle = angleOfAttack + (Math.random() - 0.5) * 0.5;

        // Determine stall threshold
        let threshold = this.stallWarning.stickShaker.threshold.clean;
        if (flaps > 0 && flaps <= this.stallWarning.stickShaker.threshold.flaps.length) {
            threshold = this.stallWarning.stickShaker.threshold.flaps[Math.floor(flaps / 10)];
        }
        if (icingDetected) {
            threshold += this.stallWarning.stickShaker.threshold.icing;
        }

        // Stick shaker activation
        if (angleOfAttack >= threshold) {
            this.stallWarning.stickShaker.active = true;
            this.stallWarning.stickShaker.intensity = Math.min(1, (angleOfAttack - threshold) / 2);
        } else {
            this.stallWarning.stickShaker.active = false;
            this.stallWarning.stickShaker.intensity = 0;
        }

        // Stick pusher activation
        if (this.stallWarning.stickPusher.enabled && angleOfAttack >= this.stallWarning.stickPusher.threshold) {
            this.stallWarning.stickPusher.active = true;
            this.stallWarning.stickPusher.force = 50; // pounds
        } else {
            this.stallWarning.stickPusher.active = false;
            this.stallWarning.stickPusher.force = 0;
        }

        // Update speed tape bands
        const stallSpeed = this.aircraftState.stallSpeed || 100;
        this.stallWarning.speedTape.redBand.bottom = 0;
        this.stallWarning.speedTape.redBand.top = stallSpeed;
        this.stallWarning.speedTape.amberBand.bottom = stallSpeed;
        this.stallWarning.speedTape.amberBand.top = stallSpeed * 1.3;
    }

    private updateConfigurationWarning(deltaTime: number): void {
        if (!this.configWarning.enabled) return;

        const onGround = this.aircraftState.onGround || false;
        const altitude = this.aircraftState.altitudeAGL || 0;
        const airspeed = this.aircraftState.indicatedAirspeed || 0;

        // Check inhibit conditions
        const inhibited = (onGround && this.configWarning.inhibits.ground) ||
                         altitude > this.configWarning.inhibits.altitude ||
                         airspeed > this.configWarning.inhibits.airspeed;

        if (inhibited) return;

        // Update configuration states
        this.updateTakeoffConfiguration();
        this.updateApproachConfiguration();
        this.updateLandingConfiguration();
    }

    private updateTakeoffConfiguration(): void {
        const flaps = this.getFlapsPosition();
        const spoilers = this.getSpoilersPosition();
        const elevatorTrim = this.getElevatorTrim();
        const parkingBrake = this.getParkingBrakeStatus();

        // Update checks
        this.configWarning.phases.takeoff.checks.flaps.current = flaps;
        this.configWarning.phases.takeoff.checks.flaps.valid = 
            this.configWarning.phases.takeoff.checks.flaps.required.includes(flaps);

        this.configWarning.phases.takeoff.checks.spoilers.current = spoilers;
        this.configWarning.phases.takeoff.checks.spoilers.valid = spoilers < 0.1;

        this.configWarning.phases.takeoff.checks.trim.elevator.current = elevatorTrim;
        this.configWarning.phases.takeoff.checks.trim.elevator.valid = 
            elevatorTrim >= this.configWarning.phases.takeoff.checks.trim.elevator.min &&
            elevatorTrim <= this.configWarning.phases.takeoff.checks.trim.elevator.max;

        this.configWarning.phases.takeoff.checks.parkingBrake.current = parkingBrake;
        this.configWarning.phases.takeoff.checks.parkingBrake.valid = !parkingBrake;

        // Update warnings
        this.configWarning.phases.takeoff.warnings.flapsSpoilers = 
            !this.configWarning.phases.takeoff.checks.flaps.valid ||
            !this.configWarning.phases.takeoff.checks.spoilers.valid;

        this.configWarning.phases.takeoff.warnings.trimNotSet = 
            !this.configWarning.phases.takeoff.checks.trim.elevator.valid;

        this.configWarning.phases.takeoff.warnings.parkingBrakeSet = 
            !this.configWarning.phases.takeoff.checks.parkingBrake.valid;
    }

    private updateApproachConfiguration(): void {
        const gearPos = this.getGearPosition();
        const flaps = this.getFlapsPosition();
        const speedbrakes = this.getSpoilersPosition();

        this.configWarning.phases.approach.checks.gear.nose = gearPos;
        this.configWarning.phases.approach.checks.gear.left = gearPos;
        this.configWarning.phases.approach.checks.gear.right = gearPos;
        this.configWarning.phases.approach.checks.gear.valid = gearPos === 'DOWN';

        this.configWarning.phases.approach.checks.flaps.current = flaps;
        this.configWarning.phases.approach.checks.flaps.valid = 
            flaps >= this.configWarning.phases.approach.checks.flaps.minimum;

        this.configWarning.phases.approach.checks.speedbrake.current = speedbrakes;
        this.configWarning.phases.approach.checks.speedbrake.valid = speedbrakes < 0.1;

        // Update warnings
        this.configWarning.phases.approach.warnings.gearNotDown = 
            !this.configWarning.phases.approach.checks.gear.valid;

        this.configWarning.phases.approach.warnings.flapsNotSet = 
            !this.configWarning.phases.approach.checks.flaps.valid;

        this.configWarning.phases.approach.warnings.speedbrakeExtended = 
            !this.configWarning.phases.approach.checks.speedbrake.valid;
    }

    private updateLandingConfiguration(): void {
        const gearPos = this.getGearPosition();
        const flaps = this.getFlapsPosition();
        const spoilersArmed = this.getSpoilersArmed();

        this.configWarning.phases.landing.checks.gear.positions.nose = gearPos;
        this.configWarning.phases.landing.checks.gear.positions.left = gearPos;
        this.configWarning.phases.landing.checks.gear.positions.right = gearPos;
        this.configWarning.phases.landing.checks.gear.valid = gearPos === 'DOWN';

        this.configWarning.phases.landing.checks.flaps.current = flaps;
        this.configWarning.phases.landing.checks.flaps.valid = 
            this.configWarning.phases.landing.checks.flaps.required.includes(flaps);

        this.configWarning.phases.landing.checks.spoilers.armed = spoilersArmed;

        // Update warnings
        this.configWarning.phases.landing.warnings.gearNotDownLocked = 
            !this.configWarning.phases.landing.checks.gear.valid;

        this.configWarning.phases.landing.warnings.flapsNotLanding = 
            !this.configWarning.phases.landing.checks.flaps.valid;

        this.configWarning.phases.landing.warnings.spoilersNotArmed = 
            !this.configWarning.phases.landing.checks.spoilers.armed;
    }

    private updatePressureWarning(deltaTime: number): void {
        const envSystem = this.systemStates.get('environmental');
        if (!envSystem) return;

        this.pressureWarning.altitude.current = envSystem.pressurization?.cabinAltitude || 0;
        this.pressureWarning.differential.current = envSystem.pressurization?.diffPressure || 0;
        this.pressureWarning.rate.current = envSystem.pressurization?.cabinVS || 0;

        // Update warnings
        this.pressureWarning.warnings.altitudeHigh = 
            this.pressureWarning.altitude.current > this.pressureWarning.altitude.warning;

        this.pressureWarning.warnings.differentialHigh = 
            this.pressureWarning.differential.current > this.pressureWarning.differential.warning;

        this.pressureWarning.warnings.rateHigh = 
            Math.abs(this.pressureWarning.rate.current) > this.pressureWarning.rate.warning;
    }

    private updateFireWarning(deltaTime: number): void {
        this.fireWarning.zones.forEach(zone => {
            // Update fire detection loops
            zone.loops.forEach(loop => {
                // Simulate temperature based on engine conditions
                if (zone.name.startsWith('ENG_')) {
                    const engineNum = parseInt(zone.name.split('_')[1]);
                    const engine = this.aircraftState.engines?.[engineNum - 1];
                    
                    if (engine) {
                        const baseTemp = engine.egt || 400;
                        loop.temperature = baseTemp + (Math.random() - 0.5) * 50;
                        
                        // Fire detection based on temperature
                        if (loop.temperature > 700) {
                            loop.triggered = true;
                        } else if (loop.temperature < 650) {
                            loop.triggered = false;
                        }
                    }
                } else {
                    // Ambient temperature for other zones
                    loop.temperature = 20 + (Math.random() - 0.5) * 10;
                    loop.triggered = loop.temperature > 80; // High temp for cargo/APU
                }
            });

            // Zone fire logic (requires 2 loops or 1 loop for 5 seconds)
            const triggeredLoops = zone.loops.filter(loop => loop.triggered && !loop.failed);
            zone.fire = triggeredLoops.length >= 2 || 
                       (triggeredLoops.length === 1 && Math.random() > 0.99); // Simplified timer

            zone.overheat = zone.loops.some(loop => loop.temperature > 500 && loop.temperature < 700);
            zone.fault = zone.loops.some(loop => loop.failed);
        });
    }

    private processAlerts(): void {
        this.alerts = [];

        // Collect all active warnings and cautions
        this.masterWarning.annunciators.forEach(annunciator => {
            if (annunciator.active) {
                this.alerts.push({
                    id: annunciator.id,
                    level: annunciator.level,
                    message: annunciator.message,
                    system: annunciator.system,
                    timestamp: Date.now(),
                    acknowledged: annunciator.acknowledged,
                    inhibited: annunciator.inhibited,
                    active: annunciator.active,
                    flashing: annunciator.flashing && !annunciator.acknowledged
                });
            }
        });

        // Add GPWS alerts
        if (this.gpws.modes.mode1.triggered) {
            this.alerts.push({
                id: 'GPWS_PULL_UP',
                level: AlertLevel.WARNING,
                message: 'PULL UP',
                system: 'GPWS',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: true
            });
        }

        // Sort alerts by priority
        this.alerts.sort((a, b) => {
            const priorityA = this.getAlertPriority(a.level);
            const priorityB = this.getAlertPriority(b.level);
            return priorityA - priorityB;
        });
    }

    // Utility methods
    private getAlertPriority(level: AlertLevel): number {
        switch (level) {
            case AlertLevel.EMERGENCY: return 1;
            case AlertLevel.WARNING: return 2;
            case AlertLevel.CAUTION: return 3;
            case AlertLevel.ADVISORY: return 4;
            default: return 5;
        }
    }

    private getGearPosition(): 'UP' | 'DOWN' | 'TRANSIT' {
        const hydraulics = this.systemStates.get('hydraulic');
        if (hydraulics?.actuators) {
            const gearActuator = hydraulics.actuators.get('GEAR NOSE');
            if (gearActuator) {
                if (gearActuator.position > 0.9) return 'DOWN';
                if (gearActuator.position < 0.1) return 'UP';
                return 'TRANSIT';
            }
        }
        return 'UP';
    }

    private getFlapsPosition(): number {
        const hydraulics = this.systemStates.get('hydraulic');
        if (hydraulics?.actuators) {
            const flapActuator = hydraulics.actuators.get('FLAP L');
            return flapActuator ? Math.round(flapActuator.position * 40) : 0;
        }
        return 0;
    }

    private getSpoilersPosition(): number {
        const hydraulics = this.systemStates.get('hydraulic');
        if (hydraulics?.actuators) {
            const spoilerActuator = hydraulics.actuators.get('SPOILER 1');
            return spoilerActuator ? spoilerActuator.position : 0;
        }
        return 0;
    }

    private getSpoilersArmed(): boolean {
        // Simplified - in real system this would check actual spoiler arm switch
        return this.getSpoilersPosition() < 0.1;
    }

    private getElevatorTrim(): number {
        return this.aircraftState.elevatorTrim || 0;
    }

    private getParkingBrakeStatus(): boolean {
        return this.aircraftState.parkingBrake || false;
    }

    private triggerGPWSAlert(type: string, level: AlertLevel): void {
        // Would trigger audio alert and visual display
        console.log(`GPWS Alert: ${type} - ${level}`);
    }

    private triggerCallout(message: string): void {
        // Would trigger audio callout
        console.log(`Callout: ${message}`);
    }

    /**
     * Control methods
     */
    public acknowledgeWarning(): void {
        this.masterWarning.masterWarning.acknowledged = true;
    }

    public acknowledgeCaution(): void {
        this.masterWarning.masterCaution.acknowledged = true;
    }

    public recallWarnings(): void {
        this.masterWarning.recall.active = true;
        this.masterWarning.recall.messages = [...this.alerts];
        this.masterWarning.recall.currentIndex = 0;
    }

    public testWarningSystem(): void {
        this.masterWarning.masterWarning.test = true;
        this.masterWarning.masterCaution.test = true;
        
        // Test all annunciators
        this.masterWarning.annunciators.forEach(annunciator => {
            annunciator.active = true;
            annunciator.flashing = true;
        });
        
        // Test will automatically reset after 5 seconds (simplified)
        setTimeout(() => {
            this.resetWarningTest();
        }, 5000);
    }

    private resetWarningTest(): void {
        this.masterWarning.masterWarning.test = false;
        this.masterWarning.masterCaution.test = false;
        
        this.masterWarning.annunciators.forEach(annunciator => {
            if (annunciator.active && !this.isAnnunciatorTriggered(annunciator)) {
                annunciator.active = false;
                annunciator.flashing = false;
            }
        });
    }

    private isAnnunciatorTriggered(annunciator: Annunciator): boolean {
        // Check if annunciator should actually be active based on system state
        // This would need to be implemented for each specific annunciator
        return false; // Simplified
    }

    public setGPWSMode(mode: 'GPWS' | 'EGPWS'): void {
        this.gpws.mode = mode;
    }

    public setGPWSInhibit(type: string, enabled: boolean): void {
        switch (type) {
            case 'GEAR':
                this.gpws.inhibits.gearOverride = enabled;
                break;
            case 'FLAP':
                this.gpws.inhibits.flapOverride = enabled;
                break;
            case 'TERRAIN':
                this.gpws.inhibits.terrain = enabled;
                break;
        }
    }

    public enableStickShaker(enabled: boolean): void {
        this.stallWarning.enabled = enabled;
    }

    public enableStickPusher(enabled: boolean): void {
        this.stallWarning.stickPusher.enabled = enabled;
    }

    public testStickPusher(): void {
        this.stallWarning.stickPusher.test = true;
        this.stallWarning.stickPusher.active = true;
        this.stallWarning.stickPusher.force = 25; // Test force
        
        setTimeout(() => {
            this.stallWarning.stickPusher.test = false;
            this.stallWarning.stickPusher.active = false;
            this.stallWarning.stickPusher.force = 0;
        }, 2000);
    }

    /**
     * Get display data and status
     */
    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public getMasterWarningStatus(): { warning: boolean; caution: boolean } {
        return {
            warning: this.masterWarning.masterWarning.active,
            caution: this.masterWarning.masterCaution.active
        };
    }

    public getGPWSStatus(): any {
        return {
            status: this.gpws.status,
            mode: this.gpws.mode,
            radioAltitude: this.gpws.radioAltimeter.altitude,
            modesTriggered: {
                mode1: this.gpws.modes.mode1.triggered,
                mode2: this.gpws.modes.mode2.triggered,
                mode3: this.gpws.modes.mode3.triggered,
                mode4: this.gpws.modes.mode4.triggered,
                mode5: this.gpws.modes.mode5.triggered
            },
            windshear: this.gpws.modes.windshear.detected,
            terrain: this.gpws.modes.terrain.alerts
        };
    }

    public getStallWarningStatus(): any {
        return {
            stickShaker: {
                active: this.stallWarning.stickShaker.active,
                intensity: this.stallWarning.stickShaker.intensity
            },
            stickPusher: {
                active: this.stallWarning.stickPusher.active,
                force: this.stallWarning.stickPusher.force
            },
            alphaVanes: {
                left: this.stallWarning.alphaVane.left.angle,
                right: this.stallWarning.alphaVane.right.angle
            },
            speedBands: this.stallWarning.speedTape
        };
    }

    public getConfigurationStatus(): ConfigurationData {
        return {
            gear: {
                nose: this.configWarning.phases.landing.checks.gear.positions.nose,
                left: this.configWarning.phases.landing.checks.gear.positions.left,
                right: this.configWarning.phases.landing.checks.gear.positions.right,
                doors: this.configWarning.phases.landing.checks.gear.doors
            },
            flaps: {
                position: this.configWarning.phases.landing.checks.flaps.current,
                selected: this.configWarning.phases.landing.checks.flaps.current,
                asymmetry: false,
                transit: false
            },
            slats: {
                position: 0,
                asymmetry: false,
                transit: false
            },
            spoilers: {
                position: this.configWarning.phases.landing.checks.spoilers.current * 100,
                armed: this.configWarning.phases.landing.checks.spoilers.armed,
                deployed: this.configWarning.phases.landing.checks.spoilers.current > 0.1,
                speedbrakes: this.configWarning.phases.landing.checks.spoilers.current * 100
            },
            trim: {
                elevator: this.configWarning.phases.takeoff.checks.trim.elevator.current,
                rudder: this.configWarning.phases.takeoff.checks.trim.rudder.current,
                aileron: this.configWarning.phases.takeoff.checks.trim.aileron.current
            },
            doors: {
                passenger: [false, false, false, false],
                cargo: [false, false],
                service: [false],
                emergency: [false, false, false, false]
            }
        };
    }

    public isSystemHealthy(): boolean {
        return this.alerts.filter(alert => 
            alert.level === AlertLevel.WARNING || alert.level === AlertLevel.EMERGENCY
        ).length === 0;
    }
}