import { Component, computed, input } from '@angular/core';

const WIDTH = 155;
const HEIGHT = 30;

/**
 * A small line of figures over time, such as a repository's commits per week, without axes, for
 * its trend alone.
 */
@Component({
  selector: 'app-sparkline',
  template: `
    <svg
      class="spark"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="none"
      focusable="false"
      aria-hidden="true"
    >
      <path [attr.d]="area()" />
      <polyline [attr.points]="line()" />
    </svg>
  `,
  styles: ':host { display: contents; }',
})
export class Sparkline {
  readonly values = input.required<number[]>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;

  private readonly points = computed(() => {
    const values = this.values();
    const highest = Math.max(1, ...values);
    const step = WIDTH / Math.max(1, values.length - 1);
    return values.map((value, index) => [
      (index * step).toFixed(1),
      (HEIGHT - 1 - (value / highest) * (HEIGHT - 4)).toFixed(1),
    ]);
  });

  protected readonly line = computed(() =>
    this.points()
      .map((point) => point.join(','))
      .join(' '),
  );

  /** The area under the line, or nothing without figures, rather than a path no browser reads. */
  protected readonly area = computed(() => {
    const points = this.points();
    return points.length === 0
      ? ''
      : `M0 ${HEIGHT}L${points.map((point) => point.join(' ')).join('L')}L${WIDTH} ${HEIGHT}Z`;
  });
}
