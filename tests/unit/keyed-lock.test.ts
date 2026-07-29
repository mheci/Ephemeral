import { describe, expect, it } from "vitest";
import { KeyedLock } from "../../src/background/keyed-lock";

describe("KeyedLock", () => {
  it("serializes the same key and frees its queue", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = lock.run("a", async () => {
      order.push("first:start");
      markStarted();
      await gate;
      order.push("first:end");
    });
    const second = lock.run("a", async () => {
      order.push("second");
    });
    await started;
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(lock.size()).toBe(0);
  });

  it("does not block different keys", async () => {
    const lock = new KeyedLock();
    const values = await Promise.all([
      lock.run("a", async () => "a"),
      lock.run("b", async () => "b"),
    ]);
    expect(values).toEqual(["a", "b"]);
  });
});
