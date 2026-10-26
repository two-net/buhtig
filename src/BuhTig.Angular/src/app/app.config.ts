import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { dropPreviewOnNavigation } from './preview/preview';
import { noticeSignOut } from './session/session';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([noticeSignOut])),
    provideRouter(routes, withComponentInputBinding()),
    provideAppInitializer(dropPreviewOnNavigation),
  ],
};
