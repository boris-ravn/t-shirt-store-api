import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MoneyRequestDto } from './money-request.dto';
import { STORE_CURRENCY } from './store-currency.constant';

describe('MoneyRequestDto', () => {
  it('rejects a negative amount', async () => {
    const dto = plainToInstance(MoneyRequestDto, {
      amount: -1,
      currency: STORE_CURRENCY,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('amount');
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('accepts zero and passes with no validation errors', async () => {
    const dto = plainToInstance(MoneyRequestDto, {
      amount: 0,
      currency: STORE_CURRENCY,
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});
