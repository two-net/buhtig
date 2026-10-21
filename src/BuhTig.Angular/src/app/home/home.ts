import { Component } from '@angular/core';
import { Search } from '../search/search';

/** The home page: the wordmark and the search box. */
@Component({
  selector: 'app-home',
  imports: [Search],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {}
