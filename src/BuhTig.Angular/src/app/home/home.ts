import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account } from '../account/account';
import { Search } from '../search/search';
import { Shortcuts } from '../shortcuts/shortcuts';

/**
 * The home page, after a search engine's (§3.1): the wordmark, the search box, and the
 * signed-in user's shortcuts, with "Sign in" or the avatar menu above and links to About and
 * Privacy below (UI-02, UI-08).
 */
@Component({
  selector: 'app-home',
  imports: [Account, RouterLink, Search, Shortcuts],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {}
