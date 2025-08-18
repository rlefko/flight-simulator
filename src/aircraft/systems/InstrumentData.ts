import { Vector3 } from '../../core/math/Vector3';

/**
 * Comprehensive instrument data structures for aircraft systems
 * Provides standardized data formats for cockpit displays and systems
 */

// Base system status
export enum SystemStatus {
    OFF = 'OFF',
    ON = 'ON',
    STANDBY = 'STANDBY',
    FAILED = 'FAILED',
    MAINTENANCE = 'MAINTENANCE',
    TEST = 'TEST'
}

export enum AlertLevel {
    NORMAL = 'NORMAL',
    ADVISORY = 'ADVISORY',
    CAUTION = 'CAUTION',
    WARNING = 'WARNING',
    EMERGENCY = 'EMERGENCY'
}

// Primary Flight Display (PFD) Data
export interface PrimaryFlightData {
    attitude: {
        pitch: number;           // degrees
        roll: number;            // degrees
        heading: number;         // degrees magnetic
        headingTrue: number;     // degrees true
        track: number;           // degrees ground track
        slip: number;            // sideslip indicator
    };
    
    altitude: {
        indicated: number;       // feet MSL
        radio: number;           // feet AGL (radio altimeter)
        pressure: number;        // altimeter setting inHg
        selected: number;        // selected altitude
        deviation: number;       // altitude deviation from selected
        trend: number;           // altitude trend (fpm)
        decision: number;        // decision height/altitude
    };
    
    airspeed: {
        indicated: number;       // knots IAS
        true: number;            // knots TAS
        ground: number;          // knots ground speed
        selected: number;        // selected airspeed
        mach: number;            // mach number
        trend: number;           // airspeed trend
        v1: number;              // takeoff decision speed
        vr: number;              // rotation speed
        v2: number;              // takeoff safety speed
        vref: number;            // landing reference speed
        vapp: number;            // approach speed
    };
    
    verticalSpeed: {
        current: number;         // feet per minute
        selected: number;        // selected vertical speed
        required: number;        // required vertical speed for nav
    };
    
    flightDirector: {
        active: boolean;
        pitch: number;           // degrees
        roll: number;            // degrees
        mode: string;            // current mode
    };
    
    autopilot: {
        engaged: boolean;
        armed: boolean;
        modes: {
            lateral: string;     // HDG, NAV, LOC, LNAV, etc.
            vertical: string;    // ALT, VS, ILS, VNAV, etc.
            speed: string;       // SPD, MACH, THROT, etc.
        };
    };
}

// Navigation Display (ND) Data
export interface NavigationDisplayData {
    map: {
        range: number;           // nautical miles
        mode: 'ARC' | 'ROSE' | 'PLAN';
        centerMode: 'AIRCRAFT' | 'WAYPOINT';
        heading: number;         // degrees
        track: number;           // degrees
        drift: number;           // degrees
    };
    
    navigation: {
        activeWaypoint: WaypointData;
        nextWaypoint: WaypointData;
        courseDeviation: number; // degrees
        crossTrackError: number; // nautical miles
        bearing: number;         // degrees to waypoint
        distance: number;        // nautical miles to waypoint
        timeToWaypoint: number;  // seconds
        groundSpeed: number;     // knots
    };
    
    traffic: {
        targets: TrafficTarget[];
        resolution: TcasResolution | null;
    };
    
    weather: {
        radar: WeatherRadarData;
        turbulence: TurbulenceData[];
        windshear: boolean;
    };
    
    radio: {
        vor1: VorData;
        vor2: VorData;
        ils: IlsData;
        gps: GpsData;
    };
}

// Engine Indication and Crew Alerting System (EICAS) Data
export interface EicasData {
    engines: EngineData[];
    fuel: FuelSystemData;
    hydraulics: HydraulicsDisplayData;
    electrical: ElectricalDisplayData;
    environmental: EnvironmentalDisplayData;
    alerts: AlertData[];
    configuration: ConfigurationData;
}

// Engine parameters
export interface EngineData {
    engineNumber: number;
    status: SystemStatus;
    
