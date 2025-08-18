import { Vector3 } from '../../core/math/Vector3';
import { 
    SystemStatus, 
    AlertLevel, 
    PrimaryFlightData,
    NavigationDisplayData,
    WaypointData,
    TrafficTarget,
    TcasResolution,
    WeatherRadarData,
    VorData,
    IlsData,
    GpsData,
    AvionicsConfig,
    AlertData 
} from './InstrumentData';

/**
 * Comprehensive avionics system simulation
 * Models PFD, ND, navigation, autopilot, and flight management
 */

export interface FlightManagementSystem {
    status: SystemStatus;
    database: {
        cycle: string;           // AIRAC cycle
        effective: Date;         // Effective date
        expires: Date;           // Expiration date
    };
    flightPlan: {
        origin: string;          // Departure airport
        destination: string;     // Arrival airport
        alternate: string;       // Alternate airport
        waypoints: WaypointData[];
        activeWaypoint: number;  // Index of active waypoint
        legs: FlightPlanLeg[];
    };
    performance: {
        cruiseAltitude: number;  // Planned cruise altitude
        cruiseSpeed: number;     // Planned cruise speed
        stepClimbs: ClimbPoint[];
        fuelPlanning: boolean;
    };
    vnav: VnavData;
    lnav: LnavData;
    status: {
        initialized: boolean;
        aligned: boolean;
        navigating: boolean;
    };
}

export interface FlightPlanLeg {
    type: 'TF' | 'DF' | 'CF' | 'IF' | 'RF' | 'AF' | 'VA' | 'VI' | 'VR' | 'FM' | 'VM';
    waypoint: WaypointData;
    course: number;              // degrees
    distance: number;            // nautical miles
    altitude: {
        at: number;              // AT altitude constraint
        above: number;           // ABOVE altitude constraint
        below: number;           // BELOW altitude constraint
    };
    speed: {
        at: number;              // AT speed constraint
        above: number;           // ABOVE speed constraint
        below: number;           // BELOW speed constraint
    };
}

export interface ClimbPoint {
    waypoint: string;
    altitude: number;
    speed: number;
}

export interface VnavData {
    armed: boolean;
    active: boolean;
    mode: 'CLIMB' | 'CRUISE' | 'DESCENT' | 'APPROACH';
    targetAltitude: number;
    targetSpeed: number;
    pathAngle: number;           // degrees
    deviation: number;           // feet
    timeToWaypoint: number;      // seconds
    requiredVS: number;          // feet per minute
}

export interface LnavData {
    armed: boolean;
    active: boolean;
    mode: 'NAV' | 'HDG' | 'LOC' | 'APPR';
    course: number;              // degrees
    crossTrackError: number;     // nautical miles
    courseDeviation: number;     // degrees
    bearing: number;             // degrees to active waypoint
    distance: number;            // nautical miles to active waypoint
}

export interface AutopilotSystem {
    master: boolean;             // Master autopilot switch
    channels: {
        a: boolean;              // Channel A engaged
        b: boolean;              // Channel B engaged
        c: boolean;              // Channel C engaged (if equipped)
    };
    modes: {
        lateral: {
            active: string;      // 'HDG', 'NAV', 'LOC', 'LNAV', 'ROLLOUT'
            armed: string[];     // Armed modes
        };
        vertical: {
            active: string;      // 'ALT', 'VS', 'ILS', 'VNAV', 'FLARE'
            armed: string[];     // Armed modes
        };
        speed: {
            active: string;      // 'SPD', 'MACH', 'THROT'
            armed: string[];     // Armed modes
        };
    };
    targets: {
        heading: number;         // Selected heading
        altitude: number;        // Selected altitude
        verticalSpeed: number;   // Selected vertical speed
        airspeed: number;        // Selected airspeed
        mach: number;            // Selected Mach number
    };
    limits: {
        maxBank: number;         // Maximum bank angle
        maxClimbRate: number;    // Maximum climb rate
        maxDescentRate: number;  // Maximum descent rate
    };
    status: {
        engaged: boolean;
        healthy: boolean;
        trimInMotion: boolean;
        warnings: string[];
    };
}

export interface FlightDirector {
    power: boolean;              // FD power switch
    active: boolean;             // FD bars displayed
    cues: {
        pitch: number;           // Pitch command bar position
        roll: number;            // Roll command bar position
    };
    modes: {
        lateral: string;         // Current lateral mode
        vertical: string;        // Current vertical mode
    };
    gains: {
        pitch: number;           // Pitch sensitivity
        roll: number;            // Roll sensitivity
    };
}

export interface RadioNavigationSystem {
    vor1: VorReceiver;
    vor2: VorReceiver;
    ils: IlsReceiver;
    gps: GpsReceiver;
    adf1?: AdfReceiver;
    adf2?: AdfReceiver;
    transponder: Transponder;
    tcas: TcasSystem;
    radios: RadioSystem;
}

export interface VorReceiver {
    frequency: number;           // MHz
    identifier: string;          // 3-letter ID
    course: number;              // Selected course
    radial: number;              // Current radial
    deviation: number;           // CDI deviation (-10 to +10 dots)
    distance: number;            // DME distance (if equipped)
    fromFlag: boolean;           // FROM flag
    toFlag: boolean;             // TO flag
    navFlag: boolean;            // NAV flag (signal invalid)
    power: boolean;
    volume: number;              // Audio volume
    ident: boolean;              // Identifier enabled
}

