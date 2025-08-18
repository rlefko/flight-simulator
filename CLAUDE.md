# Photorealistic Flight Simulator - Claude Code Project Guidelines

## Project Overview
This is a photorealistic flight simulator project that emphasizes planning-first development with meticulous implementation. The project uses a team of specialized Claude Code agents to handle different aspects of development.

## Agent Usage Requirements

### MANDATORY: Agent Selection Protocol
For EVERY request, Claude Code MUST:
1. First identify the request type (planning, implementation, testing, optimization)
2. Delegate to the appropriate agent(s) based on the task
3. Use multiple agents in sequence when tasks span multiple domains
4. NEVER proceed without using the appropriate specialized agent

### Planning-First Methodology
1. **ALL features must begin with the architect agent** for high-level design
2. **Implementation only proceeds after planning approval** from relevant planning agents
3. **Changes to existing systems require architect review** before implementation

## Git Commit Standards

### Commit Message Format
- All commits MUST start with an appropriate emoji
- Message length: Maximum one sentence, no ending punctuation
- Attribution: All commits authored by rlefkowitz1800@yahoo.com

### Emoji Prefix Guide
- 🎯 Planning and architecture decisions
- ✈️ Flight mechanics and aerodynamics
- 🎮 Controls and input systems
- 🌍 World and terrain generation
- 🎨 Graphics and rendering
- ⚡ Performance optimizations
- 🔧 Configuration and setup
- 📦 Dependencies and packages
- 🧪 Testing and validation
- 🐛 Bug fixes
- 📝 Documentation updates
- ♻️ Refactoring
- 🚀 New features
- 🔊 Audio and sound systems
- 🌤️ Weather and atmospheric effects
- 📊 Telemetry and instrumentation

## Agent Team Hierarchy

### Planning Layer (High-Level)
1. **architect** - System design and architecture decisions
2. **designer** - User experience and visual design
3. **planner** - Feature planning and task breakdown

### Implementation Layer (Low-Level)
1. **graphics** - Rendering pipeline and visual effects
2. **physics** - Flight dynamics and physics simulation
3. **systems** - Aircraft systems and instrumentation
4. **world** - Terrain generation and environment
5. **controls** - Input handling and control systems

### Quality Layer
1. **tester** - Testing strategies and validation
2. **optimizer** - Performance profiling and optimization

## Development Workflow

### Feature Development Process
1. **Planning Phase** (architect → planner → designer)
   - Architectural design document
   - Implementation plan with milestones
   - UI/UX mockups if applicable

2. **Implementation Phase** (specialized agents)
   - Follow the approved plan strictly
   - Regular commits with emoji prefixes
   - Continuous integration with existing systems

3. **Quality Phase** (tester → optimizer)
   - Comprehensive testing
   - Performance benchmarking
   - Optimization passes

### Code Quality Standards
- Modular, reusable components
- Comprehensive error handling
- Performance-conscious implementations
- Clear separation of concerns
- Extensive inline documentation for complex algorithms

## Technical Stack Guidelines

### Graphics Pipeline
- Modern rendering techniques (PBR, deferred rendering)
- LOD systems for performance
- Realistic atmospheric scattering
- Dynamic time-of-day lighting

### Physics Simulation
- Accurate flight dynamics model
- Real-world aerodynamic coefficients
- Environmental factors (wind, turbulence, weather)
- Ground effect and wake turbulence

### Performance Targets
- 60+ FPS at 1080p on mid-range hardware
- Scalable quality settings
- Efficient memory management
- Optimized asset streaming

## Testing Requirements
- Unit tests for physics calculations
- Integration tests for systems
- Performance benchmarks
- Visual regression tests for rendering

## Agent Coordination Rules
1. Agents must communicate through structured handoffs
2. Implementation agents cannot override planning decisions
3. All major changes require architect approval
4. Cross-system features require multiple agent collaboration

## Project Milestones
1. Core flight dynamics system
2. Basic rendering pipeline
3. Terrain generation system
4. Aircraft systems simulation
5. Weather and atmospheric effects
6. Multiplayer infrastructure
7. VR support integration

## Remember
- **ALWAYS use the appropriate agent for each task**
- **NEVER skip the planning phase**
- **EVERY commit must follow the emoji prefix standard**
- **PRIORITIZE realism and performance equally**