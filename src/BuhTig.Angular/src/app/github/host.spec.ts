import { TestBed } from '@angular/core/testing';
import { GITHUB_COM, GITHUB_HOST } from './host';

describe('GITHUB_HOST (CON-09)', () => {
  afterEach(() => {
    document.head.querySelector('meta[name="buhtig-github-host"]')?.remove();
  });

  it('is github.com unless the server names another', () => {
    expect(TestBed.inject(GITHUB_HOST)).toBe(GITHUB_COM);
  });

  it("is the host that the server names, BuhTig's github.host, in lowercase", () => {
    const tag = document.createElement('meta');
    tag.name = 'buhtig-github-host';
    tag.content = 'GHE.example.com';
    document.head.append(tag);
    expect(TestBed.inject(GITHUB_HOST)).toBe('ghe.example.com');
  });
});
