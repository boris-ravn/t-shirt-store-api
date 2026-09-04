import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { hashToken } from '../src/common/crypto/token.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp, teardownE2eApp } from './support/e2e-app';
import { signUpPayload } from './support/fixtures';

// Response-body shapes as they cross the wire (JSON), used only to type
// supertest's otherwise-`any` `.body` — not the same identifiers as the
// source DTOs, since e.g. Date becomes a string over HTTP.
interface AuthSessionBody {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Record<string, unknown>;
}

interface ProblemBody {
  status: number;
  title: string;
  [extension: string]: unknown;
}

jest.setTimeout(120_000);

describe('Auth (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication<Server>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma, container } = await bootstrapE2eApp());
  });

  afterAll(async () => {
    await teardownE2eApp({ app, prisma, container });
  });

  it('signs up, signs in, refreshes (rotating the token), and signs out — asserting HTTP responses and that refresh_tokens.revoked_at is set after sign-out, not just the 204', async () => {
    const agent = request(app.getHttpServer());
    const credentials = signUpPayload('auth-e2e');

    const signUp = await agent.post('/v1/auth/sign-up').send(credentials);
    const signUpBody = signUp.body as AuthSessionBody;
    expect(signUp.status).toBe(201);
    expect(signUpBody).toMatchObject({
      accessToken: expect.any(String) as string,
      refreshToken: expect.any(String) as string,
      expiresIn: expect.any(Number) as number,
      user: expect.objectContaining({
        email: credentials.email,
        firstName: credentials.firstName,
        lastName: credentials.lastName,
      }) as Record<string, unknown>,
    });
    expect(signUpBody.user).not.toHaveProperty('passwordHash');

    const signIn = await agent.post('/v1/auth/sign-in').send({
      email: credentials.email,
      password: credentials.password,
    });
    const signInBody = signIn.body as AuthSessionBody;
    expect(signIn.status).toBe(200);
    expect(signInBody.refreshToken).toEqual(expect.any(String));

    const refreshed = await agent
      .post('/v1/auth/refresh')
      .send({ refreshToken: signInBody.refreshToken });
    const refreshedBody = refreshed.body as AuthSessionBody;
    expect(refreshed.status).toBe(200);
    // Rotation issues a brand new refresh token and invalidates the one spent.
    expect(refreshedBody.refreshToken).not.toBe(signInBody.refreshToken);

    const reuseRotatedToken = await agent
      .post('/v1/auth/refresh')
      .send({ refreshToken: signInBody.refreshToken });
    expect(reuseRotatedToken.status).toBe(401);
    expect(reuseRotatedToken.body as ProblemBody).toMatchObject({
      status: 401,
      title: 'Invalid refresh token',
    });

    const signOut = await agent
      .post('/v1/auth/sign-out')
      .set('Authorization', `Bearer ${refreshedBody.accessToken}`)
      .send({ refreshToken: refreshedBody.refreshToken });
    expect(signOut.status).toBe(204);

    const tokenHash = hashToken(refreshedBody.refreshToken);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    expect(row).not.toBeNull();
    expect(row?.revokedAt).not.toBeNull();

    // Signing out again with the now-revoked token must fail, not silently
    // succeed a second time.
    const signOutAgain = await agent
      .post('/v1/auth/sign-out')
      .set('Authorization', `Bearer ${refreshedBody.accessToken}`)
      .send({ refreshToken: refreshedBody.refreshToken });
    expect(signOutAgain.status).toBe(401);
  });

  it('rejects sign-up with an already-registered email (409) and does not create a duplicate account', async () => {
    const agent = request(app.getHttpServer());
    const credentials = signUpPayload('auth-e2e');

    await agent.post('/v1/auth/sign-up').send(credentials).expect(201);
    const duplicate = await agent.post('/v1/auth/sign-up').send(credentials);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body as ProblemBody).toMatchObject({
      status: 409,
      title: 'Email already registered',
    });

    const accountCount = await prisma.user.count({
      where: { email: credentials.email },
    });
    expect(accountCount).toBe(1);
  });

  it('rejects sign-in with a wrong password or an unknown email with the same 401 body, so the response cannot be used to enumerate accounts', async () => {
    const agent = request(app.getHttpServer());
    const credentials = signUpPayload('auth-e2e');
    await agent.post('/v1/auth/sign-up').send(credentials).expect(201);

    const wrongPassword = await agent.post('/v1/auth/sign-in').send({
      email: credentials.email,
      password: 'not-the-right-password',
    });
    const unknownEmail = await agent.post('/v1/auth/sign-in').send({
      email: signUpPayload('auth-e2e').email,
      password: credentials.password,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body as ProblemBody).toStrictEqual(
      unknownEmail.body as ProblemBody,
    );
  });

  it('rejects sign-out for a request with no access token (401), before it ever looks at the refresh token', async () => {
    const agent = request(app.getHttpServer());

    const signOut = await agent
      .post('/v1/auth/sign-out')
      .send({ refreshToken: 'irrelevant-because-unauthenticated' });

    expect(signOut.status).toBe(401);
  });
});
