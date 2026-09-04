import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { UserRole } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp, teardownE2eApp } from './support/e2e-app';
import { signUpPayload } from './support/fixtures';

jest.setTimeout(120_000);

interface AuthSessionBody {
  accessToken: string;
}

interface ProblemBody {
  status: number;
  title: string;
  [extension: string]: unknown;
}

interface CategoryBody {
  id: string;
  name: string;
  slug: string;
}

interface ProductBody {
  id: string;
  name: string;
}

interface SkuBody {
  id: string;
  skuCode: string;
  stock: number;
}

describe('Catalog (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let managerToken: string;
  let clientToken: string;

  beforeAll(async () => {
    ({ app, prisma, container } = await bootstrapE2eApp());

    // Sign-up always creates a Client; manager/delivery-person accounts are
    // provisioned out of band (README's Roles section) — modelled here by
    // signing up normally, then flipping the role directly in the DB, then
    // signing in again so the fresh JWT actually carries the new role
    // (JwtStrategy trusts the role embedded at issue time, not a live
    // per-request DB read — decisions.md).
    const managerCreds = signUpPayload('catalog-e2e');
    await request(app.getHttpServer())
      .post('/v1/auth/sign-up')
      .send(managerCreds)
      .expect(201);
    await prisma.user.update({
      where: { email: managerCreds.email },
      data: { role: UserRole.manager },
    });
    const managerSignIn = await request(app.getHttpServer())
      .post('/v1/auth/sign-in')
      .send({ email: managerCreds.email, password: managerCreds.password });
    managerToken = (managerSignIn.body as AuthSessionBody).accessToken;

    const clientCreds = signUpPayload('catalog-e2e');
    const clientSignUp = await request(app.getHttpServer())
      .post('/v1/auth/sign-up')
      .send(clientCreds);
    clientToken = (clientSignUp.body as AuthSessionBody).accessToken;
  });

  afterAll(async () => {
    await teardownE2eApp({ app, prisma, container });
  });

  async function createCategory() {
    const response = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: `Cat ${randomUUID()}`, slug: `cat-${randomUUID()}` });
    return response.body as CategoryBody;
  }

  async function createProduct(categoryId: string) {
    const response = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ categoryId, name: `Product ${randomUUID()}` });
    return response.body as ProductBody;
  }

  function postSku(productId: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/v1/skus')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        productId,
        skuCode: `SKU-${randomUUID()}`,
        size: 'M',
        color: 'black',
        price: { amount: 1999, currency: 'USD' },
        stock: 10,
        ...overrides,
      });
  }

  async function createSku(
    productId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await postSku(productId, overrides);
    return response.body as SkuBody;
  }

  describe('categories', () => {
    it('lists and gets categories publicly, without auth', async () => {
      const category = await createCategory();

      const list = await request(app.getHttpServer()).get('/v1/categories');
      expect(list.status).toBe(200);
      expect(
        (list.body as { data: CategoryBody[] }).data.some(
          (row) => row.id === category.id,
        ),
      ).toBe(true);

      const byId = await request(app.getHttpServer()).get(
        `/v1/categories/${category.id}`,
      );
      expect(byId.status).toBe(200);
      expect((byId.body as CategoryBody).id).toBe(category.id);
    });

    it('returns 404 for a missing category', async () => {
      const response = await request(app.getHttpServer()).get(
        `/v1/categories/${randomUUID()}`,
      );
      expect(response.status).toBe(404);
    });

    it('lets a manager create, update, and delete a category, persisted in the DB', async () => {
      const created = await createCategory();
      const afterCreate = await prisma.category.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterCreate.name).toBe(created.name);

      const newName = `Renamed ${randomUUID()}`;
      const updated = await request(app.getHttpServer())
        .patch(`/v1/categories/${created.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: newName, slug: afterCreate.slug });
      expect(updated.status).toBe(200);
      const afterUpdate = await prisma.category.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterUpdate.name).toBe(newName);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/categories/${created.id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(deleted.status).toBe(204);
      const afterDelete = await prisma.category.findUnique({
        where: { id: created.id },
      });
      expect(afterDelete).toBeNull();
    });

    it('rejects a client creating a category (403) and does not create it', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/categories')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          name: `Client Cat ${randomUUID()}`,
          slug: `client-cat-${randomUUID()}`,
        });

      expect(response.status).toBe(403);
      const count = await prisma.category.count({
        where: { name: { contains: 'Client Cat' } },
      });
      expect(count).toBe(0);
    });

    it('rejects a duplicate name/slug (409) and leaves only the original row', async () => {
      const category = await createCategory();

      const duplicate = await request(app.getHttpServer())
        .post('/v1/categories')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: category.name, slug: category.slug });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body as ProblemBody).toMatchObject({
        status: 409,
        title: 'Category name or slug already in use',
      });
      const count = await prisma.category.count({
        where: { name: category.name },
      });
      expect(count).toBe(1);
    });

    it('rejects deleting a category that still has products (409) and leaves it in place', async () => {
      const category = await createCategory();
      await createProduct(category.id);

      const response = await request(app.getHttpServer())
        .delete(`/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(409);
      expect(response.body as ProblemBody).toMatchObject({
        status: 409,
        title: 'Category is not empty',
      });
      const stillThere = await prisma.category.findUnique({
        where: { id: category.id },
      });
      expect(stillThere).not.toBeNull();
    });
  });

  describe('products', () => {
    it('lets a manager create a product, visible in the public list', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);

      const persisted = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(persisted.name).toBe(product.name);
      expect(persisted.status).toBe('active');

      const publicGet = await request(app.getHttpServer()).get(
        `/v1/products/${product.id}`,
      );
      expect(publicGet.status).toBe(200);
    });

    it('rejects a client creating a product (403)', async () => {
      const category = await createCategory();

      const response = await request(app.getHttpServer())
        .post('/v1/products')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          categoryId: category.id,
          name: `Client Product ${randomUUID()}`,
        });

      expect(response.status).toBe(403);
    });

    it('returns 404 when creating a product against a missing category', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/products')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ categoryId: randomUUID(), name: 'Orphan Product' });

      expect(response.status).toBe(404);
    });

    it('hides a disabled product from a client (404) but keeps it visible to a manager (200)', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);

      const disable = await request(app.getHttpServer())
        .patch(`/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ status: 'disabled' });
      expect(disable.status).toBe(200);

      const asClient = await request(app.getHttpServer()).get(
        `/v1/products/${product.id}`,
      );
      expect(asClient.status).toBe(404);

      const asManager = await request(app.getHttpServer())
        .get(`/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(asManager.status).toBe(200);
    });

    it('soft-deletes a product, hiding it from everyone including a manager', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(deleted.status).toBe(204);

      const persisted = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(persisted.deletedAt).not.toBeNull();

      const asManager = await request(app.getHttpServer())
        .get(`/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(asManager.status).toBe(404);
    });
  });

  describe('skus', () => {
    it('lets a manager create a SKU, persisted with the requested stock', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);

      const sku = await createSku(product.id);

      const persisted = await prisma.sku.findUniqueOrThrow({
        where: { id: sku.id },
      });
      expect(persisted.stock).toBe(10);
      expect(persisted.productId).toBe(product.id);
    });

    it('rejects a client creating a SKU (403)', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);

      const response = await request(app.getHttpServer())
        .post('/v1/skus')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          productId: product.id,
          skuCode: `SKU-${randomUUID()}`,
          size: 'M',
          color: 'black',
          price: { amount: 1999, currency: 'USD' },
          stock: 10,
        });

      expect(response.status).toBe(403);
    });

    it('distinguishes duplicate skuCode from duplicate (product, size, color) — both 409', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);
      const sku = await createSku(product.id);

      const duplicateCode = await postSku(product.id, {
        skuCode: sku.skuCode,
        size: 'L',
        color: 'white',
      });
      expect(duplicateCode.status).toBe(409);
      expect(duplicateCode.body as ProblemBody).toMatchObject({
        status: 409,
        conflictingField: 'skuCode',
      });

      const duplicateSizeColor = await postSku(product.id, {
        skuCode: `SKU-${randomUUID()}`,
        size: 'M',
        color: 'black',
      });
      expect(duplicateSizeColor.status).toBe(409);
      expect(duplicateSizeColor.body as ProblemBody).toMatchObject({
        status: 409,
        conflictingField: 'size,color',
      });
    });

    it('restocks a SKU by a delta, not an absolute value, persisted', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);
      const sku = await createSku(product.id, { stock: 5 });

      const response = await request(app.getHttpServer())
        .post(`/v1/skus/${sku.id}/restock`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ quantity: 7 });

      expect(response.status).toBe(200);
      expect((response.body as SkuBody).stock).toBe(12);
      const persisted = await prisma.sku.findUniqueOrThrow({
        where: { id: sku.id },
      });
      expect(persisted.stock).toBe(12);
    });

    it('soft-deletes an unreserved SKU', async () => {
      const category = await createCategory();
      const product = await createProduct(category.id);
      const sku = await createSku(product.id);

      const response = await request(app.getHttpServer())
        .delete(`/v1/skus/${sku.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(204);
      const persisted = await prisma.sku.findUniqueOrThrow({
        where: { id: sku.id },
      });
      expect(persisted.deletedAt).not.toBeNull();
    });
  });
});
