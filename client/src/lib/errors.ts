/**
 * Translate raw connection errors from OBS/Streamlabs into something a normal
 * user can act on. Falls through to the raw message when the pattern isn't
 * one we recognise, so nothing is ever hidden — just deprioritised.
 */

export type FriendlyError = {
  /** Human-friendly, actionable one-liner. */
  message: string;
  /** Original technical error, when different — surfaced smaller so devs can still see it. */
  detail?: string;
};

type Integration = 'obs' | 'streamlabs' | 'twitch' | 'kick';

const APP_NAME: Record<Integration, string> = {
  obs: 'OBS Studio',
  streamlabs: 'Streamlabs Desktop',
  twitch: 'Twitch',
  kick: 'Kick',
};

export function friendlyError(raw: string | undefined | null, integration: Integration): FriendlyError {
  if (!raw) return { message: 'Unknown error' };

  // ECONNREFUSED — nothing is listening on the port. Almost always means the
  // desktop app isn't running (or the WebSocket server inside it isn't on).
  if (/ECONNREFUSED/i.test(raw)) {
    const app = APP_NAME[integration];
    const hint =
      integration === 'obs'
        ? `Start ${app} and enable *Tools → WebSocket Server Settings*.`
        : integration === 'streamlabs'
          ? `Start ${app} and enable *Settings → Remote Control*.`
          : `${app} does not appear to be running.`;
    return { message: `${app} does not appear to be running. ${hint}`, detail: raw };
  }

  // ETIMEDOUT / EHOSTUNREACH — reachable in theory but the app didn't respond.
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return {
      message: `Connection to ${APP_NAME[integration]} timed out. Check the host and port in settings.`,
      detail: raw,
    };
  }

  // Wrong password / token on a local integration.
  if (/authentication failed|invalid password|invalid token|401 unauthorized/i.test(raw)) {
    return {
      message: `${APP_NAME[integration]} rejected the credentials. Double-check the password / token in settings.`,
      detail: raw,
    };
  }

  return { message: raw };
}
