/**
 * Unit tests for the PGlite write lock.
 */
import { describe, expect, it } from "vitest";
import { WriteLock } from "./write-lock";

describe("WriteLock", () => {
  it("grants an uncontended acquire immediately", async () => {
    const lock = new WriteLock();
    await expect(lock.acquire()).resolves.toBeUndefined();
    lock.release();
  });

  it("serves background waiters in FIFO order", async () => {
    const lock = new WriteLock();
    const order: number[] = [];

    await lock.acquire(); // holder
    const a = lock.acquire().then(() => order.push(1));
    const b = lock.acquire().then(() => order.push(2));
    const c = lock.acquire().then(() => order.push(3));

    lock.release();
    lock.release();
    lock.release();

    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("lets a foreground waiter jump the background FIFO queue", async () => {
    const lock = new WriteLock();
    const order: string[] = [];

    await lock.acquire(); // holder
    const background = lock.acquire().then(() => order.push("bg-1"));
    const foreground = lock.acquire("foreground").then(() => order.push("fg"));
    const background2 = lock.acquire().then(() => order.push("bg-2"));

    lock.release();
    lock.release();
    lock.release();

    await Promise.all([background, foreground, background2]);
    expect(order).toEqual(["fg", "bg-1", "bg-2"]);
  });

  it("supports cooperative background pause and resume", async () => {
    const lock = new WriteLock();

    expect(lock.isBackgroundPaused()).toBe(false);
    lock.pauseBackground();
    expect(lock.isBackgroundPaused()).toBe(true);
    lock.resumeBackground();
    expect(lock.isBackgroundPaused()).toBe(false);
  });

  it("release is a safe no-op when nothing is waiting", () => {
    const lock = new WriteLock();
    expect(() => lock.release()).not.toThrow();
  });
});