export interface IlsReceiver {
    frequency: number;           // MHz
    identifier: string;          // 4-letter ID
    runway: string;              // Runway identifier
    localizer: {
        course: number;          // Localizer course
        deviation: number;       // Localizer deviation
        flag: boolean;           // LOC flag
    };
    glideslope: {
        angle: number;           // Glideslope angle
        deviation: number;       // Glideslope deviation
        flag: boolean;           // GS flag
    };
    dme: {
        distance: number;        // DME distance
        flag: boolean;           // DME flag
    };
    power: boolean;
    volume: number;
    ident: boolean;
}

export interface GpsReceiver {
    status: 'ACQUIRING' | 'NAVIGATING' | 'APPROACH' | 'FAILED';
    position: {
        latitude: number;        // degrees
        longitude: number;       // degrees
        altitude: number;        // feet MSL
    };
    accuracy: {
        horizontal: number;      // meters
        vertical: number;        // meters
        time: number;            // nanoseconds
    };
    satellites: {
        tracked: number;
        used: number;
        geometry: {
            pdop: number;        // Position DOP
            hdop: number;        // Horizontal DOP
            vdop: number;        // Vertical DOP
        };
    };
    waas: {
        available: boolean;
        corrections: boolean;
        approach: boolean;       // WAAS approach capability
    };
    raim: {
        available: boolean;
        prediction: boolean;
        faultDetection: boolean;
    };
    database: {
        type: 'JEPPESEN' | 'GARMIN' | 'HONEYWELL';
        version: string;
        effective: Date;
        expires: Date;
    };
}

export interface AdfReceiver {
    frequency: number;           // kHz
    bearing: number;             // Relative bearing
    signal: number;              // Signal strength (0-5)
    power: boolean;
    volume: number;
    ident: boolean;
}

export interface Transponder {
    mode: 'OFF' | 'STBY' | 'ON' | 'ALT';
    code: string;                // 4-digit squawk code
    ident: boolean;              // Ident active
    altitude: {
        reporting: boolean;      // Mode C altitude reporting
        source: 'ENCODER' | 'GPS' | 'BARO';
        value: number;           // Reported altitude
    };
    replies: number;             // Interrogation replies per second
    power: boolean;
}

export interface TcasSystem {
    status: SystemStatus;
    mode: 'OFF' | 'STBY' | 'TA' | 'TA_RA';
    version: 'TCAS_I' | 'TCAS_II' | 'ACAS';
    range: number;               // Display range (nm)
    targets: TrafficTarget[];
    resolution: TcasResolution | null;
    advisories: {
        traffic: TrafficAdvisory[];
        resolution: ResolutionAdvisory[];
    };
    inhibits: {
        altitude: number;        // Altitude for inhibits
        belowGround: boolean;
        climb: boolean;
        descent: boolean;
    };
}

export interface TrafficAdvisory {
    target: TrafficTarget;
    type: 'TRAFFIC' | 'PROXIMITY';
    bearing: number;
    distance: number;
    altitude: number;
    trend: number;               // Altitude trend
    closure: number;             // Closure rate
    timeToCA: number;            // Time to closest approach
}

export interface ResolutionAdvisory {
    type: 'CLIMB' | 'DESCEND' | 'INCREASE_CLIMB' | 'INCREASE_DESCENT' | 'CLEAR';
    strength: 'CORRECTIVE' | 'PREVENTIVE';
    rate: number;                // Required VS (fpm)
    maxAltitude?: number;        // Do not climb above
    minAltitude?: number;        // Do not descend below
    duration: number;            // Advisory duration
    target: TrafficTarget;
}

export interface RadioSystem {
    com1: ComRadio;
    com2: ComRadio;
    nav1: NavRadio;
    nav2: NavRadio;
}

export interface ComRadio {
    frequency: {
        active: number;          // Active frequency
        standby: number;         // Standby frequency
    };
    power: boolean;
    volume: number;              // Audio volume
    squelch: number;             // Squelch level
    test: boolean;               // Radio test
    emergency: boolean;          // Emergency frequency
}

export interface NavRadio {
    frequency: {
        active: number;          // Active frequency
        standby: number;         // Standby frequency
    };
    power: boolean;
    volume: number;
    ident: boolean;              // Identifier audio
    course: number;              // Selected course
}

export interface WeatherRadar {
    power: boolean;
    mode: 'WX' | 'TURB' | 'MAP' | 'TEST';
    range: number;               // nm
    tilt: number;                // degrees
    gain: {
        mode: 'AUTO' | 'MANUAL';
        value: number;           // 0-100%
    };
    returns: WeatherReturn[];
    calibration: {
        required: boolean;
        inProgress: boolean;
        valid: boolean;
    };
}

export interface WeatherReturn {
    bearing: number;             // degrees relative
    distance: number;            // nautical miles
    intensity: number;           // 0-5 scale
    type: 'PRECIP' | 'TURB' | 'WINDSHEAR';
    altitude: {
        top: number;             // feet
        base: number;            // feet
    };
}

