import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CartService } from '../cart/cart.service';
import { CartEmptyException } from '../cart/exceptions/cart-empty.exception';
import { Prisma } from '../generated/prisma/client';
import { DiscountType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PromoCodeTakenException } from './exceptions/promo-code-taken.exception';
import { PromosService } from './promos.service';

describe('PromosService', () => {
  let service: PromosService;
  let prisma: {
    promoCode: {
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let cartService: { getOrCreate: jest.Mock };

  const managerId = 'user-1';
  const promoId = 'promo-1';

  const percentagePromo = {
    id: promoId,
    code: 'WELCOME15',
    discountType: DiscountType.percentage,
    discountValue: 15,
    minPurchaseAmount: null,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    usageLimit: 500,
    timesRedeemed: 37,
    isActive: true,
    createdBy: managerId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const fixedAmountPromo = {
    ...percentagePromo,
    id: 'promo-2',
    code: 'FLAT500',
    discountType: DiscountType.fixed_amount,
    discountValue: 500,
  };

  const codeConflict = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { constraint: { index: 'promo_codes_code_key' } },
        },
      },
    },
  );

  const cartWithItems = (subtotalAmount: number) => ({
    id: 'cart-1',
    items: [{ id: 'cart-item-1' }],
    subtotal: { amount: subtotalAmount, currency: 'USD' },
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const emptyCart = {
    id: 'cart-1',
    items: [],
    subtotal: { amount: 0, currency: 'USD' },
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      promoCode: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    cartService = { getOrCreate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        PromosService,
        { provide: PrismaService, useValue: prisma },
        { provide: CartService, useValue: cartService },
      ],
    }).compile();

    service = module.get(PromosService);
  });

  describe('create', () => {
    const percentageDto = {
      code: 'welcome15',
      discount: { type: 'percentage' as const, percent: 15 },
      expiresAt: '2099-01-01T00:00:00Z',
      usageLimit: 500,
    };

    it('normalizes the code to uppercase', async () => {
      prisma.promoCode.create.mockResolvedValue(percentagePromo);

      await service.create(percentageDto, managerId);

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: {
          code: 'WELCOME15',
          discountType: DiscountType.percentage,
          discountValue: 15,
          minPurchaseAmount: null,
          expiresAt: new Date(percentageDto.expiresAt),
          usageLimit: 500,
          createdBy: managerId,
        },
      });
    });

    it('throws PromoCodeTakenException on a P2002 violation', async () => {
      prisma.promoCode.create.mockRejectedValue(codeConflict);

      await expect(
        service.create(percentageDto, managerId),
      ).rejects.toBeInstanceOf(PromoCodeTakenException);
    });

    it('maps a percentage discount to discountType/discountValue', async () => {
      prisma.promoCode.create.mockResolvedValue(percentagePromo);

      await service.create(percentageDto, managerId);

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: {
          code: 'WELCOME15',
          discountType: DiscountType.percentage,
          discountValue: 15,
          minPurchaseAmount: null,
          expiresAt: new Date(percentageDto.expiresAt),
          usageLimit: 500,
          createdBy: managerId,
        },
      });
    });

    it('maps a fixedAmount discount to discountType/discountValue', async () => {
      const dto = {
        ...percentageDto,
        discount: {
          type: 'fixedAmount' as const,
          amount: { amount: 500, currency: 'USD' },
        },
      };
      prisma.promoCode.create.mockResolvedValue(fixedAmountPromo);

      await service.create(dto, managerId);

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: {
          code: 'WELCOME15',
          discountType: DiscountType.fixed_amount,
          discountValue: 500,
          minPurchaseAmount: null,
          expiresAt: new Date(dto.expiresAt),
          usageLimit: 500,
          createdBy: managerId,
        },
      });
    });

    it('stores minPurchaseAmount as null when omitted', async () => {
      prisma.promoCode.create.mockResolvedValue(percentagePromo);

      await service.create(percentageDto, managerId);

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: {
          code: 'WELCOME15',
          discountType: DiscountType.percentage,
          discountValue: 15,
          minPurchaseAmount: null,
          expiresAt: new Date(percentageDto.expiresAt),
          usageLimit: 500,
          createdBy: managerId,
        },
      });
    });

    it('stores minPurchaseAmount.amount when provided', async () => {
      const dto = {
        ...percentageDto,
        minPurchaseAmount: { amount: 2000, currency: 'USD' },
      };
      prisma.promoCode.create.mockResolvedValue({
        ...percentagePromo,
        minPurchaseAmount: 2000,
      });

      await service.create(dto, managerId);

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: {
          code: 'WELCOME15',
          discountType: DiscountType.percentage,
          discountValue: 15,
          minPurchaseAmount: 2000,
          expiresAt: new Date(dto.expiresAt),
          usageLimit: 500,
          createdBy: managerId,
        },
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the promo code does not exist', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { usageLimit: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.promoCode.update).not.toHaveBeenCalled();
    });

    it('leaves discount/expiresAt/minPurchaseAmount untouched when omitted', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(percentagePromo);
      prisma.promoCode.update.mockResolvedValue(percentagePromo);

      await service.update(promoId, { isActive: false });

      expect(prisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: promoId },
        data: { isActive: false, usageLimit: undefined },
      });
    });

    it('clears minPurchaseAmount when explicitly set to null', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        ...percentagePromo,
        minPurchaseAmount: 2000,
      });
      prisma.promoCode.update.mockResolvedValue(percentagePromo);

      await service.update(promoId, { minPurchaseAmount: null });

      expect(prisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: promoId },
        data: {
          minPurchaseAmount: null,
          usageLimit: undefined,
          isActive: undefined,
        },
      });
    });

    it('updates discountType/discountValue when a new discount is given', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(percentagePromo);
      prisma.promoCode.update.mockResolvedValue(fixedAmountPromo);

      await service.update(promoId, {
        discount: {
          type: 'fixedAmount',
          amount: { amount: 500, currency: 'USD' },
        },
      });

      expect(prisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: promoId },
        data: {
          discountType: DiscountType.fixed_amount,
          discountValue: 500,
          usageLimit: undefined,
          isActive: undefined,
        },
      });
    });
  });

  describe('list', () => {
    it('filters by isActive when provided', async () => {
      prisma.promoCode.findMany.mockResolvedValue([percentagePromo]);
      prisma.promoCode.count.mockResolvedValue(1);

      await service.list({
        isActive: true,
        includeExpired: false,
        limit: 20,
        offset: 0,
      });

      const expectedWhere = {
        isActive: true,
        expiresAt: { gt: expect.any(Date) as Date },
      };
      expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
      );
      expect(prisma.promoCode.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('applies no isActive filter when omitted', async () => {
      prisma.promoCode.findMany.mockResolvedValue([percentagePromo]);
      prisma.promoCode.count.mockResolvedValue(1);

      await service.list({ includeExpired: false, limit: 20, offset: 0 });

      expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { gt: expect.any(Date) as Date } },
        }),
      );
    });

    it('excludes expired codes by default (includeExpired: false)', async () => {
      prisma.promoCode.findMany.mockResolvedValue([]);
      prisma.promoCode.count.mockResolvedValue(0);

      await service.list({ includeExpired: false, limit: 20, offset: 0 });

      expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { gt: expect.any(Date) as Date } },
        }),
      );
    });

    it('includes expired codes when includeExpired is true', async () => {
      prisma.promoCode.findMany.mockResolvedValue([percentagePromo]);
      prisma.promoCode.count.mockResolvedValue(1);

      await service.list({ includeExpired: true, limit: 20, offset: 0 });

      expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when missing', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the promo code mapped through PromoCodeResponseDto', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(percentagePromo);

      const result = await service.getById(promoId);

      expect(result.discount).toEqual({ type: 'percentage', percent: 15 });
    });
  });

  describe('validate', () => {
    const userId = 'client-1';

    it('throws CartEmptyException when the cart has no items', async () => {
      cartService.getOrCreate.mockResolvedValue(emptyCart);

      await expect(
        service.validate(userId, 'WELCOME15'),
      ).rejects.toBeInstanceOf(CartEmptyException);
    });

    it("returns valid:false, reason:'invalid' when the code does not exist", async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(3998));
      prisma.promoCode.findUnique.mockResolvedValue(null);

      const result = await service.validate(userId, 'NOPE');

      expect(prisma.promoCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'NOPE' },
      });
      expect(result).toEqual({
        valid: false,
        reason: 'invalid',
        discount: null,
        subtotal: { amount: 3998, currency: 'USD' },
        total: { amount: 3998, currency: 'USD' },
      });
    });

    it("returns reason:'invalid' when the code exists but isActive is false", async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(3998));
      prisma.promoCode.findUnique.mockResolvedValue({
        ...percentagePromo,
        isActive: false,
      });

      const result = await service.validate(userId, 'WELCOME15');

      expect(result).toEqual({
        valid: false,
        reason: 'invalid',
        discount: null,
        subtotal: { amount: 3998, currency: 'USD' },
        total: { amount: 3998, currency: 'USD' },
      });
    });

    it("returns reason:'expired' when past expiresAt", async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(3998));
      prisma.promoCode.findUnique.mockResolvedValue({
        ...percentagePromo,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      });

      const result = await service.validate(userId, 'WELCOME15');

      expect(result).toEqual({
        valid: false,
        reason: 'expired',
        discount: null,
        subtotal: { amount: 3998, currency: 'USD' },
        total: { amount: 3998, currency: 'USD' },
      });
    });

    it("returns reason:'exhausted' when timesRedeemed >= usageLimit", async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(3998));
      prisma.promoCode.findUnique.mockResolvedValue({
        ...percentagePromo,
        timesRedeemed: 500,
        usageLimit: 500,
      });

      const result = await service.validate(userId, 'WELCOME15');

      expect(result).toEqual({
        valid: false,
        reason: 'exhausted',
        discount: null,
        subtotal: { amount: 3998, currency: 'USD' },
        total: { amount: 3998, currency: 'USD' },
      });
    });

    it("returns reason:'minimum-not-met' when subtotal is below minPurchaseAmount", async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(1000));
      prisma.promoCode.findUnique.mockResolvedValue({
        ...percentagePromo,
        minPurchaseAmount: 2000,
      });

      const result = await service.validate(userId, 'WELCOME15');

      expect(result).toEqual({
        valid: false,
        reason: 'minimum-not-met',
        discount: null,
        subtotal: { amount: 1000, currency: 'USD' },
        total: { amount: 1000, currency: 'USD' },
      });
    });

    it('computes a percentage discount, rounded, when everything checks out', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(3998));
      prisma.promoCode.findUnique.mockResolvedValue(percentagePromo);

      const result = await service.validate(userId, 'WELCOME15');

      expect(result).toEqual({
        valid: true,
        reason: null,
        discount: { amount: 600, currency: 'USD' },
        subtotal: { amount: 3998, currency: 'USD' },
        total: { amount: 3398, currency: 'USD' },
      });
    });

    it('caps a fixedAmount discount at the subtotal so total never goes negative', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithItems(300));
      prisma.promoCode.findUnique.mockResolvedValue(fixedAmountPromo);

      const result = await service.validate(userId, 'FLAT500');

      expect(result).toEqual({
        valid: true,
        reason: null,
        discount: { amount: 300, currency: 'USD' },
        subtotal: { amount: 300, currency: 'USD' },
        total: { amount: 0, currency: 'USD' },
      });
    });
  });
});
