// Simplified main entry for CI testing
console.info('Flight Simulator - CI Test Build');

// Basic initialization
const app = document.getElementById('app');
if (app) {
    app.innerHTML = '<h1>Flight Simulator</h1><p>CI Build Test</p>';
}

export { app };