    thrust: {
        current: number;         // percentage N1
        target: number;          // percentage N1
        limit: number;           // percentage N1
        mode: 'IDLE' | 'CLIMB' | 'CRUISE' | 'TOGA' | 'FLEX';
    };
    
    temperatures: {
        n1: number;              // RPM
        n2: number;              // RPM
        egt: number;             // degrees C
        itt: number;             // degrees C
        cht: number;             // degrees C (piston)
        oil: number;             // degrees C
    };
    
    pressures: {
        oil: number;             // PSI
        fuel: number;            // PSI
        manifold: number;        // inHg (piston)
    };
    
    flow: {
        fuel: number;            // GPH or PPH
        oil: number;             // quarts
    };
    
    vibration: {
        n1: number;              // units
        n2: number;              // units
    };
    
    reverser: {
        deployed: boolean;
        position: number;        // percentage
    };
    
    ignition: {
        left: boolean;
        right: boolean;
        continuous: boolean;
    };
    
    starter: {
        engaged: boolean;
        airValve: boolean;
        cutoff: boolean;
    };
}

// Fuel system display data
export interface FuelSystemData {
    tanks: FuelTankData[];
    totalFuel: number;           // pounds or gallons
    totalUsable: number;         // pounds or gallons
    centerOfGravity: number;     // percentage MAC
    fuelFlow: {
        total: number;           // GPH
        engines: number[];       // GPH per engine
    };
    crossfeed: {
        valve: boolean;
        auto: boolean;
    };
    pumps: FuelPumpData[];
}

export interface FuelTankData {
    name: string;
    quantity: number;            // pounds or gallons
    capacity: number;            // pounds or gallons
    temperature: number;         // degrees C
    density: number;             // specific gravity
    pumps: boolean[];            // pump status
    valves: boolean[];           // valve status
}

export interface FuelPumpData {
    name: string;
    status: SystemStatus;
    pressure: number;            // PSI
    flow: number;                // GPH
}

// Hydraulic system display data
export interface HydraulicsDisplayData {
    systems: HydraulicSystemData[];
    reservoirs: HydraulicReservoirData[];
    accumulators: AccumulatorData[];
}

export interface HydraulicSystemData {
    name: string;               // 'A', 'B', 'C' or 'L', 'R', 'C'
    status: SystemStatus;
    pressure: number;           // PSI
    flow: number;               // GPM
    temperature: number;        // degrees C
    pumps: {
        engine: boolean;        // engine-driven pump
        electric: boolean;      // electric pump
        manual: boolean;        // manual pump
        rat: boolean;           // ram air turbine
    };
    quantity: number;           // quarts
    filters: {
        return: boolean;        // filter status
        suction: boolean;
    };
}

export interface HydraulicReservoirData {
    system: string;
    quantity: number;           // quarts
    capacity: number;           // quarts
    temperature: number;        // degrees C
    pressure: number;           // PSI
}

export interface AccumulatorData {
    system: string;
    pressure: number;           // PSI
    precharge: number;          // PSI
}

// Electrical system display data
export interface ElectricalDisplayData {
    generators: GeneratorData[];
    batteries: BatteryData[];
    buses: BusData[];
    inverters: InverterData[];
    load: {
        total: number;          // amps
        essential: number;      // amps
        nonEssential: number;   // amps
    };
}

export interface GeneratorData {
    name: string;               // 'L GEN', 'R GEN', 'APU GEN'
    status: SystemStatus;
    voltage: number;            // volts
    current: number;            // amps
    frequency: number;          // Hz
    power: number;              // KW
    online: boolean;
}

export interface BatteryData {
    name: string;
    status: SystemStatus;
    voltage: number;            // volts
    current: number;            // amps (+ charging, - discharging)
    capacity: number;           // amp-hours
    temperature: number;        // degrees C
    switchPosition: 'OFF' | 'ON' | 'AUTO';
}

export interface BusData {
    name: string;               // 'MAIN', 'ESS', 'SHED', etc.
    status: SystemStatus;
    voltage: number;            // volts
    frequency: number;          // Hz (AC buses)
    powered: boolean;
    source: string;             // power source
}

