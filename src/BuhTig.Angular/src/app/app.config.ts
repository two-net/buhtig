import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { focusPageOnNavigation } from './focus/page-focus';
import { Motion } from './motion/motion';
import { dropPreviewOnNavigation } from './preview/preview';
import { noticeSignOut } from './session/session';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([noticeSignOut])),
    provideRouter(routes, withComponentInputBinding()),
    provideAppInitializer(dropPreviewOnNavigation),
    provideAppInitializer(focusPageOnNavigation),
    // So that the page keeps still from the start, if it is to (FR-ANIM-10).
    provideAppInitializer(() => void inject(Motion)),
  ],
};
