import { IsString, MaxLength } from 'class-validator';

export class MfaLoginDto {
  @IsString()
  @MaxLength(2048)
  ticket: string;

  /** 6-digit TOTP code or a recovery code (xxxxx-xxxxx). */
  @IsString()
  @MaxLength(32)
  code: string;
}
