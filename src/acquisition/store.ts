import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AcquisitionRecord } from './contracts.js';

export interface AcquisitionStore {
  get(acquisitionId: string): Promise<AcquisitionRecord | undefined>;
  list(): Promise<readonly AcquisitionRecord[]>;
  put(record: AcquisitionRecord): Promise<void>;
}

export class MemoryAcquisitionStore implements AcquisitionStore {
  readonly #records = new Map<string, AcquisitionRecord>();

  async get(acquisitionId: string): Promise<AcquisitionRecord | undefined> {
    const value = this.#records.get(acquisitionId);
    return value === undefined ? undefined : structuredClone(value);
  }

  async list(): Promise<readonly AcquisitionRecord[]> {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  async put(record: AcquisitionRecord): Promise<void> {
    this.#records.set(record.acquisitionId, structuredClone(record));
  }
}

export class JsonFileAcquisitionStore implements AcquisitionStore {
  readonly #path: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async #read(): Promise<Record<string, AcquisitionRecord>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid acquisition store');
      return parsed as Record<string, AcquisitionRecord>;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  async get(acquisitionId: string): Promise<AcquisitionRecord | undefined> {
    await this.#queue;
    const value = (await this.#read())[acquisitionId];
    return value === undefined ? undefined : structuredClone(value);
  }

  async list(): Promise<readonly AcquisitionRecord[]> {
    await this.#queue;
    return Object.values(await this.#read()).map((record) => structuredClone(record));
  }

  async put(record: AcquisitionRecord): Promise<void> {
    const write = async () => {
      const records = await this.#read();
      records[record.acquisitionId] = structuredClone(record);
      await mkdir(dirname(this.#path), { recursive: true });
      const temporaryPath = `${this.#path}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.#path);
    };
    this.#queue = this.#queue.then(write, write);
    await this.#queue;
  }
}
