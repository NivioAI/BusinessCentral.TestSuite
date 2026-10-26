import { describe, expect, it, vi } from "vitest";
import { type NotificationHost, Notifier } from "../src/main/notifier";
import { DEFAULT_NOTIFICATIONS, withNotificationDefaults } from "../src/shared/notifications";

function setup(
  options: {
    supported?: boolean;
    focused?: boolean;
    settings?: Partial<typeof DEFAULT_NOTIFICATIONS>;
  } = {},
) {
  const show = vi.fn();
  const host: NotificationHost = {
    supported: () => options.supported ?? true,
    windowFocused: () => options.focused ?? false,
    show,
  };
  const notifier = new Notifier(host, () => ({ ...DEFAULT_NOTIFICATIONS, ...options.settings }));
  return { notifier, show };
}

describe("Notifier", () => {
  it("shows a notification when the kind is on and the app is in the background", () => {
    const { notifier, show } = setup();
    expect(notifier.notify("runFinished", "BC-001 passed", "Post invoice on Sandbox")).toBe(true);
    expect(show).toHaveBeenCalledWith("BC-001 passed", "Post invoice on Sandbox");
  });

  it("stays quiet while the app has the focus", () => {
    const { notifier, show } = setup({ focused: true });
    expect(notifier.notify("runFinished", "t", "b")).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it("respects the per-kind switches", () => {
    const { notifier, show } = setup({ settings: { runFinished: false } });
    expect(notifier.notify("runFinished", "t", "b")).toBe(false);
    expect(notifier.notify("investigationNeedsMe", "t", "b")).toBe(true);
    expect(notifier.notify("agentApproval", "t", "b")).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the system has no notification support", () => {
    const { notifier, show } = setup({ supported: false });
    expect(notifier.notify("runFinished", "t", "b")).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it("reads the settings at the moment of the event", () => {
    let on = true;
    const show = vi.fn();
    const notifier = new Notifier(
      { supported: () => true, windowFocused: () => false, show },
      () => ({ ...DEFAULT_NOTIFICATIONS, runFinished: on }),
    );
    expect(notifier.notify("runFinished", "t", "b")).toBe(true);
    on = false;
    expect(notifier.notify("runFinished", "t", "b")).toBe(false);
  });
});

describe("withNotificationDefaults", () => {
  it("fills what is missing and keeps what is set", () => {
    expect(withNotificationDefaults(undefined)).toEqual(DEFAULT_NOTIFICATIONS);
    expect(withNotificationDefaults({ agentApproval: true, scheduledPlans: true })).toEqual({
      ...DEFAULT_NOTIFICATIONS,
      agentApproval: true,
      scheduledPlans: true,
    });
    expect(withNotificationDefaults({ runFinished: false }).runFinished).toBe(false);
  });
});
