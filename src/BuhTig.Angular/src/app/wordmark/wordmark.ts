import { Component } from '@angular/core';

/**
 * BuhTig's wordmark, its own (CON-10): "GitHub" turned around, with its two halves told apart
 * by color, "Buh" in the color of the text around it and "Tig" in the accent. The letters are
 * drawn, so that they look the same on every system, and sized by the `font-size` around them,
 * so that the home page shows them large and the headers small (UI-02, UI-03). Assistive
 * technology reads them as "BuhTig".
 */
@Component({
  selector: 'app-wordmark',
  templateUrl: './wordmark.html',
  styleUrl: './wordmark.css',
})
export class Wordmark {}
