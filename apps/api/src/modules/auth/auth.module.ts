import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken]), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
