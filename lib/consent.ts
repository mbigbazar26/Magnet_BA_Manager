import {DeskError} from './meta';

export const CONSENT_STATES = ['PENDING', 'OPTED_IN', 'OPTED_OUT'] as const;
export type ConsentStatus = typeof CONSENT_STATES[number];
export type ReplyMapping = {acceptButton: number; declineButton: number; acceptLabel: string; declineLabel: string; acceptWords: string[]; declineWords: string[]};
export function normalizeReply(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'); }

export function replyWords(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(word => typeof word !== 'string' || !word.trim() || word.length > 120)) {
    throw new DeskError('Use up to 20 exact reply phrases, each up to 120 characters.');
  }
  return [...new Set((raw as string[]).map(normalizeReply))];
}

export function replyMapping(raw: unknown): ReplyMapping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!Number.isInteger(value.acceptButton) || !Number.isInteger(value.declineButton)
    || Number(value.acceptButton) < 0 || Number(value.declineButton) < 0 || Number(value.acceptButton) > 9 || Number(value.declineButton) > 9
    || value.acceptButton === value.declineButton || typeof value.acceptLabel !== 'string' || typeof value.declineLabel !== 'string') return null;
  try { return {...value, acceptWords: replyWords(value.acceptWords ?? []), declineWords: replyWords(value.declineWords ?? [])} as ReplyMapping; } catch { return null; }
}

export function decideReply(type: string, body: string, payload: string, mapping: ReplyMapping | null, outgoingId?: string): ConsentStatus | null {
  const text = normalizeReply(body);
  if (/^(stop|unsubscribe)$/.test(text)) return 'OPTED_OUT';
  if (!mapping) return null;
  if (type === 'button' || type === 'interactive') {
    const parsed = /^desk_reply:([^:]+):(\d+)$/.exec(payload);
    if (parsed) {
      if (parsed[1] !== outgoingId) return null;
      const index = Number(parsed[2]);
      if (index === mapping.declineButton && text === normalizeReply(mapping.declineLabel)) return 'OPTED_OUT';
      if (index === mapping.acceptButton && text === normalizeReply(mapping.acceptLabel)) return 'OPTED_IN';
      return null;
    }
    // A verified reply to an older, recorded initial template can lack our custom payload.
    if (text === normalizeReply(mapping.declineLabel)) return 'OPTED_OUT';
    if (text === normalizeReply(mapping.acceptLabel)) return 'OPTED_IN';
  }
  if (type === 'text') {
    if (mapping.declineWords.includes(text)) return 'OPTED_OUT';
    if (mapping.acceptWords.includes(text)) return 'OPTED_IN';
  }
  return null;
}

export function eligibleContact(contact: {consent: boolean; consentStatus: string}, purpose: string) {
  return purpose === 'OPT_IN' ? contact.consentStatus !== 'OPTED_OUT' : contact.consent && contact.consentStatus === 'OPTED_IN';
}
