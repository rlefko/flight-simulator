import { vi } from 'vitest';

Object.defineProperty(window, 'requestAnimationFrame', {
  value: vi.fn((cb: FrameRequestCallback) => {
    setTimeout(() => cb(performance.now()), 16);
    return 0;
  }),
});

Object.defineProperty(window, 'cancelAnimationFrame', {
  value: vi.fn((id: number) => clearTimeout(id)),
});

class MockWebGPU {
  async requestAdapter() {
    return null;
  }
}

Object.defineProperty(navigator, 'gpu', {
  value: new MockWebGPU(),
  writable: true,
});

Object.defineProperty(window, 'performance', {
  value: {
    ...performance,
    memory: {
      usedJSHeapSize: 1024 * 1024 * 50,
      totalJSHeapSize: 1024 * 1024 * 100,
      jsHeapSizeLimit: 1024 * 1024 * 200,
    },
  },
});

class MockGamepad {
  constructor(
    public axes: number[] = [0, 0, 0, 0],
    public buttons: { pressed: boolean; value: number }[] = []
  ) {}
}

Object.defineProperty(navigator, 'getGamepads', {
  value: vi.fn(() => []),
});