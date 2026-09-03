import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../casl/check-policies.decorator';
import { PoliciesGuard } from '../casl/policies.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { CreatePromoCodeRequestDto } from './dto/create-promo-code-request.dto';
import { ListPromoCodesQueryDto } from './dto/list-promo-codes-query.dto';
import { PromoCodeListResponseDto } from './dto/promo-code-list-response.dto';
import { PromoCodeResponseDto } from './dto/promo-code-response.dto';
import { PromoCodeValidationResponseDto } from './dto/promo-code-validation-response.dto';
import { UpdatePromoCodeRequestDto } from './dto/update-promo-code-request.dto';
import { ValidatePromoCodeRequestDto } from './dto/validate-promo-code-request.dto';
import { PromosService } from './promos.service';

@ApiTags('promo-codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/promo-codes')
export class PromosController {
  constructor(private readonly promosService: PromosService) {}

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'PromoCode'))
  @ApiOperation({ summary: 'Create a promo code' })
  @ApiCreatedResponse({ type: PromoCodeResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: CreatePromoCodeRequestDto,
  ): Promise<PromoCodeResponseDto> {
    return this.promosService.create(dto, user!.id);
  }

  @Get()
  @CheckPolicies((ability) => ability.can('manage', 'PromoCode'))
  @ApiOperation({ summary: 'List promo codes' })
  @ApiOkResponse({ type: PromoCodeListResponseDto })
  list(
    @Query() query: ListPromoCodesQueryDto,
  ): Promise<PromoCodeListResponseDto> {
    return this.promosService.list(query);
  }

  @Get(':promoCodeId')
  @CheckPolicies((ability) => ability.can('manage', 'PromoCode'))
  @ApiOperation({ summary: 'Get a promo code by id' })
  @ApiOkResponse({ type: PromoCodeResponseDto })
  getById(
    @Param('promoCodeId', ParseUUIDPipe) promoCodeId: string,
  ): Promise<PromoCodeResponseDto> {
    return this.promosService.getById(promoCodeId);
  }

  @Patch(':promoCodeId')
  @CheckPolicies((ability) => ability.can('manage', 'PromoCode'))
  @ApiOperation({ summary: 'Update a promo code' })
  @ApiOkResponse({ type: PromoCodeResponseDto })
  update(
    @Param('promoCodeId', ParseUUIDPipe) promoCodeId: string,
    @Body() dto: UpdatePromoCodeRequestDto,
  ): Promise<PromoCodeResponseDto> {
    return this.promosService.update(promoCodeId, dto);
  }

  @Post('validate')
  @CheckPolicies((ability) => ability.can('apply', 'PromoCode'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Validate a promo code against the caller's cart" })
  @ApiOkResponse({ type: PromoCodeValidationResponseDto })
  validate(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: ValidatePromoCodeRequestDto,
  ): Promise<PromoCodeValidationResponseDto> {
    return this.promosService.validate(user!.id, dto.code);
  }
}
