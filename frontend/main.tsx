import * as ui from './ui';
import '../public/style.css';
import './ui/controls.css';
declare global { interface Window { rimeUI: typeof ui } }
window.rimeUI = ui;
await import('../public/app.js');