export class AvionicsSystem {
    private config: AvionicsConfig;
    private fms: FlightManagementSystem;
    private autopilot: AutopilotSystem;
    private flightDirector: FlightDirector;
    private radioNav: RadioNavigationSystem;
    private weatherRadar: WeatherRadar;
    
    private alerts: AlertData[] = [];
    private aircraftState: any = {};
    private electricalPower: boolean = false;
    
    // Update rates (Hz)
    private readonly FMS_UPDATE_RATE = 10;
    private readonly AUTOPILOT_UPDATE_RATE = 50;
    private readonly NAVIGATION_UPDATE_RATE = 20;
    private readonly RADAR_UPDATE_RATE = 5;
    
    private updateCounters = {
        fms: 0,
        autopilot: 0,
        navigation: 0,
        radar: 0
    };

    constructor(config: AvionicsConfig) {
        this.config = config;
        this.initializeSystem();
    }

    /**
     * Initialize avionics system components
     */
    private initializeSystem(): void {
        this.initializeFMS();
        this.initializeAutopilot();
        this.initializeFlightDirector();
        this.initializeRadioNavigation();
        this.initializeWeatherRadar();
    }

    private initializeFMS(): void {
        this.fms = {
            status: SystemStatus.OFF,
            database: {
                cycle: '2025-01',
                effective: new Date('2025-01-04'),
                expires: new Date('2025-02-01')
            },
            flightPlan: {
                origin: '',
                destination: '',
                alternate: '',
                waypoints: [],
                activeWaypoint: 0,
                legs: []
            },
            performance: {
                cruiseAltitude: 37000,
                cruiseSpeed: 450,
                stepClimbs: [],
                fuelPlanning: true
            },
            vnav: {
                armed: false,
                active: false,
                mode: 'CLIMB',
                targetAltitude: 0,
                targetSpeed: 0,
                pathAngle: 0,
                deviation: 0,
                timeToWaypoint: 0,
                requiredVS: 0
            },
            lnav: {
                armed: false,
                active: false,
                mode: 'NAV',
                course: 0,
                crossTrackError: 0,
                courseDeviation: 0,
                bearing: 0,
                distance: 0
            },
            status: {
                initialized: false,
                aligned: false,
                navigating: false
            }
        };
    }

    private initializeAutopilot(): void {
        this.autopilot = {
            master: false,
            channels: {
                a: false,
                b: false,
                c: false
            },
            modes: {
                lateral: {
                    active: 'HDG',
                    armed: []
                },
                vertical: {
                    active: 'ALT',
                    armed: []
                },
                speed: {
                    active: 'SPD',
                    armed: []
                }
            },
            targets: {
                heading: 0,
                altitude: 0,
                verticalSpeed: 0,
                airspeed: 200,
                mach: 0.78
            },
            limits: {
                maxBank: 30,
                maxClimbRate: 4000,
                maxDescentRate: -6000
            },
            status: {
                engaged: false,
                healthy: true,
                trimInMotion: false,
                warnings: []
            }
        };
    }

    private initializeFlightDirector(): void {
        this.flightDirector = {
            power: false,
            active: false,
            cues: {
                pitch: 0,
                roll: 0
            },
            modes: {
                lateral: 'HDG',
                vertical: 'ALT'
            },
            gains: {
                pitch: 1.0,
                roll: 1.0
            }
        };
    }

    private initializeRadioNavigation(): void {
        this.radioNav = {
            vor1: {
                frequency: 108.0,
                identifier: '',
                course: 360,
                radial: 0,
                deviation: 0,
                distance: 0,
                fromFlag: false,
                toFlag: false,
                navFlag: true,
                power: false,
                volume: 0.5,
                ident: false
            },
            vor2: {
                frequency: 108.0,
                identifier: '',
                course: 360,
                radial: 0,
                deviation: 0,
                distance: 0,
                fromFlag: false,
                toFlag: false,
                navFlag: true,
                power: false,
                volume: 0.5,
                ident: false
            },
            ils: {
                frequency: 108.1,
                identifier: '',
                runway: '',
                localizer: {
                    course: 0,
                    deviation: 0,
                    flag: true
                },
                glideslope: {
                    angle: 3.0,
                    deviation: 0,
                    flag: true
                },
                dme: {
                    distance: 0,
                    flag: true
                },
                power: false,
                volume: 0.5,
                ident: false
            },
            gps: {
                status: 'ACQUIRING',
                position: {
                    latitude: 0,
                    longitude: 0,
                    altitude: 0
                },
                accuracy: {
                    horizontal: 100,
                    vertical: 150,
                    time: 100
                },
                satellites: {
                    tracked: 0,
                    used: 0,
                    geometry: {
                        pdop: 99.9,
                        hdop: 99.9,
                        vdop: 99.9
                    }
                },
                waas: {
                    available: false,
                    corrections: false,
                    approach: false
                },
                raim: {
                    available: false,
                    prediction: false,
                    faultDetection: false
                },
                database: {
                    type: 'JEPPESEN',
                    version: '2025-01',
                    effective: new Date('2025-01-04'),
                    expires: new Date('2025-02-01')
                }
            },
            transponder: {
                mode: 'STBY',
                code: '1200',
                ident: false,
                altitude: {
                    reporting: false,
                    source: 'ENCODER',
                    value: 0
                },
                replies: 0,
                power: false
            },
            tcas: {
                status: SystemStatus.OFF,
                mode: 'STBY',
                version: 'TCAS_II',
                range: 20,
                targets: [],
                resolution: null,
                advisories: {
                    traffic: [],
                    resolution: []
                },
                inhibits: {
                    altitude: 1000,
                    belowGround: true,
                    climb: false,
                    descent: false
                }
            },
            radios: {
                com1: {
                    frequency: {
                        active: 121.5,
                        standby: 121.5
                    },
                    power: false,
                    volume: 0.5,
                    squelch: 0.5,
                    test: false,
                    emergency: false
                },
                com2: {
                    frequency: {
                        active: 121.5,
                        standby: 121.5
                    },
                    power: false,
                    volume: 0.5,
                    squelch: 0.5,
                    test: false,
                    emergency: false
                },
                nav1: {
                    frequency: {
                        active: 108.0,
                        standby: 108.0
                    },
                    power: false,
                    volume: 0.5,
                    ident: false,
                    course: 360
                },
                nav2: {
                    frequency: {
                        active: 108.0,
                        standby: 108.0
                    },
                    power: false,
                    volume: 0.5,
                    ident: false,
                    course: 360
                }
            }
        };
    }

