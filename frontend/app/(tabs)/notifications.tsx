import { Action, Notice, Screen } from '@/components/screen';
export default function Notifications() { return <Screen title="Notifications"><Notice>Notifications are not supported by the current API. No alerts or unread counts are fabricated.</Notice><Action label="Notification preferences — unavailable" disabled /></Screen>; }
