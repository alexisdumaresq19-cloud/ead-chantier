// How many PDFiums this server process keeps at once, whatever the number of
// imports. Each draws in a worker thread whose WebAssembly memory grows with
// the page (a plain sheet takes about 300 MB, a page built to exhaust it about
// 2 GB) and is never given back while that PDFium lives, so the limit holds
// for as long as a PDFium is alive, between its pages too.

/** PLAN_PAGES_AT_ONCE, read once: a whole number, at least 1; 2 when unset or unreadable. */
export function pagesAtOnce(value: string | undefined): number {
  const wanted = Math.floor(Number(value));
  if (!value?.trim() || !Number.isFinite(wanted)) return 2;
  return Math.max(1, wanted);
}

/**
 * Pages drawn at the same moment in this process, across all imports. The
 * functions of the plan-import routes need memory for this many PDFiums at
 * their largest, about 2.2 GB each, plus about 0.5 GB for the server itself.
 */
export const PAGES_AT_ONCE = pagesAtOnce(process.env.PLAN_PAGES_AT_ONCE);

/** Held while a PDFium lives; given back once, by `release`. */
export type Turn = { release: () => void };

/** Turns handed out first come, first served, at most `limit` at a time. */
export class Turns {
  private held = 0;
  private readonly queue: ((turn: Turn) => void)[] = [];

  constructor(private readonly limit: number) {}

  /** A turn now, or null when all are held. */
  tryTake(): Turn | null {
    if (this.held >= this.limit) return null;
    this.held++;
    return this.turn();
  }

  /** A turn as soon as one is free, or null after `waitMs`. */
  take(waitMs: number): Promise<Turn | null> {
    const now = this.tryTake();
    if (now || waitMs <= 0) return Promise.resolve(now);
    return new Promise((resolve) => {
      const give = (turn: Turn) => {
        clearTimeout(timer);
        resolve(turn);
      };
      const timer = setTimeout(() => {
        this.queue.splice(this.queue.indexOf(give), 1);
        resolve(null);
      }, waitMs);
      this.queue.push(give);
    });
  }

  private turn(): Turn {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        // Handed straight to the next in line, so a newcomer cannot jump the queue.
        const next = this.queue.shift();
        if (next) next(this.turn());
        else this.held--;
      },
    };
  }
}

/** This process's turns for drawing plan pages. */
export const pageTurns = new Turns(PAGES_AT_ONCE);