export interface InverterData {
    name: string;
    status: SystemStatus;
    input: {
        voltage: number;        // volts DC
        current: number;        // amps
    };
    output: {
        voltage: number;        // volts AC
        frequency: number;      // Hz
        current: number;        // amps
    };
}

// Environmental system display data
export interface EnvironmentalDisplayData {
    pressurization: {
        cabinAltitude: number;  // feet
        cabinVS: number;        // fpm
        diffPressure: number;   // PSI
        outflowValve: number;   // percentage open
        safetyValve: boolean;   // relief valve status
        mode: 'AUTO' | 'MANUAL' | 'DUMP';
        controller: 'A' | 'B' | 'MANUAL';
    };
    
    airConditioning: {
        packs: PackData[];
        mixValves: MixValveData[];
        temperature: {
            cockpit: number;    // degrees C
            cabin: number;      // degrees C
            aft: number;        // degrees C
            cargo: number;      // degrees C
        };
        flow: {
            high: boolean;
            normal: boolean;
            low: boolean;
        };
    };
    
    bleedAir: {
        engines: BleedAirData[];
        apu: BleedAirData;
        ground: BleedAirData;
        crossbleed: {
            valve: boolean;
            auto: boolean;
        };
    };
    
    antiIce: {
        engine: boolean[];      // per engine
        wing: boolean;
        pitot: boolean[];       // per pitot/static port
        windshield: boolean;
        probe: boolean;
        waste: boolean;
    };
    
    oxygen: {
        passenger: {
            pressure: number;   // PSI
            quantity: number;   // percentage
            generators: boolean;
        };
        crew: {
            pressure: number;   // PSI
            quantity: number;   // percentage
            flow: 'NORM' | 'HIGH' | '100%';
        };
    };
}

export interface PackData {
    name: string;
    status: SystemStatus;
    temperature: {
        supply: number;         // degrees C
        discharge: number;      // degrees C
    };
    flow: number;               // percentage
    valve: boolean;
}

export interface MixValveData {
    zone: string;
    position: number;           // percentage
    temperature: {
        hot: number;            // degrees C
        cold: number;           // degrees C
        mixed: number;          // degrees C
    };
}

export interface BleedAirData {
    name: string;
    status: SystemStatus;
    pressure: number;           // PSI
    temperature: number;        // degrees C
    valve: boolean;
    regulator: boolean;
}

// Alert and warning data
export interface AlertData {
    id: string;
    level: AlertLevel;
    message: string;
    system: string;
    timestamp: number;
    acknowledged: boolean;
    inhibited: boolean;
    active: boolean;
    flashing: boolean;
}

// Configuration warnings
export interface ConfigurationData {
    gear: {
        nose: 'UP' | 'DOWN' | 'TRANSIT';
        left: 'UP' | 'DOWN' | 'TRANSIT';
        right: 'UP' | 'DOWN' | 'TRANSIT';
        doors: boolean[];       // gear doors
    };
    
    flaps: {
        position: number;       // degrees or detents
        selected: number;       // selected position
        asymmetry: boolean;
        transit: boolean;
    };
    
    slats: {
        position: number;       // degrees or detents
        asymmetry: boolean;
        transit: boolean;
    };
    
    spoilers: {
        position: number;       // percentage
        armed: boolean;
        deployed: boolean;
        speedbrakes: number;    // percentage
    };
    
    trim: {
        elevator: number;       // degrees
        rudder: number;         // degrees
        aileron: number;        // degrees
    };
    
    doors: {
        passenger: boolean[];   // door status
        cargo: boolean[];
        service: boolean[];
        emergency: boolean[];
    };
}

// Navigation data structures
export interface WaypointData {
    id: string;
    name: string;
    type: 'AIRPORT' | 'VOR' | 'NDB' | 'WAYPOINT' | 'USER';
    position: {
        latitude: number;       // degrees
        longitude: number;      // degrees
        altitude: number;       // feet
    };
    bearing: number;            // degrees from aircraft
    distance: number;           // nautical miles
    eta: number;                // seconds
}