    private initializeWeatherRadar(): void {
        this.weatherRadar = {
            power: false,
            mode: 'WX',
            range: 160,
            tilt: 0,
            gain: {
                mode: 'AUTO',
                value: 50
            },
            returns: [],
            calibration: {
                required: false,
                inProgress: false,
                valid: true
            }
        };
    }

    /**
     * Update avionics system
     */
    public update(deltaTime: number, aircraftState: any, electricalStatus: any): void {
        this.updateInputs(aircraftState, electricalStatus);
        
        // Update systems at their respective rates
        this.updateCounters.fms += deltaTime;
        if (this.updateCounters.fms >= 1000 / this.FMS_UPDATE_RATE) {
            this.updateFMS(this.updateCounters.fms);
            this.updateCounters.fms = 0;
        }

        this.updateCounters.autopilot += deltaTime;
        if (this.updateCounters.autopilot >= 1000 / this.AUTOPILOT_UPDATE_RATE) {
            this.updateAutopilot(this.updateCounters.autopilot);
            this.updateFlightDirector(this.updateCounters.autopilot);
            this.updateCounters.autopilot = 0;
        }

        this.updateCounters.navigation += deltaTime;
        if (this.updateCounters.navigation >= 1000 / this.NAVIGATION_UPDATE_RATE) {
            this.updateRadioNavigation(this.updateCounters.navigation);
            this.updateCounters.navigation = 0;
        }

        this.updateCounters.radar += deltaTime;
        if (this.updateCounters.radar >= 1000 / this.RADAR_UPDATE_RATE) {
            this.updateWeatherRadar(this.updateCounters.radar);
            this.updateCounters.radar = 0;
        }

        this.checkAlerts();
    }

    private updateInputs(aircraftState: any, electricalStatus: any): void {
        this.aircraftState = aircraftState;
        this.electricalPower = electricalStatus.buses?.some((bus: any) => 
            bus.name.includes('ESS') && bus.powered) || false;
    }

    private updateFMS(deltaTime: number): void {
        if (!this.electricalPower) {
            this.fms.status = SystemStatus.OFF;
            return;
        }

        this.fms.status = SystemStatus.ON;

        // Initialize FMS on first power-up
        if (!this.fms.status.initialized) {
            this.fms.status.initialized = true;
            this.fms.status.aligned = true; // Simplified - real FMS requires alignment
        }

        // Update LNAV
        if (this.fms.lnav.active && this.fms.flightPlan.waypoints.length > 0) {
            this.updateLNAV();
        }

        // Update VNAV
        if (this.fms.vnav.active) {
            this.updateVNAV();
        }

        // Update flight plan execution
        this.updateFlightPlanExecution();
    }

    private updateLNAV(): void {
        const activeWaypoint = this.fms.flightPlan.waypoints[this.fms.flightPlan.activeWaypoint];
        if (!activeWaypoint) return;

        // Calculate bearing and distance to active waypoint
        const bearing = this.calculateBearing(
            this.aircraftState.position,
            activeWaypoint.position
        );
        const distance = this.calculateDistance(
            this.aircraftState.position,
            activeWaypoint.position
        );

        this.fms.lnav.bearing = bearing;
        this.fms.lnav.distance = distance;

        // Calculate cross-track error (simplified)
        const courseToBearing = this.calculateCourseToBearing(activeWaypoint);
        this.fms.lnav.course = courseToBearing;
        this.fms.lnav.courseDeviation = this.normalizeAngle(bearing - courseToBearing);
        this.fms.lnav.crossTrackError = distance * Math.sin(this.fms.lnav.courseDeviation * Math.PI / 180);

        // Auto-sequence waypoints
        if (distance < 0.1) { // Within 0.1 nm
            this.sequenceNextWaypoint();
        }
    }

