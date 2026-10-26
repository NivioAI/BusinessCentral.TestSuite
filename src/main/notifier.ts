import type { NotificationKind, NotificationSettings } from "../shared/notifications";

/** What the notifier needs from the desktop shell, so it can be tested without Electron. */
export interface NotificationHost {
  supported(): boolean;
  /** True while the app window has the focus. */
  windowFocused(): boolean;
  show(title: string, body: string): void;
}

/**
 * Local system notifications. Nothing leaves the device. Only shown when the user turned that
 * kind on and Test Suite is in the background, because otherwise the screen already says it.
 */
export class Notifier {
  constructor(
    private readonly host: NotificationHost,
    private readonly settings: () => NotificationSettings,
  ) {}

  notify(kind: NotificationKind, title: string, body: string): boolean {
    if (!this.settings()[kind]) return false;
    if (!this.host.supported() || this.host.windowFocused()) return false;
    this.host.show(title, body);
    return true;
  }
}
