import { redactFeedTokens } from '../api/calendar/routes';

const SENSITIVE_PARAM =
  /([?&](?:code|state|session_state|error_description|token|access_token|id_token)=)[^&\s#]*/gi;

export function redactRequestLine(text: string): string {
  return redactFeedTokens(text).replace(SENSITIVE_PARAM, '$1[redacted]');
}
