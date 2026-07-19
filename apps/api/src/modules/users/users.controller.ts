import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Paginated, UserRole } from '@inventory/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { TokenContext } from '../auth/token.service';

@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto): Promise<Paginated<User>> {
    return this.usersService.list(query.page, query.pageSize, query.search);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.usersService.findById(id);
  }

  @Post()
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ user: User; tempPassword: string }> {
    return this.usersService.create(dto, actor, this.ctxFrom(req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<User> {
    return this.usersService.update(id, dto, actor, this.ctxFrom(req));
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ tempPassword: string }> {
    return this.usersService.resetPassword(id, actor, this.ctxFrom(req));
  }

  @Post(':id/mfa/reset')
  @HttpCode(204)
  async resetMfa(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.usersService.resetMfa(id, actor, this.ctxFrom(req));
  }

  private ctxFrom(req: Request): TokenContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
