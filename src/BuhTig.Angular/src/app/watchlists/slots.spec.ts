import { Observable, Subject, defer, tap } from 'rxjs';
import { MAX_AT_ONCE, Slots } from './slots';

describe('Slots', () => {
  let slots: Slots;
  /** The requests that have been made, in the order they were. */
  let started: number[];
  /** How many requests are on their way, and the most that ever were at once. */
  let inFlight: number;
  let peak: number;
  let subjects: Subject<string>[];

  beforeEach(() => {
    slots = new Slots();
    started = [];
    inFlight = 0;
    peak = 0;
    subjects = Array.from({ length: 8 }, () => new Subject<string>());
  });

  /** The request `index`, which counts itself on its way from when it is made until it ends. */
  function request(index: number): Observable<string> {
    return defer(() => {
      started.push(index);
      inFlight++;
      peak = Math.max(peak, inFlight);
      const end = () => inFlight--;
      return subjects[index].pipe(tap({ complete: end, error: end, unsubscribe: end }));
    });
  }

  function answer(index: number, value: string): void {
    subjects[index].next(value);
    subjects[index].complete();
  }

  it('lets no more than 4 requests be on their way at once, the rest wait in turn (FR-PERS-09)', () => {
    expect(MAX_AT_ONCE).toBe(4);
    const answers: string[] = [];
    for (let index = 0; index < 6; index++) {
      slots.run(request(index)).subscribe((value) => answers.push(value));
    }
    expect(started).toEqual([0, 1, 2, 3]);

    answer(2, 'two');
    expect(answers).toEqual(['two']);
    expect(started).toEqual([0, 1, 2, 3, 4]);

    answer(0, 'zero');
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);

    for (const index of [1, 3, 4, 5]) {
      answer(index, `${index}`);
    }
    expect(answers).toEqual(['two', 'zero', '1', '3', '4', '5']);
    expect(peak).toBe(4);
    expect(inFlight).toBe(0);
  });

  it('frees a slot when a request fails, and passes the failure on', () => {
    const failures: unknown[] = [];
    for (let index = 0; index < 5; index++) {
      slots.run(request(index)).subscribe({ error: (error) => failures.push(error) });
    }
    expect(started).toEqual([0, 1, 2, 3]);
    subjects[1].error('broken');
    expect(failures).toEqual(['broken']);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(4);
  });

  it('frees a slot, or gives up its turn, once nothing waits for a request', () => {
    const made = Array.from({ length: 6 }, (_, index) => slots.run(request(index)).subscribe());
    expect(started).toEqual([0, 1, 2, 3]);

    // A request that waits for a slot, and is no longer wanted, is never made.
    made[4].unsubscribe();
    // One on its way, no longer wanted, is dropped, and its slot goes to the next that waits.
    made[0].unsubscribe();
    expect(inFlight).toBe(4);
    expect(started).toEqual([0, 1, 2, 3, 5]);

    answer(1, 'one');
    answer(2, 'two');
    expect(started).toEqual([0, 1, 2, 3, 5]);
    expect(peak).toBe(4);
  });

  it('makes a request again each time it is subscribed to, as a retry does', () => {
    const asked = slots.run(request(0));
    asked.subscribe().unsubscribe();
    asked.subscribe();
    expect(started).toEqual([0, 0]);
    expect(inFlight).toBe(1);
  });
});
