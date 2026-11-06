/**
 * In-memory stand-in for the parts of the Admin Firestore API the analysis
 * route uses: doc get/set/update, where().limit().get(), and serialized
 * runTransaction (like Firestore's server-side locking). Tests only.
 */
type Data = Record<string, unknown>;

export interface FakeWrite {
  op: "set" | "update";
  collection: string;
  id: string;
  data: Data;
}

export class FakeFirestore {
  docs = new Map<string, Data>();
  writes: FakeWrite[] = [];
  /** Collections whose reads and writes throw this error. */
  failures = new Map<string, unknown>();
  /** Collections whose writes (only) throw this error. */
  writeFailures = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();

  seed(collection: string, id: string, data: Data) {
    this.docs.set(`${collection}/${id}`, data);
  }

  read(collection: string, id: string): Data | undefined {
    return this.docs.get(`${collection}/${id}`);
  }

  writesTo(collection: string): FakeWrite[] {
    return this.writes.filter((w) => w.collection === collection);
  }

  private check(collection: string) {
    if (this.failures.has(collection)) throw this.failures.get(collection);
  }

  private snapshot(collection: string, id: string) {
    this.check(collection);
    const data = this.read(collection, id);
    return { id, exists: data !== undefined, data: () => data };
  }

  /** Throws if this write would fail, without applying it. */
  private checkWrite(op: FakeWrite["op"], collection: string, id: string) {
    this.check(collection);
    if (this.writeFailures.has(collection)) throw this.writeFailures.get(collection);
    if (op === "update" && !this.docs.has(`${collection}/${id}`)) {
      throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
    }
  }

  private write(op: FakeWrite["op"], collection: string, id: string, data: Data, merge = false) {
    this.checkWrite(op, collection, id);
    const path = `${collection}/${id}`;
    const existing = this.docs.get(path);
    this.docs.set(path, op === "update" || merge ? { ...existing, ...data } : { ...data });
    this.writes.push({ op, collection, id, data });
  }

  collection(name: string) {
    return {
      doc: (id: string) => ({
        __collection: name,
        id,
        get: async () => this.snapshot(name, id),
        set: async (data: Data, options?: { merge?: boolean }) => this.write("set", name, id, data, options?.merge),
        update: async (data: Data) => this.write("update", name, id, data),
      }),
      where: (field: string, _op: "==", value: unknown) => ({
        limit: (max: number) => ({
          get: async () => {
            this.check(name);
            const docs = [...this.docs.entries()]
              .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
              .slice(0, max)
              .map(([path, data]) => ({ id: path.slice(name.length + 1), data: () => data }));
            return { docs };
          },
        }),
      }),
    };
  }

  /**
   * Runs transactions one at a time. Writes are buffered and applied only if
   * fn succeeds and every write can succeed: all or nothing, like Firestore.
   */
  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      type Ref = { __collection: string; id: string };
      const pending: Array<{ op: FakeWrite["op"]; ref: Ref; data: Data; merge?: boolean }> = [];
      const tx: FakeTransaction = {
        get: async (ref: Ref) => this.snapshot(ref.__collection, ref.id),
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => {
          pending.push({ op: "set", ref, data, merge: options?.merge });
        },
        update: (ref: Ref, data: Data) => {
          pending.push({ op: "update", ref, data });
        },
      };
      const result = await fn(tx);
      pending.forEach((w) => this.checkWrite(w.op, w.ref.__collection, w.ref.id));
      pending.forEach((w) => this.write(w.op, w.ref.__collection, w.ref.id, w.data, w.merge));
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export interface FakeTransaction {
  get(ref: unknown): Promise<{ id: string; exists: boolean; data: () => Data | undefined }>;
  set(ref: unknown, data: Data, options?: { merge?: boolean }): void;
  update(ref: unknown, data: Data): void;
}
