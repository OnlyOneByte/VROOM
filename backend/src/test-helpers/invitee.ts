// A second signed-in user for cross-user and shared-vehicle tests.

import { expect } from 'bun:test';
import { type DataEnvelope, json, type RequestFn, requestAs, type TestApp } from './http-client';

export interface Invitee {
  id: string;
  email: string;
  /** Session cookie, for requests the JSON helper cannot send (multipart uploads). */
  cookie: string;
  /** Sends a JSON request authenticated as the invitee. */
  request: RequestFn;
  /** The owner (ctx user) shares the vehicle at `level`, and the invitee accepts. */
  acceptShare(vehicleId: string, level: 'viewer' | 'editor'): Promise<void>;
}

let inviteeCounter = 0;

/** Creates a second user with a live session, to act as the invitee on the owner's shared vehicles. */
export async function createInvitee(
  ctx: TestApp,
  idPrefix: string,
  displayName?: string
): Promise<Invitee> {
  const { db } = await import('../db/connection');
  const schema = await import('../db/schema');

  const n = ++inviteeCounter;
  const id = `${idPrefix}-${n}`;
  const email = `${idPrefix}-${n}@test.com`;
  await db.insert(schema.users).values({ id, email, displayName: displayName ?? `Invitee ${n}` });
  const { cookie, request } = await requestAs(ctx, id);

  const acceptShare = async (vehicleId: string, level: 'viewer' | 'editor'): Promise<void> => {
    const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email, level });
    const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
    expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
    const accepted = await request('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
    expect(accepted.status, 'invitee accepts the share').toBe(200);
  };

  return { id, email, cookie, request, acceptShare };
}
