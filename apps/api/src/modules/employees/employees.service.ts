import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, Paginated } from '@inventory/shared';
import { Employee } from './entities/employee.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { AuditService } from '../audit/audit.service';
import { escapeLike } from '../../common/utils/escape-like';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { TokenContext } from '../auth/token.service';

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

/** Fields the PATCH diff/audit tracks — hashes/ids can never leak by construction. */
const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'employeeNumber',
  'department',
  'title',
  'notes',
  'isActive',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];
type EmployeeChanges = Partial<Record<EditableField, unknown>>;

function friendlyConflict(err: unknown): ConflictException {
  const detail = String((err as { detail?: string }).detail ?? '');
  if (detail.includes('(email)')) {
    return new ConflictException('an employee with this email already exists');
  }
  if (detail.includes('(employee_number)')) {
    return new ConflictException('an employee with this employee number already exists');
  }
  return new ConflictException('an employee with these unique details already exists');
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    private readonly audit: AuditService,
  ) {}

  async list(
    page: number,
    pageSize: number,
    search?: string,
    isActive?: boolean,
  ): Promise<Paginated<Employee>> {
    const qb = this.employees
      .createQueryBuilder('e')
      .orderBy('e.lastName', 'ASC')
      .addOrderBy('e.firstName', 'ASC')
      .addOrderBy('e.id', 'ASC');
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      qb.andWhere(
        '(e.firstName ILIKE :pattern OR e.lastName ILIKE :pattern OR e.email ILIKE :pattern OR e.employeeNumber ILIKE :pattern)',
        { pattern },
      );
    }
    if (isActive !== undefined) {
      qb.andWhere('e.isActive = :isActive', { isActive });
    }
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findById(id: string): Promise<Employee> {
    const employee = await this.employees.findOne({ where: { id } });
    if (!employee) throw new NotFoundException('employee not found');
    return employee;
  }

  async create(
    input: EmployeeChanges & { firstName: string; lastName: string },
    actor: AuthenticatedUser,
    ctx: TokenContext,
  ): Promise<Employee> {
    let employee: Employee;
    try {
      employee = await this.employees.save(
        this.employees.create({
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: this.normalize(input.email as string | null | undefined)?.toLowerCase() ?? null,
          employeeNumber: this.normalize(input.employeeNumber as string | null | undefined) ?? null,
          department: this.normalize(input.department as string | null | undefined) ?? null,
          title: this.normalize(input.title as string | null | undefined) ?? null,
          notes: (input.notes as string | null | undefined) ?? null,
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) throw friendlyConflict(err);
      throw err;
    }

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.CREATE,
      entityType: 'Employee',
      entityId: employee.id,
      after: this.snapshot(employee),
      metadata: { ip: ctx.ip ?? null },
    });
    return employee;
  }

  async update(
    id: string,
    changes: EmployeeChanges,
    actor: AuthenticatedUser,
    ctx: TokenContext,
  ): Promise<Employee> {
    const employee = await this.findById(id);

    const current = employee as unknown as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (!(key in changes) || changes[key] === undefined) continue;
      let value = changes[key];
      if (key === 'email' && typeof value === 'string') value = value.trim().toLowerCase();
      else if (typeof value === 'string' && key !== 'notes') value = value.trim();
      if (value === current[key]) continue;
      before[key] = current[key];
      after[key] = value;
      current[key] = value;
    }
    if (Object.keys(before).length === 0) return employee;

    try {
      await this.employees.save(employee);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) throw friendlyConflict(err);
      throw err;
    }

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.UPDATE,
      entityType: 'Employee',
      entityId: employee.id,
      before,
      after,
      metadata: { ip: ctx.ip ?? null },
    });
    return employee;
  }

  /** Hard delete only when no assignment history references the employee. */
  async remove(id: string, actor: AuthenticatedUser, ctx: TokenContext): Promise<void> {
    const employee = await this.findById(id);
    const references = await this.assignments.count({ where: { employeeId: id } });
    if (references > 0) {
      throw new ConflictException(
        'this employee has assignment history — deactivate them instead of deleting',
      );
    }
    await this.employees.remove(employee);

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.DELETE,
      entityType: 'Employee',
      entityId: id,
      before: this.snapshot(employee),
      metadata: { ip: ctx.ip ?? null },
    });
  }

  private normalize(value: string | null | undefined): string | null | undefined {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  private snapshot(employee: Employee): Record<string, unknown> {
    return {
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      employeeNumber: employee.employeeNumber,
      department: employee.department,
      title: employee.title,
      isActive: employee.isActive,
    };
  }
}