export interface TrafficTarget {
    id: string;
    callsign: string;
    bearing: number;            // degrees relative
    distance: number;           // nautical miles
    altitude: number;           // feet
    relativeAltitude: number;   // feet (+/-)
    verticalSpeed: number;      // fpm
    threat: 'NONE' | 'PROXIMITY' | 'INTRUDER' | 'TRAFFIC';
}

export interface TcasResolution {
    type: 'TA' | 'RA';
    direction: 'CLIMB' | 'DESCEND' | 'LEVEL';
    rate: number;               // fpm
    target: TrafficTarget;
}

export interface WeatherRadarData {
    range: number;              // nautical miles
    tilt: number;               // degrees
    gain: number;               // percentage
    mode: 'WX' | 'TURB' | 'MAP';
    returns: WeatherReturn[];
}

export interface WeatherReturn {
    bearing: number;            // degrees
    distance: number;           // nautical miles
    intensity: number;          // 0-5 scale
    type: 'PRECIP' | 'TURB' | 'WINDSHEAR';
}

export interface TurbulenceData {
    position: Vector3;
    intensity: number;          // 0-5 scale
    type: 'CAT' | 'CONVECTIVE' | 'MOUNTAIN' | 'WAKE';
}

export interface VorData {
    frequency: number;          // MHz
    identifier: string;         // 3-letter ID
    radial: number;             // degrees
    deviation: number;          // degrees
    distance: number;           // nautical miles
    flag: boolean;              // OFF flag
}

export interface IlsData {
    frequency: number;          // MHz
    identifier: string;         // 4-letter ID
    runway: string;             // runway identifier
    localizer: {
        deviation: number;      // degrees
        flag: boolean;
    };
    glideslope: {
        deviation: number;      // degrees
        flag: boolean;
    };
    dme: {
        distance: number;       // nautical miles
        flag: boolean;
    };
}

export interface GpsData {
    position: {
        latitude: number;       // degrees
        longitude: number;      // degrees
        altitude: number;       // feet
    };
    accuracy: {
        horizontal: number;     // meters
        vertical: number;       // meters
    };
    satellites: {
        tracked: number;
        used: number;
        pdop: number;
        hdop: number;
        vdop: number;
    };
    waas: boolean;              // WAAS available
    raim: boolean;              // RAIM available
}

// System configuration interfaces
export interface SystemConfiguration {
    electrical: ElectricalConfig;
    hydraulic: HydraulicConfig;
    fuel: FuelConfig;
    environmental: EnvironmentalConfig;
    avionics: AvionicsConfig;
}

export interface ElectricalConfig {
    generators: {
        count: number;
        ratedPower: number;     // KW
        voltage: number;        // volts
        frequency: number;      // Hz
    };
    batteries: {
        count: number;
        capacity: number;       // amp-hours
        voltage: number;        // volts
    };
    buses: {
        main: string[];
        essential: string[];
        emergency: string[];
    };
}

export interface HydraulicConfig {
    systems: {
        count: number;
        pressure: number;       // PSI
        capacity: number;       // quarts
    };
    pumps: {
        engine: number;
        electric: number;
        manual: number;
    };
}

export interface FuelConfig {
    tanks: {
        names: string[];
        capacities: number[];   // pounds or gallons
        positions: Vector3[];   // CG positions
    };
    pumps: {
        primary: number;
        transfer: number;
        boost: number;
    };
}

export interface EnvironmentalConfig {
    pressurization: {
        maxDiffPressure: number;    // PSI
        maxCabinAltitude: number;   // feet
        normalVS: number;           // fpm
    };
    airConditioning: {
        packs: number;
        zones: number;
        maxFlow: number;        // CFM
    };
}

export interface AvionicsConfig {
    displays: {
        pfd: number;
        nd: number;
        eicas: number;
        mfd: number;
    };
    navigation: {
        gps: boolean;
        vor: number;
        ils: boolean;
        dme: boolean;
        adf: number;
    };
    autopilot: {
        channels: number;
        modes: string[];
    };
}