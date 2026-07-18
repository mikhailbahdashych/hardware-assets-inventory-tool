import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SetupDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;
}
