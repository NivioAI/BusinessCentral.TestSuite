export interface NotificationSettings {
  runFinished: boolean;
  investigationNeedsMe: boolean;
  agentApproval: boolean;
  scheduledPlans: boolean;
}

export type NotificationKind = keyof NotificationSettings;

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  runFinished: true,
  investigationNeedsMe: true,
  agentApproval: false,
  scheduledPlans: true,
};

export function withNotificationDefaults(
  value: Partial<NotificationSettings> | undefined,
): NotificationSettings {
  return {
    runFinished: value?.runFinished ?? DEFAULT_NOTIFICATIONS.runFinished,
    investigationNeedsMe: value?.investigationNeedsMe ?? DEFAULT_NOTIFICATIONS.investigationNeedsMe,
    agentApproval: value?.agentApproval ?? DEFAULT_NOTIFICATIONS.agentApproval,
    scheduledPlans: value?.scheduledPlans ?? DEFAULT_NOTIFICATIONS.scheduledPlans,
  };
}
