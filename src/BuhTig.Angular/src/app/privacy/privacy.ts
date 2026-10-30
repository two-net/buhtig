import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../header/header';
import { PageStyles } from '../styles/styles';

/** What BuhTig keeps, why, for how long, and how to delete it (NFR-PRIV-03). */
@Component({
  selector: 'app-privacy',
  imports: [Header, PageStyles, RouterLink],
  templateUrl: './privacy.html',
})
export class Privacy {}
