# Contributing to Photorealistic Flight Simulator

Thank you for your interest in contributing to this project! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:
- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive criticism
- Accept feedback gracefully

## Getting Started

### Prerequisites
1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature`

### Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests in watch mode
npm run test:watch
```

## Development Guidelines

### Code Style

We use TypeScript with strict type checking. Please ensure:
- All code passes TypeScript compilation: `npm run typecheck`
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### File Organization

```
src/
├── core/        # Core engine functionality
├── physics/     # Physics simulation
├── rendering/   # Graphics and rendering
├── world/       # World generation and management
├── aircraft/    # Aircraft systems and models
├── controls/    # Input handling
└── weather/     # Weather simulation
```

### Commit Standards

We follow a structured commit message format with emoji prefixes:

#### Commit Format
```
<emoji> <message>
```

#### Emoji Guide
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

#### Examples
```
✈️ Implement ground effect modeling
🎨 Add volumetric cloud rendering
🐛 Fix stall recovery behavior
⚡ Optimize terrain mesh generation
```

### Testing

All new features should include tests:

```typescript
// Example test structure
describe('YourFeature', () => {
  it('should perform expected behavior', () => {
    // Test implementation
  });
});
```

Run tests before submitting:
```bash
npm run test
npm run test:coverage
```

### Documentation

- Update README.md for new features
- Add inline comments for complex logic
- Update ARCHITECTURE.md for architectural changes
- Include JSDoc for public APIs

## Submission Process

### Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names
   - `feature/add-weather-system`
   - `fix/landing-gear-animation`
   - `refactor/physics-engine`

2. **PR Description**: Include:
   - Summary of changes
   - Related issue numbers
   - Testing performed
   - Screenshots/videos for visual changes

3. **PR Checklist**:
   - [ ] Code passes all tests
   - [ ] TypeScript compilation succeeds
   - [ ] Documentation updated
   - [ ] Commit messages follow standards
   - [ ] Performance impact considered

### Review Process

1. Submit your PR with a clear description
2. Respond to review feedback
3. Make requested changes
4. Ensure CI checks pass
5. PR will be merged after approval

## Development Areas

### High Priority Areas

#### Physics Engine
- Improve atmospheric modeling
- Add helicopter flight dynamics
- Enhance ground handling
- Implement wake turbulence

#### Rendering
- Implement volumetric clouds
- Add dynamic shadows
- Improve water rendering
- Optimize LOD transitions

#### World System
- Add airport generation
- Implement road networks
- Enhance autogen buildings
- Add seasonal variations

#### Aircraft Systems
- Expand avionics capabilities
- Add more failure modes
- Implement FMS routes
- Enhance autopilot modes

### Feature Requests

Check the [Issues](https://github.com/yourusername/flight-sim/issues) page for:
- `good-first-issue` - Great for newcomers
- `help-wanted` - Community assistance needed
- `enhancement` - New feature ideas

## Architecture Guidelines

### System Design Principles

1. **Modularity**: Keep systems independent and loosely coupled
2. **Performance**: Target 60+ FPS on recommended hardware
3. **Realism**: Prioritize accurate simulation over shortcuts
4. **Extensibility**: Design for future expansion

### Performance Considerations

- Profile before optimizing
- Use Web Workers for heavy computations
- Implement LOD for all visual elements
- Cache frequently used calculations
- Use object pools to reduce GC pressure

### Memory Management

- Dispose of GPU resources properly
- Implement resource streaming
- Use typed arrays for performance
- Monitor memory usage in development

## Testing Guidelines

### Unit Tests
- Test individual functions and classes
- Mock external dependencies
- Aim for 80%+ coverage

### Integration Tests
- Test system interactions
- Verify event handling
- Check data flow between modules

### Performance Tests
- Monitor frame times
- Check memory usage
- Validate physics timestep consistency

## Questions and Support

- **Discord**: Join our [Discord server](https://discord.gg/yourinvite)
- **Issues**: Use GitHub Issues for bugs and features
- **Discussions**: Use GitHub Discussions for questions

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to the Photorealistic Flight Simulator project!