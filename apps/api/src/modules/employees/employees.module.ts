import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, Assignment])],
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
