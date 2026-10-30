// Entry point of the web build: the browser api first, then the app itself, which reads window.api as it loads.
import './api.js';
import '../src/renderer/app.js';