    private updateVNAV(): void {
        const activeWaypoint = this.fms.flightPlan.waypoints[this.fms.flightPlan.activeWaypoint];
        if (!activeWaypoint) return;

        const currentAltitude = this.aircraftState.altitude || 0;
        const targetAltitude = activeWaypoint.altitude || this.fms.performance.cruiseAltitude;
        const distance = this.fms.lnav.distance;
        const groundSpeed = this.aircraftState.groundSpeed || 400; // knots

        // Calculate required vertical speed
        if (distance > 0 && groundSpeed > 0) {
            const timeToWaypoint = (distance / groundSpeed) * 3600; // seconds
            this.fms.vnav.timeToWaypoint = timeToWaypoint;
            
            const altitudeDifference = targetAltitude - currentAltitude;
            this.fms.vnav.requiredVS = timeToWaypoint > 0 ? 
                (altitudeDifference / timeToWaypoint) * 60 : 0; // fpm

            // Calculate path deviation
            const optimalAltitude = currentAltitude + 
                (altitudeDifference * (1 - distance / this.fms.lnav.distance));
            this.fms.vnav.deviation = currentAltitude - optimalAltitude;
        }

        this.fms.vnav.targetAltitude = targetAltitude;
    }

    private updateFlightPlanExecution(): void {
        // Simplified flight plan execution logic
        if (this.fms.flightPlan.waypoints.length === 0) return;

        // Check if we need to sequence to the next waypoint
        const activeWaypoint = this.fms.flightPlan.waypoints[this.fms.flightPlan.activeWaypoint];
        if (activeWaypoint && this.fms.lnav.distance < 0.1) {
            this.sequenceNextWaypoint();
        }
    }

    private sequenceNextWaypoint(): void {
        if (this.fms.flightPlan.activeWaypoint < this.fms.flightPlan.waypoints.length - 1) {
            this.fms.flightPlan.activeWaypoint++;
        }
    }

    private updateAutopilot(deltaTime: number): void {
        if (!this.electricalPower) {
            this.autopilot.status.engaged = false;
            return;
        }

        if (!this.autopilot.master) {
            this.autopilot.status.engaged = false;
            return;
        }

        this.autopilot.status.engaged = this.autopilot.channels.a || 
                                       this.autopilot.channels.b || 
                                       this.autopilot.channels.c;

        if (this.autopilot.status.engaged) {
            this.executeAutopilotModes();
            this.checkAutopilotLimits();
        }
    }

    private executeAutopilotModes(): void {
        // Lateral mode execution
        switch (this.autopilot.modes.lateral.active) {
            case 'HDG':
                // Heading mode - maintain selected heading
                break;
            case 'NAV':
                // VOR navigation mode
                break;
            case 'LOC':
                // Localizer mode
                break;
            case 'LNAV':
                // FMS lateral navigation
                if (this.fms.lnav.active) {
                    this.autopilot.targets.heading = this.fms.lnav.course;
                }
                break;
        }

        // Vertical mode execution
        switch (this.autopilot.modes.vertical.active) {
            case 'ALT':
                // Altitude hold mode
                break;
            case 'VS':
                // Vertical speed mode
                break;
            case 'ILS':
                // ILS glideslope mode
                break;
            case 'VNAV':
                // FMS vertical navigation
                if (this.fms.vnav.active) {
                    this.autopilot.targets.altitude = this.fms.vnav.targetAltitude;
                }
                break;
        }

        // Speed mode execution
        switch (this.autopilot.modes.speed.active) {
            case 'SPD':
                // Airspeed mode
                break;
            case 'MACH':
                // Mach number mode
                break;
            case 'THROT':
                // Autothrottle mode
                break;
        }
    }

    private checkAutopilotLimits(): void {
        // Check for autopilot limit exceedances
        const currentBank = this.aircraftState.roll * 180 / Math.PI;
        const currentVS = this.aircraftState.verticalSpeed;

        if (Math.abs(currentBank) > this.autopilot.limits.maxBank) {
            this.autopilot.status.warnings.push('BANK ANGLE LIMIT');
        }

        if (currentVS > this.autopilot.limits.maxClimbRate) {
            this.autopilot.status.warnings.push('CLIMB RATE LIMIT');
        }

        if (currentVS < this.autopilot.limits.maxDescentRate) {
            this.autopilot.status.warnings.push('DESCENT RATE LIMIT');
        }
    }

    private updateFlightDirector(deltaTime: number): void {
        if (!this.flightDirector.power) {
            this.flightDirector.active = false;
            return;
        }

        this.flightDirector.active = true;

        // Calculate flight director cues based on modes
        this.calculateFlightDirectorCues();
    }

    private calculateFlightDirectorCues(): void {
        // Simplified flight director logic
        const currentHeading = this.aircraftState.heading * 180 / Math.PI;
        const currentAltitude = this.aircraftState.altitude;
        const currentPitch = this.aircraftState.pitch * 180 / Math.PI;
        const currentRoll = this.aircraftState.roll * 180 / Math.PI;

        // Lateral cue calculation
        const headingError = this.normalizeAngle(this.autopilot.targets.heading - currentHeading);
        this.flightDirector.cues.roll = Math.max(-30, Math.min(30, headingError * 2));

        // Vertical cue calculation
        const altitudeError = this.autopilot.targets.altitude - currentAltitude;
        const targetPitch = Math.max(-15, Math.min(15, altitudeError * 0.01));
        this.flightDirector.cues.pitch = targetPitch - currentPitch;
    }

