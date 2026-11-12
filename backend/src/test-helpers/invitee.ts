import { expect } from 'bun:test';
import { type DataEnvelope, json, type RequestFn, requestAs, type TestApp } from './http-client';

export interface Invitee {
  id: string;
  email: string;
  cookie: string;
  request: RequestFn;
  acceptShare(vehicleId: string, level: 'viewer' | 'editor'): Promise<void>;
}

let inviteeCounter = 0;

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
