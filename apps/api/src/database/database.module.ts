import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: false,
      migrationsRun: true,
      retryAttempts: 10,
      retryDelay: 3000,
    }),
  ],
})
export class DatabaseModule {}
