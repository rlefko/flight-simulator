import { Engine } from './core/engine/Engine';

let engine: Engine | null = null;

async function main() {
    try {
        console.log('main(): Starting flight simulator initialization');
        const loadingElement = document.getElementById('loading');

        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        // Set canvas size to match window
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        console.log('main(): Canvas found and sized to', canvas.width, 'x', canvas.height);

        engine = new Engine({
            canvas,
            fixedTimeStep: 1 / 120,
            maxSubSteps: 10,
            targetFPS: 60,
            enableStats: true,
        });
        console.log('main(): Engine created');

        await engine.initialize();
        console.log('main(): Engine initialized');

        if (loadingElement) {
            loadingElement.style.display = 'none';
        }

        console.log('main(): Starting engine');
        engine.start();
        console.log('main(): Engine started');

        console.log('Flight Simulator started successfully');

        setupKeyboardShortcuts();
        console.log('main(): Setup complete');
    } catch (error) {
        console.error('Failed to start flight simulator:', error);

        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.innerHTML = `
                <div style="color: #ff6b6b;">
                    Failed to initialize flight simulator<br>
                    <span style="font-size: 14px; color: #aaa;">
                        ${error instanceof Error ? error.message : 'Unknown error'}
                    </span>
                </div>
            `;
        }
    }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (!engine) return;

        switch (event.key) {
            case 'Escape':
                if (engine) {
                    const isPaused = document.body.getAttribute('data-paused') === 'true';
                    if (isPaused) {
                        engine.resume();
                        document.body.setAttribute('data-paused', 'false');
                    } else {
                        engine.pause();
                        document.body.setAttribute('data-paused', 'true');
                    }
                }
                break;

            case 'F11':
                event.preventDefault();
                toggleFullscreen();
                break;

            case 'F1':
                event.preventDefault();
                showHelp();
                break;
        }
    });
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function showHelp() {
    const helpText = `
Flight Simulator Controls:
========================
Flight Controls:
  W/S - Pitch Down/Up
  A/D - Roll Left/Right
  Q/E - Yaw Left/Right
  
Throttle:
  Shift/Ctrl - Increase/Decrease
  
Systems:
  G - Landing Gear
  F - Flaps
  B - Speed Brakes
  
Camera:
  1-5 - Camera Views
  Mouse - Look Around
  
Other:
  ESC - Pause
  F1 - Help
  F11 - Fullscreen
    `;
    console.log(helpText);
    alert(helpText);
}

window.addEventListener('DOMContentLoaded', main);

window.addEventListener('resize', () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});

window.addEventListener('beforeunload', async () => {
    if (engine) {
        await engine.cleanup();
        engine = null;
    }
});

if (import.meta.hot) {
    import.meta.hot.accept();
    import.meta.hot.dispose(async () => {
        if (engine) {
            await engine.cleanup();
            engine = null;
        }
    });
}

export { engine };