    private updateRadioNavigation(deltaTime: number): void {
        if (!this.electricalPower) return;

        this.updateGPS(deltaTime);
        this.updateVOR();
        this.updateILS();
        this.updateTransponder();
        this.updateTCAS(deltaTime);
    }

    private updateGPS(deltaTime: number): void {
        // Simulate GPS acquisition and navigation
        if (this.radioNav.gps.status === 'ACQUIRING') {
            this.radioNav.gps.satellites.tracked += 1;
            if (this.radioNav.gps.satellites.tracked >= 4) {
                this.radioNav.gps.status = 'NAVIGATING';
                this.radioNav.gps.satellites.used = 4;
            }
        }

        if (this.radioNav.gps.status === 'NAVIGATING') {
            // Update GPS position (would normally come from satellite constellation)
            this.radioNav.gps.position.latitude = this.aircraftState.position?.latitude || 0;
            this.radioNav.gps.position.longitude = this.aircraftState.position?.longitude || 0;
            this.radioNav.gps.position.altitude = this.aircraftState.altitude || 0;

            // Update accuracy based on satellite geometry
            const satelliteCount = this.radioNav.gps.satellites.used;
            this.radioNav.gps.accuracy.horizontal = 100 / satelliteCount;
            this.radioNav.gps.accuracy.vertical = 150 / satelliteCount;

            // Calculate DOP values
            this.radioNav.gps.satellites.geometry.hdop = 20 / satelliteCount;
            this.radioNav.gps.satellites.geometry.vdop = 25 / satelliteCount;
            this.radioNav.gps.satellites.geometry.pdop = Math.sqrt(
                this.radioNav.gps.satellites.geometry.hdop ** 2 + 
                this.radioNav.gps.satellites.geometry.vdop ** 2
            );

            // WAAS availability (simplified)
            this.radioNav.gps.waas.available = this.radioNav.gps.satellites.used >= 6;
            this.radioNav.gps.waas.corrections = this.radioNav.gps.waas.available;
        }

        // RAIM calculation
        this.radioNav.gps.raim.available = this.radioNav.gps.satellites.used >= 5;
        this.radioNav.gps.raim.faultDetection = this.radioNav.gps.raim.available;
    }

    private updateVOR(): void {
        // Simplified VOR simulation - would normally calculate based on VOR station positions
        // This would require a database of VOR stations and their positions
        
        // Update VOR1
        if (this.radioNav.vor1.power && this.radioNav.vor1.frequency > 108.0) {
            // Simulate signal reception
            this.radioNav.vor1.navFlag = false;
            this.radioNav.vor1.identifier = 'VOR';
        } else {
            this.radioNav.vor1.navFlag = true;
        }

        // Update VOR2
        if (this.radioNav.vor2.power && this.radioNav.vor2.frequency > 108.0) {
            this.radioNav.vor2.navFlag = false;
            this.radioNav.vor2.identifier = 'VOR';
        } else {
            this.radioNav.vor2.navFlag = true;
        }
    }

    private updateILS(): void {
        // Simplified ILS simulation
        if (this.radioNav.ils.power && this.radioNav.ils.frequency >= 108.1) {
            // Check if tuned to ILS frequency (108.1 - 111.9 MHz, odd tenths)
            const freq = this.radioNav.ils.frequency;
            const isILSFreq = freq >= 108.1 && freq <= 111.9 && 
                             ((freq * 10) % 2 === 1);
            
            if (isILSFreq) {
                this.radioNav.ils.localizer.flag = false;
                this.radioNav.ils.glideslope.flag = false;
                this.radioNav.ils.identifier = 'ILS';
                this.radioNav.ils.runway = '36L';
            } else {
                this.radioNav.ils.localizer.flag = true;
                this.radioNav.ils.glideslope.flag = true;
            }
        } else {
            this.radioNav.ils.localizer.flag = true;
            this.radioNav.ils.glideslope.flag = true;
        }
    }

    private updateTransponder(): void {
        if (this.radioNav.transponder.power && this.radioNav.transponder.mode !== 'OFF') {
            // Update altitude reporting
            if (this.radioNav.transponder.mode === 'ALT') {
                this.radioNav.transponder.altitude.reporting = true;
                this.radioNav.transponder.altitude.value = this.aircraftState.altitude || 0;
            } else {
                this.radioNav.transponder.altitude.reporting = false;
            }

            // Simulate interrogation replies
            this.radioNav.transponder.replies = Math.floor(Math.random() * 20) + 10;
        } else {
            this.radioNav.transponder.replies = 0;
            this.radioNav.transponder.altitude.reporting = false;
        }
    }

    private updateTCAS(deltaTime: number): void {
        if (this.radioNav.tcas.status === SystemStatus.OFF) return;

        // Clear old advisories
        this.radioNav.tcas.advisories.traffic = [];
        this.radioNav.tcas.advisories.resolution = [];

        // Process traffic targets
        this.radioNav.tcas.targets.forEach(target => {
            this.processTCASTarget(target);
        });
    }

