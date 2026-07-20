import {
  Body,
  Controller,
  Delete,
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
import { Employee } from './entities/employee.entity';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';
import { TokenContext } from '../auth/token.service';

/** Reads: any authenticated role. Writes: Manager/Admin. Delete: Admin. */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  list(@Query() query: ListEmployeesDto): Promise<Paginated<Employee>> {
    return this.employeesService.list(query.page, query.pageSize, query.search, query.isActive);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Employee> {
    return this.employeesService.findById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<Employee> {
    return this.employeesService.create(dto, actor, this.ctxFrom(req));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<Employee> {
    return this.employeesService.update(id, dto, actor, this.ctxFrom(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.employeesService.remove(id, actor, this.ctxFrom(req));
  }

  private ctxFrom(req: Request): TokenContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
