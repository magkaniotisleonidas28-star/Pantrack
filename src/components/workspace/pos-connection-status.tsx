import type {PosAvailability} from '@/lib/pos-provider-status';

export default function PosConnectionStatus({name, availability}: {name: string; availability: PosAvailability}) {
  const {native} = availability;
  const label = native.state === 'setup_required' ? 'setup required' : native.state === 'degraded' ? 'needs review' : native.state;
  return <div aria-live="polite">
    <p><strong>{name}: {label}</strong></p>
    {native.reason === 'adapter_not_implemented'
      ? <p>Not available yet. Use CSV imports for now.</p>
      : native.reason === 'status_unavailable'
        ? <p>Couldn’t check the connection. Refresh to try again.</p>
        : native.state === 'setup_required'
          ? <p>An owner needs to finish setup or reconnect.</p>
          : native.state === 'disconnected'
            ? <p>Connect to start syncing sales.</p>
            : <p>Sales sync: {native.sync === 'paused' ? 'paused' : native.sync === 'ready' ? 'ready for manual sync' : 'needs review'}. {native.state === 'degraded' && 'Check paused sales.'}</p>}
    {native.sandboxAccepted && <p><small>Clover sandbox validation recorded.</small></p>}
    <p><small>CSV import available. Bridge: {availability.fallbacks.bridge === 'disabled' ? 'not set up' : availability.fallbacks.bridge === 'configured' ? 'set up, nothing received yet' : 'set up and receiving'}.</small></p>
  </div>;
}