    private processTCASTarget(target: TrafficTarget): void {
        const ownAltitude = this.aircraftState.altitude || 0;
        const altitudeSeparation = Math.abs(target.altitude - ownAltitude);
        const timeToCA = this.calculateTimeToClosestApproach(target);

        // Traffic Advisory logic
        if (target.distance < 6 && altitudeSeparation < 1200 && timeToCA < 48) {
            const ta: TrafficAdvisory = {
                target,
                type: 'TRAFFIC',
                bearing: target.bearing,
                distance: target.distance,
                altitude: target.relativeAltitude,
                trend: target.verticalSpeed,
                closure: 0, // Would calculate based on relative velocities
                timeToCA
            };
            this.radioNav.tcas.advisories.traffic.push(ta);
        }

        // Resolution Advisory logic (TCAS II)
        if (this.radioNav.tcas.version === 'TCAS_II' && 
            target.distance < 0.75 && altitudeSeparation < 600 && timeToCA < 25) {
            
            const raType = target.relativeAltitude > 0 ? 'DESCEND' : 'CLIMB';
            const ra: ResolutionAdvisory = {
                type: raType,
                strength: 'CORRECTIVE',
                rate: raType === 'CLIMB' ? 1500 : -1500,
                duration: 20,
                target
            };
            this.radioNav.tcas.advisories.resolution.push(ra);
        }
    }

    private updateWeatherRadar(deltaTime: number): void {
        if (!this.weatherRadar.power) {
            this.weatherRadar.returns = [];
            return;
        }

        // Simulate weather radar returns
        this.weatherRadar.returns = this.generateWeatherReturns();
    }

    private generateWeatherReturns(): WeatherReturn[] {
        // Simplified weather return simulation
        const returns: WeatherReturn[] = [];
        
        for (let i = 0; i < 10; i++) {
            returns.push({
                bearing: Math.random() * 360,
                distance: Math.random() * this.weatherRadar.range,
                intensity: Math.floor(Math.random() * 6),
                type: 'PRECIP',
                altitude: {
                    base: 5000 + Math.random() * 10000,
                    top: 15000 + Math.random() * 25000
                }
            });
        }
        
        return returns;
    }

    // Utility methods
    private calculateBearing(from: any, to: any): number {
        // Simplified bearing calculation
        return Math.atan2(to.longitude - from.longitude, to.latitude - from.latitude) * 180 / Math.PI;
    }

