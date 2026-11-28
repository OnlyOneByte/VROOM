export interface FakeOidcUser {
  sub: string;
  email: string;
  email_verified?: boolean | string;
  name?: string;
}

export interface FakeOidcIssuer {
  issuer: string;
  user: FakeOidcUser;
  tokenRequests: URLSearchParams[];
  discoveryIssuer?: string;
  stop: () => void;
}

export function startFakeOidcIssuer(user: FakeOidcUser): FakeOidcIssuer {
  const state: FakeOidcIssuer = { issuer: '', user, tokenRequests: [], stop: () => {} };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: state.discoveryIssuer ?? state.issuer,
          authorization_endpoint: `${state.issuer}/authorize`,
          token_endpoint: `${state.issuer}/token`,
          userinfo_endpoint: `${state.issuer}/userinfo`,
        });
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        state.tokenRequests.push(new URLSearchParams(await request.text()));
        return Response.json({ access_token: 'fake-access-token', token_type: 'Bearer' });
      }
      if (url.pathname === '/userinfo') {
        return request.headers.get('authorization') === 'Bearer fake-access-token'
          ? Response.json(state.user)
          : new Response('unauthorized', { status: 401 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  state.issuer = `http://127.0.0.1:${server.port}`;
  state.stop = () => server.stop(true);
  return state;
}
