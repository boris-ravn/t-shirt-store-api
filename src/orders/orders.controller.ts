import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CheckPolicies } from '../casl/check-policies.decorator';
import { PoliciesGuard } from '../casl/policies.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { CreateOrderRequestDto } from './dto/create-order-request.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderAdminResponseDto } from './dto/order-admin-response.dto';
import {
  OrderAdminListResponseDto,
  OrderListResponseDto,
} from './dto/order-list-response.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderStatusHistoryListResponseDto } from './dto/order-status-history-list-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@ApiExtraModels(
  OrderResponseDto,
  OrderAdminResponseDto,
  OrderListResponseDto,
  OrderAdminListResponseDto,
)
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Order'))
  @ApiOperation({ summary: "Check out the caller's cart into an order" })
  @ApiCreatedResponse({ type: OrderResponseDto })
  createOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: CreateOrderRequestDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.createOrder(user!, dto);
  }

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Order'))
  @ApiOperation({ summary: 'List orders, scoped by the caller role' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(OrderListResponseDto) },
        { $ref: getSchemaPath(OrderAdminListResponseDto) },
      ],
    },
  })
  listOrders(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListResponseDto | OrderAdminListResponseDto> {
    return this.ordersService.listOrders(user!, query);
  }

  @Get(':orderId')
  @CheckPolicies((ability) => ability.can('read', 'Order'))
  @ApiOperation({ summary: 'Get an order by id' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(OrderResponseDto) },
        { $ref: getSchemaPath(OrderAdminResponseDto) },
      ],
    },
  })
  getOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderResponseDto | OrderAdminResponseDto> {
    return this.ordersService.getOrder(user!, orderId);
  }

  @Post(':orderId/cancel')
  @CheckPolicies((ability) => ability.can('cancel', 'Order'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(OrderResponseDto) },
        { $ref: getSchemaPath(OrderAdminResponseDto) },
      ],
    },
  })
  cancelOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderResponseDto | OrderAdminResponseDto> {
    return this.ordersService.cancelOrder(user!, orderId);
  }

  @Post(':orderId/process')
  @CheckPolicies((ability) => ability.can('process', 'Order'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance an order from paid to processing' })
  @ApiOkResponse({ type: OrderAdminResponseDto })
  processOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderAdminResponseDto> {
    return this.ordersService.processOrder(user!, orderId);
  }

  @Post(':orderId/ship')
  @CheckPolicies((ability) => ability.can('ship', 'Order'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance an order from processing to shipped' })
  @ApiOkResponse({ type: OrderAdminResponseDto })
  shipOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderAdminResponseDto> {
    return this.ordersService.shipOrder(user!, orderId);
  }

  @Post(':orderId/deliver')
  @CheckPolicies((ability) => ability.can('deliver', 'Order'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a shipped order delivered' })
  @ApiOkResponse({ type: OrderResponseDto })
  deliverOrder(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.deliverOrder(user!, orderId);
  }

  @Get(':orderId/status-history')
  @CheckPolicies((ability) => ability.can('read', 'Order'))
  @ApiOperation({ summary: "List an order's status history" })
  @ApiOkResponse({ type: OrderStatusHistoryListResponseDto })
  listOrderStatusHistory(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<OrderStatusHistoryListResponseDto> {
    return this.ordersService.listOrderStatusHistory(user!, orderId, query);
  }
}
