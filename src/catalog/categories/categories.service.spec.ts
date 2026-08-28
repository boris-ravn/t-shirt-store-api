// `service` and `existingCategory` below are scaffolding for the it.todo
// cases — unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: {
    category: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const existingCategory = {
    id: 'category-1',
    name: 'T-Shirts',
    slug: 't-shirts',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  // A real PrismaClientKnownRequestError (not a plain Error with .code
  // bolted on) — isUniqueConstraintViolation checks `instanceof`, so it
  // must be the actual class. Use as
  // prisma.category.create.mockRejectedValue(uniqueConstraintError).
  const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { target: ['name'] },
    },
  );

  beforeEach(async () => {
    prisma = {
      category: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  describe('list', () => {
    it.todo(
      'returns data mapped through CategoryResponseDto and meta from limit/offset/count',
    );
  });

  describe('getById', () => {
    it.todo('throws NotFoundException when no category has that id');

    it.todo('returns the category when found');
  });

  describe('create', () => {
    it.todo(
      'throws CategoryNameTakenException on a P2002 violation instead of the raw Prisma error',
    );

    it.todo('creates and returns the category on success');
  });

  describe('update', () => {
    it.todo(
      'throws NotFoundException when no category has that id (via the getById precheck)',
    );

    it.todo('throws CategoryNameTakenException on a P2002 violation');
  });

  describe('delete', () => {
    it.todo('throws NotFoundException when no category has that id');

    it.todo(
      'throws CategoryNotEmptyException with the real productCount when products reference it',
    );

    it.todo('deletes the category when it has no products');
  });
});
