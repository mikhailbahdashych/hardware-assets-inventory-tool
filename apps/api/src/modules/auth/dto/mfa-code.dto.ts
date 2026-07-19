import { IsString, MaxLength } from 'class-validator';

/** Body for mfa/verify and mfa disable — a TOTP or recovery code. */
export class MfaCodeDto {
  @IsString()
  @MaxLength(32)
  code: string;
}
