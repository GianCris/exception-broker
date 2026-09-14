import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LiveControlSession } from './contracts.js';

export interface LiveControlStore { get(id: string): Promise<LiveControlSession | undefined>; put(record: LiveControlSession): Promise<void>; }
export class MemoryLiveControlStore implements LiveControlStore {
  readonly #records = new Map<string, LiveControlSession>();
  async get(id: string) { const value = this.#records.get(id); return value === undefined ? undefined : structuredClone(value); }
  async put(record: LiveControlSession) { this.#records.set(record.controlSessionId, structuredClone(record)); }
}
export class JsonFileLiveControlStore implements LiveControlStore {
  readonly #path: string; #queue: Promise<void> = Promise.resolve();
  constructor(path: string) { this.#path = path; }
  async #read(): Promise<Record<string, LiveControlSession>> {
    try { const value: unknown = JSON.parse(await readFile(this.#path, 'utf8')); if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid control store'); return value as Record<string, LiveControlSession>; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  async get(id: string) { await this.#queue; const value = (await this.#read())[id]; return value === undefined ? undefined : structuredClone(value); }
  async put(record: LiveControlSession) {
    const write = async () => { const records = await this.#read(); records[record.controlSessionId] = structuredClone(record); await mkdir(dirname(this.#path), { recursive: true }); const temporary = `${this.#path}.tmp`; await writeFile(temporary, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, this.#path); };
    this.#queue = this.#queue.then(write, write); await this.#queue;
  }
}