    private calculateDistance(from: any, to: any): number {
        // Simplified distance calculation (great circle)
        const R = 3440.065; // nautical miles
        const lat1 = from.latitude * Math.PI / 180;
        const lat2 = to.latitude * Math.PI / 180;
        const dLat = (to.latitude - from.latitude) * Math.PI / 180;
        const dLon = (to.longitude - from.longitude) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    private calculateCourseToBearing(waypoint: WaypointData): number {
        // Calculate the course from current position to waypoint
        return this.calculateBearing(this.aircraftState.position, waypoint.position);
    }

    private calculateTimeToClosestApproach(target: TrafficTarget): number {
        // Simplified CPA calculation
        return target.distance / 5; // Assume 5 nm/min closure rate
    }

    private normalizeAngle(angle: number): number {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    private checkAlerts(): void {
        this.alerts = [];

        // FMS alerts
        if (this.fms.status === SystemStatus.FAILED) {
            this.alerts.push({
                id: 'FMS_FAIL',
                level: AlertLevel.WARNING,
                message: 'FMS FAIL',
                system: 'AVIONICS',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: true
            });
        }

        // GPS alerts
        if (this.radioNav.gps.status === 'FAILED') {
            this.alerts.push({
                id: 'GPS_FAIL',
                level: AlertLevel.CAUTION,
                message: 'GPS FAIL',
                system: 'AVIONICS',
                timestamp: Date.now(),
                acknowledged: false,
                inhibited: false,
                active: true,
                flashing: false
            });
        }

        // TCAS Resolution Advisory
        if (this.radioNav.tcas.advisories.resolution.length > 0) {
            this.alerts.push({
                id: 'TCAS_RA',
                level: AlertLevel.WARNING,
                message: 'TCAS RA',
                system: 'AVIONICS',
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
    public setAutopilotMaster(enabled: boolean): void {
        this.autopilot.master = enabled;
        if (!enabled) {
            this.autopilot.channels.a = false;
            this.autopilot.channels.b = false;
            this.autopilot.channels.c = false;
        }
    }

    public engageAutopilotChannel(channel: 'A' | 'B' | 'C'): void {
        if (this.autopilot.master) {
            this.autopilot.channels[channel.toLowerCase() as keyof typeof this.autopilot.channels] = true;
        }
    }

    public setAutopilotMode(type: 'lateral' | 'vertical' | 'speed', mode: string): void {
        this.autopilot.modes[type].active = mode;
    }

    public setAutopilotTarget(parameter: keyof typeof this.autopilot.targets, value: number): void {
        this.autopilot.targets[parameter] = value;
    }

    public setFlightDirector(enabled: boolean): void {
        this.flightDirector.power = enabled;
    }

    public armLNAV(): void {
        if (this.fms.flightPlan.waypoints.length > 0) {
            this.fms.lnav.armed = true;
            this.fms.lnav.active = true;
            this.autopilot.modes.lateral.active = 'LNAV';
        }
    }

    public armVNAV(): void {
        if (this.fms.flightPlan.waypoints.length > 0) {
            this.fms.vnav.armed = true;
            this.fms.vnav.active = true;
            this.autopilot.modes.vertical.active = 'VNAV';
        }
    }

    public tuneRadio(radio: string, frequency: number): void {
        // Radio tuning implementation
        switch (radio) {
            case 'NAV1':
                this.radioNav.nav1.frequency.active = frequency;
                this.radioNav.vor1.frequency = frequency;
                break;
            case 'NAV2':
                this.radioNav.nav2.frequency.active = frequency;
                this.radioNav.vor2.frequency = frequency;
                break;
            case 'ILS':
                this.radioNav.ils.frequency = frequency;
                break;
        }
    }

    public setTransponderCode(code: string): void {
        this.radioNav.transponder.code = code;
    }

    public setTransponderMode(mode: 'OFF' | 'STBY' | 'ON' | 'ALT'): void {
        this.radioNav.transponder.mode = mode;
    }

    /**
     * Get display data for instruments
     */
    public getPrimaryFlightData(): PrimaryFlightData {
        return {
            attitude: {
                pitch: (this.aircraftState.pitch || 0) * 180 / Math.PI,
                roll: (this.aircraftState.roll || 0) * 180 / Math.PI,
                heading: (this.aircraftState.heading || 0) * 180 / Math.PI,
                headingTrue: (this.aircraftState.headingTrue || 0) * 180 / Math.PI,
                track: (this.aircraftState.track || 0) * 180 / Math.PI,
                slip: this.aircraftState.sideslip || 0
            },
            altitude: {
                indicated: this.aircraftState.altitude || 0,
                radio: this.aircraftState.altitudeAGL || 0,
                pressure: 29.92,
                selected: this.autopilot.targets.altitude,
                deviation: (this.aircraftState.altitude || 0) - this.autopilot.targets.altitude,
                trend: this.aircraftState.verticalSpeed || 0,
                decision: 200
            },
            airspeed: {
                indicated: this.aircraftState.indicatedAirspeed || 0,
                true: this.aircraftState.trueAirspeed || 0,
                ground: this.aircraftState.groundSpeed || 0,
                selected: this.autopilot.targets.airspeed,
                mach: this.aircraftState.machNumber || 0,
                trend: 0,
                v1: 150,
                vr: 160,
                v2: 170,
                vref: 140,
                vapp: 145
            },
            verticalSpeed: {
                current: this.aircraftState.verticalSpeed || 0,
                selected: this.autopilot.targets.verticalSpeed,
                required: this.fms.vnav.requiredVS
            },
            flightDirector: {
                active: this.flightDirector.active,
                pitch: this.flightDirector.cues.pitch,
                roll: this.flightDirector.cues.roll,
                mode: this.flightDirector.modes.lateral
            },
            autopilot: {
                engaged: this.autopilot.status.engaged,
                armed: this.autopilot.master,
                modes: {
                    lateral: this.autopilot.modes.lateral.active,
                    vertical: this.autopilot.modes.vertical.active,
                    speed: this.autopilot.modes.speed.active
                }
            }
        };
    }

    public getNavigationDisplayData(): NavigationDisplayData {
        const activeWaypoint = this.fms.flightPlan.waypoints[this.fms.flightPlan.activeWaypoint] || {
            id: '',
            name: '',
            type: 'WAYPOINT' as const,
            position: { latitude: 0, longitude: 0, altitude: 0 },
            bearing: 0,
            distance: 0,
            eta: 0
        };

        const nextWaypoint = this.fms.flightPlan.waypoints[this.fms.flightPlan.activeWaypoint + 1] || activeWaypoint;

        return {
            map: {
                range: 80,
                mode: 'ARC',
                centerMode: 'AIRCRAFT',
                heading: (this.aircraftState.heading || 0) * 180 / Math.PI,
                track: (this.aircraftState.track || 0) * 180 / Math.PI,
                drift: 0
            },
            navigation: {
                activeWaypoint,
                nextWaypoint,
                courseDeviation: this.fms.lnav.courseDeviation,
                crossTrackError: this.fms.lnav.crossTrackError,
                bearing: this.fms.lnav.bearing,
                distance: this.fms.lnav.distance,
                timeToWaypoint: this.fms.vnav.timeToWaypoint,
                groundSpeed: this.aircraftState.groundSpeed || 0
            },
            traffic: {
                targets: this.radioNav.tcas.targets,
                resolution: this.radioNav.tcas.resolution
            },
            weather: {
                radar: {
                    range: this.weatherRadar.range,
                    tilt: this.weatherRadar.tilt,
                    gain: this.weatherRadar.gain.value,
                    mode: this.weatherRadar.mode,
                    returns: this.weatherRadar.returns
                },
                turbulence: [],
                windshear: false
            },
            radio: {
                vor1: this.radioNav.vor1,
                vor2: this.radioNav.vor2,
                ils: this.radioNav.ils,
                gps: this.radioNav.gps
            }
        };
    }

    public getAlerts(): AlertData[] {
        return [...this.alerts];
    }

    public getAutopilotStatus(): AutopilotSystem {
        return { ...this.autopilot };
    }

    public getFMSStatus(): FlightManagementSystem {
        return { ...this.fms };
    }
}