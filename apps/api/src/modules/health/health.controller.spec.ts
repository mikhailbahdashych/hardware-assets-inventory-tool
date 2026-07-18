import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const healthCheck = jest.fn();
  const pingCheck = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: healthCheck } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('delegates to HealthCheckService with a database ping indicator', async () => {
    healthCheck.mockImplementation(async (indicators: Array<() => Promise<unknown>>) => {
      for (const indicator of indicators) await indicator();
      return { status: 'ok' };
    });
    pingCheck.mockResolvedValue({ database: { status: 'up' } });

    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(pingCheck).toHaveBeenCalledWith('database');
  });
});
