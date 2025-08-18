# Photorealistic Flight Simulator

A high-performance, browser-based flight simulator built with WebGPU, featuring realistic physics simulation, procedural terrain generation, and comprehensive aircraft systems modeling.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![WebGPU](https://img.shields.io/badge/WebGPU-Enabled-green.svg)
![Tests](https://img.shields.io/badge/tests-passing-green.svg)

## Features

### 🎮 Core Capabilities
- **Photorealistic Rendering**: Deferred rendering pipeline with PBR materials
- **Realistic Flight Physics**: 6DOF dynamics with accurate aerodynamics at 120Hz
- **Large-Scale World**: Procedural terrain generation with streaming and LOD
- **Professional Avionics**: Complete aircraft systems simulation
- **Multi-Platform Support**: WebGPU with automatic WebGL2 fallback
- **High Performance**: Optimized for 60+ FPS on mid-range hardware

### ✈️ Flight Dynamics
- Six degrees of freedom rigid body simulation
- Blade element theory aerodynamics
- Realistic stall and spin behavior
- Ground effect modeling
- Atmospheric effects (ISA model)
- Multiple engine types (jet, turboprop, piston)

### 🌍 World System
- Hierarchical tile-based terrain with quadtree LOD
- Procedural heightmap generation
- Biome-based surface materials
- Water simulation with waves
- Autogen scenery placement
- Real-world elevation data support (prepared for SRTM/DTED)

### 🛩️ Aircraft Systems
- Electrical system with bus architecture
- Hydraulic systems with actuator modeling
- Fuel management with CG calculations
- Environmental controls (pressurization, air conditioning)
- Comprehensive warning systems (GPWS, TCAS, stall warning)
- Autopilot with LNAV/VNAV capabilities

## Quick Start

### Prerequisites
- Node.js 18+ 
- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- For WebGL2 fallback: Any modern browser

### Installation

```bash
# Clone the repository
git clone https://github.com/rlefko/flight-simulator.git
cd flight-simulator

# Install dependencies
npm install

# Start development server
npm run dev
```

### Building for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build
npm run preview
```

## Controls

### Flight Controls
| Key | Action |
|-----|--------|
| W/S | Pitch Down/Up |
| A/D | Roll Left/Right |
| Q/E | Yaw Left/Right |
| Shift/Ctrl | Throttle Up/Down |

### Systems
| Key | Action |
|-----|--------|
| G | Toggle Landing Gear |
| F | Cycle Flaps |
| B | Toggle Speed Brakes |
| L | Toggle Lights |

### Camera
| Key | Action |
|-----|--------|
| 1-5 | Camera Views |
| Mouse | Look Around |
| Scroll | Zoom In/Out |

### General
| Key | Action |
|-----|--------|
| ESC | Pause |
| F1 | Help |
| F11 | Fullscreen |
| P | Screenshot |

## Development

### Project Structure

```
flight-simulator/
├── src/
│   ├── core/           # Engine core, math, events
│   ├── physics/        # Flight dynamics simulation
│   ├── rendering/      # WebGPU/WebGL2 rendering
│   ├── world/          # Terrain and scenery
│   ├── aircraft/       # Aircraft systems
│   ├── controls/       # Input handling
│   ├── weather/        # Weather simulation
│   └── main.ts         # Application entry
├── tests/              # Test suites
├── public/             # Static assets
└── docs/               # Documentation
```

### Architecture

The simulator follows a modular architecture with clear separation of concerns:

- **Engine Core**: Main game loop, event system, resource management
- **Physics Thread**: 120Hz fixed timestep simulation
- **Rendering Pipeline**: Deferred rendering with temporal upsampling
- **World Streaming**: Background workers for terrain generation
- **Systems Simulation**: Independent aircraft subsystems

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.

### Testing

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Open test UI
npm run test:ui
```

### Code Quality

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format
```

## Performance

### Recommended Specifications
- **Minimum**: Intel i5/Ryzen 5, 8GB RAM, GTX 1060/RX 580
- **Recommended**: Intel i7/Ryzen 7, 16GB RAM, RTX 3060/RX 6600
- **Optimal**: Intel i9/Ryzen 9, 32GB RAM, RTX 4070+/RX 7800+

### Optimization Settings
The simulator includes adaptive quality settings that automatically adjust based on performance:

- **Ultra**: All features enabled, maximum draw distance
- **High**: High quality textures, standard draw distance
- **Medium**: Balanced quality and performance
- **Low**: Optimized for lower-end hardware

## Browser Support

| Browser | WebGPU | WebGL2 | Status |
|---------|--------|--------|--------|
| Chrome 113+ | ✅ | ✅ | Full Support |
| Edge 113+ | ✅ | ✅ | Full Support |
| Firefox | ❌ | ✅ | WebGL2 Fallback |
| Safari | 🚧 | ✅ | WebGL2 Fallback |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes following our commit standards
4. Push to your branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

### Phase 1 (Current)
- ✅ Core engine and physics
- ✅ Basic rendering pipeline
- ✅ Terrain generation
- ✅ Aircraft systems
- ✅ Input controls

### Phase 2 (Q1 2025)
- ⏳ Weather system implementation
- ⏳ Cloud rendering
- ⏳ Airport and runway system
- ⏳ ATC integration

### Phase 3 (Q2 2025)
- ⏳ Multiplayer support
- ⏳ VR integration
- ⏳ Mobile optimization
- ⏳ Real-world data integration

### Phase 4 (Q3 2025)
- ⏳ Multiple aircraft models
- ⏳ Mission system
- ⏳ Flight planning
- ⏳ Performance profiler

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with TypeScript and Vite
- WebGPU implementation based on W3C specifications
- Physics simulation inspired by JSBSim and X-Plane
- Terrain generation using improved Perlin noise

## Support

For bug reports and feature requests, please use the [GitHub Issues](https://github.com/rlefko/flight-simulator/issues) page.

For questions and discussions, join our [Discord Server](https://discord.gg/yourinvite).

## Author

**Ryan Lefkowitz**
- Email: rlefkowitz1800@yahoo.com
- GitHub: [@rlefko](https://github.com/rlefko)

---

Made with ❤️ for the flight simulation community
