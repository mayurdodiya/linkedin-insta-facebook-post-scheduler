/** Minimal stand-in for Nest's Logger. */
export class Logger {
  constructor(private readonly ctx: string) {}
  log(msg: string) {
    console.log(`[${this.ctx}] ${msg}`);
  }
  warn(msg: string) {
    console.warn(`[${this.ctx}] ${msg}`);
  }
  error(msg: string) {
    console.error(`[${this.ctx}] ${msg}`);
  }
}
