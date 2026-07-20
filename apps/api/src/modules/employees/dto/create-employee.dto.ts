import { IsEmail, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

/** Optional nullable string: undefined = absent, null = explicitly empty. */
const optionalNullable = () =>
  ValidateIf((_object, value) => value !== undefined && value !== null);

export class CreateEmployeeDto {
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @optionalNullable()
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @optionalNullable()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  employeeNumber?: string | null;

  @optionalNullable()
  @IsString()
  @MaxLength(120)
  department?: string | null;

  @optionalNullable()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @optionalNullable()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
