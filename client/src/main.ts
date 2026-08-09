import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { initOnklaveBrowser } from './onklave';

// Deliberately not awaited: error tracking must never delay first render.
void initOnklaveBrowser();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
