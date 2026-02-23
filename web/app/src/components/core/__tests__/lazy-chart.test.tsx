import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { LazyChart } from "../lazy-chart";

// ============================
// IntersectionObserver mock
// ============================

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let observerInstances: Array<{
  callback: IntersectionCallback;
  options: IntersectionObserverInit | undefined;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}>;

function triggerIntersection(
  index: number,
  isIntersecting: boolean
) {
  const instance = observerInstances[index];
  if (!instance) throw new Error(`No observer at index ${index}`);
  instance.callback([
    { isIntersecting } as IntersectionObserverEntry,
  ]);
}

beforeEach(() => {
  observerInstances = [];

  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((callback: IntersectionCallback, options?: IntersectionObserverInit) => {
      const instance = {
        callback,
        options,
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      };
      observerInstances.push(instance);
      return instance;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================
// Helper to render and get DOM
// ============================

function renderLazyChart(props?: Partial<React.ComponentProps<typeof LazyChart>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      <LazyChart {...props}>
        <div data-testid="content">Chart Content</div>
      </LazyChart>
    );
  });

  return { container, root };
}

// ============================
// Tests
// ============================

describe("LazyChart", () => {
  it("shows skeleton placeholder initially, not children", () => {
    const { container, root } = renderLazyChart();

    // Children should NOT be in the DOM
    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    // Skeleton should be rendered (a div with class containing "skeleton" or similar)
    // The Skeleton component renders a <div>, so look for the placeholder
    const wrapper = container.querySelector("div[style]");
    expect(wrapper).not.toBeNull();

    root.unmount();
    document.body.removeChild(container);
  });

  it("renders children after intersection is triggered", () => {
    const { container, root } = renderLazyChart();

    // Initially no content
    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    // Trigger intersection
    flushSync(() => {
      triggerIntersection(0, true);
    });

    // Now children should be visible
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="content"]')!.textContent
    ).toBe("Chart Content");

    root.unmount();
    document.body.removeChild(container);
  });

  it("disconnects observer after first intersection (fire-once)", () => {
    const { container, root } = renderLazyChart();

    const observer = observerInstances[0];
    expect(observer).toBeDefined();

    // Trigger intersection
    flushSync(() => {
      triggerIntersection(0, true);
    });

    // Observer should have been disconnected
    expect(observer.disconnect).toHaveBeenCalled();

    root.unmount();
    document.body.removeChild(container);
  });

  it("keeps children mounted after observer reports not intersecting", () => {
    const { container, root } = renderLazyChart();

    // Trigger visible
    flushSync(() => {
      triggerIntersection(0, true);
    });

    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    // Observer was disconnected after first intersection, so further callbacks
    // would only happen if someone kept a reference. But even if called,
    // the state should not revert.
    // Simulate a hypothetical callback with isIntersecting: false
    flushSync(() => {
      observerInstances[0].callback([
        { isIntersecting: false } as IntersectionObserverEntry,
      ]);
    });

    // Children should STILL be mounted
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    root.unmount();
    document.body.removeChild(container);
  });

  it("does not render children when intersection is false", () => {
    const { container, root } = renderLazyChart();

    // Trigger with isIntersecting: false
    flushSync(() => {
      triggerIntersection(0, false);
    });

    // Children should still NOT be rendered
    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    root.unmount();
    document.body.removeChild(container);
  });

  it("passes rootMargin to IntersectionObserver", () => {
    const { container, root } = renderLazyChart({ rootMargin: "400px" });

    expect(observerInstances[0].options).toEqual({ rootMargin: "400px" });

    root.unmount();
    document.body.removeChild(container);
  });

  it("renders immediately when IntersectionObserver is unavailable", async () => {
    // Unstub all globals to remove the mock IntersectionObserver set in beforeEach.
    // jsdom does not provide a native IntersectionObserver, so after unstubbing
    // `"IntersectionObserver" in window` will be false.
    vi.unstubAllGlobals();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Use act-like pattern: render, then flush pending effects
    flushSync(() => {
      root.render(
        <LazyChart>
          <div data-testid="content">Fallback Content</div>
        </LazyChart>
      );
    });

    // The useEffect fallback calls setIsVisible(true) when IntersectionObserver
    // is missing. We need to wait for the state update to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {
      /* force React to flush any pending updates */
    });

    // Children should be rendered immediately (fallback path)
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    root.unmount();
    document.body.removeChild(container);
  });

  it("observes the wrapper element", () => {
    const { container, root } = renderLazyChart();

    const observer = observerInstances[0];
    expect(observer.observe).toHaveBeenCalledTimes(1);

    // The observed element should be the wrapper div
    const observedElement = observer.observe.mock.calls[0][0];
    expect(observedElement).toBeInstanceOf(HTMLDivElement);

    root.unmount();
    document.body.removeChild(container);
  });
});
