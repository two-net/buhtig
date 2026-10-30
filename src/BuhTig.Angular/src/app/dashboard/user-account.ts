import { Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { Avatar, avatarOf } from '../avatar/avatar';
import { Center } from '../center/center';
import { NO_USER_REPOSITORIES, OPEN_A_REPOSITORY, SEARCH_AGAIN, userAccount } from './messages';
import { Resources } from './resources';

/**
 * What an organization's dashboard shows when its name is a user's (FR-SRCH-06): BuhTig has no
 * dashboards for users, so it offers some of the user's repositories instead, those pushed to
 * last.
 */
@Component({
  selector: 'app-user-account',
  imports: [Avatar, Center, RouterLink],
  template: `
    @let names = repositories();
    <app-center
      icon="user"
      [heading]="userAccount(login())"
      [text]="names?.length === 0 ? NO_USER_REPOSITORIES : OPEN_A_REPOSITORY"
    >
      @if (names && names.length > 0) {
        <div class="row">
          @for (name of names; track name) {
            <a class="chip" [routerLink]="'/' + name">
              <app-avatar [name]="login()" [src]="avatar(login())" [round]="true" />
              <span>{{ name }}</span>
            </a>
          }
        </div>
      }
      <div class="row">
        <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
      </div>
    </app-center>
  `,
})
export class UserAccount {
  /** The user's login, as the URL has it. */
  readonly login = input.required<string>();

  private readonly resources = inject(Resources);

  /** Some of the user's repositories, `owner/repo`, once BuhTig knows, or none if it cannot say. */
  protected readonly repositories = toSignal(
    toObservable(this.login).pipe(
      switchMap((login) =>
        this.resources.userRepositories(login).pipe(catchError(() => of<string[]>([]))),
      ),
    ),
  );

  protected avatar(login: string): string {
    return avatarOf(login, 20);
  }

  protected readonly userAccount = userAccount;
  protected readonly OPEN_A_REPOSITORY = OPEN_A_REPOSITORY;
  protected readonly NO_USER_REPOSITORIES = NO_USER_REPOSITORIES;
  protected readonly SEARCH_AGAIN = SEARCH_AGAIN;
}
