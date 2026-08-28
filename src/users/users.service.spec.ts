// `service` and `existingUser` below are scaffolding for the it.todo cases —
// unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  const existingUser = {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Jane',
    lastName: 'Doe',
    role: 'client',
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it.todo('throws NotFoundException when no user has that id');

    it.todo(
      'returns a UserResponseDto without passwordHash for an existing user',
    );
  });

  describe('updateProfile', () => {
    it.todo(
      'updates only firstName/lastName and returns the updated UserResponseDto',
    );
  });
});
