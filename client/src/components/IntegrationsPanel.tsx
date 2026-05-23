import { ObsPanel } from './ObsPanel';
import { TwitchPanel } from './TwitchPanel';

export function IntegrationsPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ObsPanel />
      <TwitchPanel />
    </div>
  );
}
