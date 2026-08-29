import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCurrentUserRequestDto } from './dto/update-current-user-request.dto';
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
    it('throws NotFoundException when no user has that id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a UserResponseDto without passwordHash for an existing user', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);

      const result = await service.findById(existingUser.id);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toEqual({
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        role: existingUser.role,
        passwordChangedAt: existingUser.passwordChangedAt,
        createdAt: existingUser.createdAt,
      });
    });
  });

  describe('updateProfile', () => {
    it('updates only firstName/lastName and returns the updated UserResponseDto', async () => {
      const updated = {
        ...existingUser,
        firstName: 'Janet',
        lastName: 'Smith',
      };
      prisma.user.update.mockResolvedValue(updated);
      const dto: UpdateCurrentUserRequestDto = {
        firstName: 'Janet',
        lastName: 'Smith',
      };

      const result = await service.updateProfile(existingUser.id, dto);

      // The DTO type has no `role`/`email` fields, so a request can't smuggle
      // them in at compile time — this locks in that the Prisma call itself
      // only ever receives the two updatable fields.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: { firstName: 'Janet', lastName: 'Smith' },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toEqual({
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
        passwordChangedAt: updated.passwordChangedAt,
        createdAt: updated.createdAt,
      });
    });
  });
});
