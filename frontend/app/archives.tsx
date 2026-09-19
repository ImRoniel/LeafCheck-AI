import { Action, Notice, Screen } from '@/components/screen';
export default function Archives() { return <Screen title="Archives" back><Notice>The API does not support archiving or restoring plants or spaces.</Notice><Action label="Restore — unavailable" disabled /></Screen>; }
